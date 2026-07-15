import type {
  AppPreferences,
  CaptureSource,
  CreateRecordingRequest,
  NativeSystemAudioRequest,
  RecordingSession
} from '../../../shared/contracts'
import { getSystemAudioBackend, type SystemAudioBackend } from '../../../shared/audio-capture'
import { chooseAudioExportProfile } from '../../../shared/audio-export'
import { getCaptureVideoConstraints } from '../../../shared/capture-constraints'
import {
  chooseCodec,
  getEncodingPlan,
  shouldPreferHighQualityH264,
  type ResolvedCodecProfile
} from '../../../shared/recording-settings'

const CHUNK_INTERVAL_MS = 1_000
const PAUSE_THRESHOLD_BYTES = 32 * 1024 * 1024
const RESUME_THRESHOLD_BYTES = 8 * 1024 * 1024

export async function ensureAudioContextRunning(
  context: Pick<AudioContext, 'resume' | 'state'>
): Promise<void> {
  if (context.state === 'suspended') await context.resume()
}

export interface RecordingStartResult {
  previewStream: MediaStream
  filePath: string
  audioFilePath?: string
  audioFormatLabel?: string
  codec: ResolvedCodecProfile
  hasSystemAudio: boolean
  hasMicrophone: boolean
}

export interface RecordingStopResult {
  filePath: string
  audioFilePath?: string
}

export interface RecordingControllerCallbacks {
  onCaptureEnded: () => void
  onWriteError: (error: Error) => void
  onStoragePressure: () => void
  onSystemAudioMuted: () => void
  onSystemAudioError: (error: Error) => void
  onAudioExportError: (error: Error) => void
}

class ChunkWriter {
  private tail = Promise.resolve()
  private pendingBytes = 0
  private pressureActive = false

  constructor(
    private readonly sessionId: string,
    private readonly onPressureChange: (active: boolean) => void,
    private readonly onError: (error: Error) => void
  ) {}

  private failure?: Error

  push(blob: Blob): void {
    if (blob.size === 0 || this.failure) return
    this.pendingBytes += blob.size
    this.updatePressure()

    this.tail = this.tail
      .then(async () => {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await window.recordingApi.writeRecordingChunk(this.sessionId, bytes)
      })
      .catch((error: unknown) => {
        this.failure = normalizeError(error)
        this.onError(this.failure)
      })
      .finally(() => {
        this.pendingBytes -= blob.size
        this.updatePressure()
      })
  }

  async flush(): Promise<void> {
    await this.tail
    if (this.failure) throw this.failure
  }

  private updatePressure(): void {
    if (!this.pressureActive && this.pendingBytes >= PAUSE_THRESHOLD_BYTES) {
      this.pressureActive = true
      this.onPressureChange(true)
    } else if (this.pressureActive && this.pendingBytes <= RESUME_THRESHOLD_BYTES) {
      this.pressureActive = false
      this.onPressureChange(false)
    }
  }
}

interface RecordingArtifactPipeline {
  recorder: MediaRecorder
  session: RecordingSession
  writer: ChunkWriter
}

export class RecordingController {
  private videoPipeline?: RecordingArtifactPipeline
  private audioPipeline?: RecordingArtifactPipeline
  private screenStream?: MediaStream
  private microphoneStream?: MediaStream
  private mixedStream?: MediaStream
  private audioContext?: AudioContext
  private audioFormatLabel?: string
  private audioExportFailure?: Error
  private storagePressureTriggered = false
  private stopOperation?: Promise<RecordingStopResult>
  private abortOperation?: Promise<void>
  private nativeSystemAudioStarted = false
  private nativeAudioNode?: AudioWorkletNode
  private removeNativeAudioDataListener?: () => void
  private removeNativeAudioErrorListener?: () => void

  constructor(private readonly callbacks: RecordingControllerCallbacks) {}

  async start(source: CaptureSource, preferences: AppPreferences): Promise<RecordingStartResult> {
    const codec = chooseCodec(
      preferences.recordingFormat,
      preferences.codecPreference,
      MediaRecorder.isTypeSupported,
      {
        preferHighQualityH264: shouldPreferHighQualityH264(preferences.qualityPreset)
      }
    )
    const quality = getEncodingPlan(
      preferences.qualityPreset,
      preferences.storageMode,
      codec.id,
      preferences.audioQuality
    )

    const platform = window.recordingApi.platform === 'darwin' || window.recordingApi.platform === 'win32'
      ? window.recordingApi.platform
      : 'other'
    const selectedApplicationAudioSupported = source.type === 'window' && preferences.includeSystemAudio
      ? (await window.recordingApi.getPermissions()).selectedApplicationAudioSupported
      : true
    const systemAudioBackend = getSystemAudioBackend(
      platform,
      source.type,
      preferences.includeSystemAudio,
      selectedApplicationAudioSupported
    )
    const nativeSystemAudioRequest: NativeSystemAudioRequest = {
      sourceId: source.id,
      sourceType: source.type,
      displayId: source.displayId
    }

    await window.recordingApi.prepareCapture({
      ...nativeSystemAudioRequest,
      includeSystemAudio: preferences.includeSystemAudio
    })

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: getCaptureVideoConstraints(
          source.type,
          quality.width,
          quality.height,
          quality.frameRate
        ),
        audio: systemAudioBackend === 'electron-loopback'
      })

      const loopbackTrack = this.screenStream.getAudioTracks()[0]
      if (systemAudioBackend === 'electron-loopback' && !loopbackTrack) {
        throw new Error(
          '시스템 오디오 트랙을 시작하지 못했습니다. 운영체제의 오디오 캡처 권한을 확인해 주세요.'
        )
      }

      if (preferences.includeMicrophone) {
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            deviceId: preferences.microphoneDeviceId
              ? { exact: preferences.microphoneDeviceId }
              : undefined,
            channelCount: 1,
            sampleRate: 48_000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })
      }

      this.mixedStream = await this.createMixedStream(
        this.screenStream,
        this.microphoneStream,
        systemAudioBackend,
        nativeSystemAudioRequest
      )
      this.videoPipeline = await this.createArtifactPipeline(
        {
          extension: codec.extension,
          mode: preferences.captureMode,
          artifact: 'video'
        },
        this.mixedStream,
        {
          mimeType: codec.mimeType,
          videoBitsPerSecond: quality.videoBitsPerSecond,
          audioBitsPerSecond: quality.audioBitsPerSecond
        },
        this.callbacks.onWriteError
      )

      if (preferences.saveAudioFile && this.mixedStream.getAudioTracks().length > 0) {
        await this.prepareAudioExport(preferences, quality.audioBitsPerSecond)
      }

      this.screenStream.getVideoTracks()[0]?.addEventListener('ended', this.callbacks.onCaptureEnded, {
        once: true
      })
      if (this.audioPipeline) {
        try {
          this.audioPipeline.recorder.start(CHUNK_INTERVAL_MS)
        } catch (error) {
          await this.discardAudioExport(normalizeError(error))
        }
      }
      this.videoPipeline.recorder.start(CHUNK_INTERVAL_MS)

      const systemAudioTrack = systemAudioBackend === 'electron-loopback'
        ? this.screenStream.getAudioTracks()[0]
        : undefined
      systemAudioTrack?.addEventListener('mute', this.callbacks.onSystemAudioMuted)
      systemAudioTrack?.addEventListener('ended', this.callbacks.onSystemAudioMuted, { once: true })

      return {
        previewStream: this.mixedStream,
        filePath: this.videoPipeline.session.filePath,
        audioFilePath: this.audioPipeline?.session.filePath,
        audioFormatLabel: this.audioFormatLabel,
        codec,
        hasSystemAudio: systemAudioBackend === 'native-content'
          ? this.nativeSystemAudioStarted
          : Boolean(systemAudioTrack && systemAudioTrack.readyState === 'live'),
        hasMicrophone: (this.microphoneStream?.getAudioTracks().length ?? 0) > 0
      }
    } catch (error) {
      await this.cleanupAfterFailure()
      throw error
    }
  }

  pause(): void {
    if (this.videoPipeline?.recorder.state === 'recording') this.videoPipeline.recorder.pause()
    if (this.audioPipeline?.recorder.state === 'recording') {
      try {
        this.audioPipeline.recorder.pause()
      } catch (error) {
        this.handleAudioExportError(normalizeError(error))
      }
    }
  }

  resume(): void {
    if (this.videoPipeline?.recorder.state === 'paused') this.videoPipeline.recorder.resume()
    if (this.audioPipeline?.recorder.state === 'paused') {
      try {
        this.audioPipeline.recorder.resume()
      } catch (error) {
        this.handleAudioExportError(normalizeError(error))
      }
    }
  }

  stop(): Promise<RecordingStopResult> {
    if (this.abortOperation) return this.abortOperation.then(() => ({ filePath: '' }))
    this.stopOperation ??= this.performStop()
    return this.stopOperation
  }

  abort(): Promise<void> {
    if (this.stopOperation) return this.stopOperation.then(() => undefined)
    this.abortOperation ??= this.performAbort()
    return this.abortOperation
  }

  private async performStop(): Promise<RecordingStopResult> {
    await this.stopMediaRecorders()

    try {
      await this.videoPipeline?.writer.flush()
      const filePath = this.videoPipeline
        ? await window.recordingApi.finishRecording(this.videoPipeline.session.id)
        : ''

      let audioFilePath: string | undefined
      if (this.audioPipeline) {
        try {
          if (this.audioExportFailure) throw this.audioExportFailure
          await this.audioPipeline.writer.flush()
          audioFilePath = await window.recordingApi.finishRecording(this.audioPipeline.session.id)
        } catch (error) {
          const normalized = normalizeError(error)
          this.handleAudioExportError(normalized)
          await window.recordingApi.abortRecording(this.audioPipeline.session.id).catch(() => undefined)
        }
      }

      return { filePath, audioFilePath }
    } catch (error) {
      await this.abortSessions()
      throw error
    } finally {
      await this.releaseMediaResources()
    }
  }

  private async performAbort(): Promise<void> {
    try {
      await this.stopMediaRecorders().catch(() => undefined)
      await Promise.all([
        this.videoPipeline?.writer.flush().catch(() => undefined),
        this.audioPipeline?.writer.flush().catch(() => undefined)
      ])
      await this.abortSessions()
    } finally {
      await this.releaseMediaResources()
    }
  }

  private async stopMediaRecorders(): Promise<void> {
    if (this.videoPipeline) await this.stopRecorder(this.videoPipeline.recorder)
    if (this.audioPipeline) {
      try {
        await this.stopRecorder(this.audioPipeline.recorder)
      } catch (error) {
        this.handleAudioExportError(normalizeError(error))
      }
    }
  }

  private async stopRecorder(recorder: MediaRecorder): Promise<void> {
    if (recorder.state === 'inactive') return
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
    })
    recorder.stop()
    await stopped
  }

  private bindRecorderEvents(
    recorder: MediaRecorder,
    writer: ChunkWriter,
    onError: (error: Error) => void
  ): void {
    recorder.addEventListener('dataavailable', (event) => writer.push(event.data))
    recorder.addEventListener('error', (event) => {
      const recorderError = (event as Event & { error?: DOMException }).error
      onError(recorderError ?? new Error('인코더에서 오류가 발생했습니다.'))
    })
  }

  private async createArtifactPipeline(
    request: CreateRecordingRequest,
    stream: MediaStream,
    options: MediaRecorderOptions,
    onError: (error: Error) => void
  ): Promise<RecordingArtifactPipeline> {
    const session = await window.recordingApi.createRecording(request)
    const writer = new ChunkWriter(
      session.id,
      (active) => this.handlePressure(active),
      onError
    )
    try {
      const recorder = new MediaRecorder(stream, options)
      this.bindRecorderEvents(recorder, writer, onError)
      return { recorder, session, writer }
    } catch (error) {
      await window.recordingApi.abortRecording(session.id).catch(() => undefined)
      throw error
    }
  }

  private async prepareAudioExport(
    preferences: AppPreferences,
    audioBitsPerSecond: number
  ): Promise<void> {
    if (!this.mixedStream) return
    try {
      const profile = chooseAudioExportProfile(MediaRecorder.isTypeSupported)
      this.audioPipeline = await this.createArtifactPipeline(
        {
          extension: profile.extension,
          mode: preferences.captureMode,
          artifact: 'audio'
        },
        new MediaStream(this.mixedStream.getAudioTracks()),
        {
          mimeType: profile.mimeType,
          audioBitsPerSecond
        },
        (error) => this.handleAudioExportError(error)
      )
      this.audioFormatLabel = profile.label
    } catch (error) {
      await this.discardAudioExport(normalizeError(error))
    }
  }

  private async discardAudioExport(error: Error): Promise<void> {
    this.callbacks.onAudioExportError(error)
    if (this.audioPipeline) {
      await this.stopRecorder(this.audioPipeline.recorder).catch(() => undefined)
      await window.recordingApi.abortRecording(this.audioPipeline.session.id).catch(() => undefined)
    }
    this.audioPipeline = undefined
    this.audioFormatLabel = undefined
    this.audioExportFailure = undefined
  }

  private handleAudioExportError(error: Error): void {
    if (this.audioExportFailure) return
    this.audioExportFailure = error
    this.callbacks.onAudioExportError(error)
  }

  private async createMixedStream(
    screenStream: MediaStream,
    microphoneStream: MediaStream | undefined,
    systemAudioBackend: SystemAudioBackend,
    nativeSystemAudioRequest: NativeSystemAudioRequest
  ): Promise<MediaStream> {
    const mixed = new MediaStream(screenStream.getVideoTracks())
    const audioStreams = [screenStream, microphoneStream].filter(
      (stream): stream is MediaStream => Boolean(stream?.getAudioTracks().length)
    )
    const needsNativeSystemAudio = systemAudioBackend === 'native-content'
    if (audioStreams.length === 0 && !needsNativeSystemAudio) return mixed

    this.audioContext = new AudioContext({ sampleRate: 48_000, latencyHint: 'playback' })
    const destination = this.audioContext.createMediaStreamDestination()
    const compressor = this.audioContext.createDynamicsCompressor()
    compressor.threshold.value = -6
    compressor.knee.value = 12
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    compressor.connect(destination)

    audioStreams.forEach((stream, index) => {
      const source = this.audioContext!.createMediaStreamSource(stream)
      const gain = this.audioContext!.createGain()
      gain.gain.value = index === 0 && audioStreams.length > 1 ? 0.82 : 1
      source.connect(gain).connect(compressor)
    })

    if (needsNativeSystemAudio) {
      await this.audioContext.audioWorklet.addModule(
        new URL('system-audio-worklet.js', window.location.href).href
      )
      this.nativeAudioNode = new AudioWorkletNode(
        this.audioContext,
        'framenote-system-audio',
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        }
      )
      const gain = this.audioContext.createGain()
      gain.gain.value = microphoneStream ? 0.82 : 1
      this.nativeAudioNode.connect(gain).connect(compressor)
      this.nativeAudioNode.port.onmessage = ({ data }) => {
        if (data && typeof data === 'object' && 'type' in data && data.type === 'overflow') {
          this.callbacks.onSystemAudioError(
            new Error('시스템 오디오 처리 속도가 캡처 속도를 따라가지 못했습니다.')
          )
        }
      }
      this.removeNativeAudioDataListener = window.recordingApi.onNativeSystemAudioData((samples) => {
        const copy = new Float32Array(samples)
        this.nativeAudioNode?.port.postMessage(copy, [copy.buffer])
      })
      this.removeNativeAudioErrorListener = window.recordingApi.onNativeSystemAudioError((message) => {
        this.callbacks.onSystemAudioError(new Error(message))
      })
      await window.recordingApi.startNativeSystemAudio(nativeSystemAudioRequest)
      this.nativeSystemAudioStarted = true
    }

    await ensureAudioContextRunning(this.audioContext)
    destination.stream.getAudioTracks().forEach((track) => mixed.addTrack(track))
    return mixed
  }

  private handlePressure(active: boolean): void {
    if (active && !this.storagePressureTriggered) {
      this.storagePressureTriggered = true
      if (this.videoPipeline?.recorder.state === 'recording') this.videoPipeline.recorder.pause()
      if (this.audioPipeline?.recorder.state === 'recording') {
        try {
          this.audioPipeline.recorder.pause()
        } catch (error) {
          this.handleAudioExportError(normalizeError(error))
        }
      }
      this.callbacks.onStoragePressure()
    }
  }

  private async cleanupAfterFailure(): Promise<void> {
    try {
      await this.stopMediaRecorders().catch(() => undefined)
      await this.abortSessions()
    } finally {
      await this.releaseMediaResources()
    }
  }

  private async abortSessions(): Promise<void> {
    await Promise.all(
      [this.videoPipeline, this.audioPipeline]
        .filter((pipeline): pipeline is RecordingArtifactPipeline => Boolean(pipeline))
        .map(({ session }) => window.recordingApi.abortRecording(session.id))
    )
  }

  private async releaseMediaResources(): Promise<void> {
    this.stopTracks()
    if (this.nativeSystemAudioStarted) {
      await window.recordingApi.stopNativeSystemAudio().catch(() => undefined)
      this.nativeSystemAudioStarted = false
    }
    this.removeNativeAudioDataListener?.()
    this.removeNativeAudioErrorListener?.()
    this.removeNativeAudioDataListener = undefined
    this.removeNativeAudioErrorListener = undefined
    this.nativeAudioNode?.disconnect()
    this.nativeAudioNode = undefined
    await this.audioContext?.close().catch(() => undefined)
  }

  private stopTracks(): void {
    this.screenStream?.getTracks().forEach((track) => track.stop())
    this.microphoneStream?.getTracks().forEach((track) => track.stop())
    this.mixedStream?.getTracks().forEach((track) => track.stop())
  }
}

export function normalizeError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return new Error('화면 또는 오디오 권한이 허용되지 않았습니다. 시스템 설정을 확인해 주세요.')
    }
    if (error.name === 'NotFoundError') {
      return new Error('선택한 화면이나 오디오 장치를 찾을 수 없습니다.')
    }
    if (error.name === 'NotReadableError') {
      return new Error('다른 앱이 장치를 사용 중이거나 운영체제가 캡처를 차단했습니다.')
    }
  }
  return error instanceof Error ? error : new Error('녹화를 시작하지 못했습니다.')
}
