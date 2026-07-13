import type { AppPreferences, RecordingSession } from '../../../shared/contracts'
import { chooseCodec, getQualityPreset, type CodecProfile } from '../../../shared/recording-settings'

const CHUNK_INTERVAL_MS = 1_000
const PAUSE_THRESHOLD_BYTES = 32 * 1024 * 1024
const RESUME_THRESHOLD_BYTES = 8 * 1024 * 1024

export interface RecordingStartResult {
  previewStream: MediaStream
  filePath: string
  codec: CodecProfile
  hasSystemAudio: boolean
  hasMicrophone: boolean
}

export interface RecordingControllerCallbacks {
  onCaptureEnded: () => void
  onWriteError: (error: Error) => void
  onStoragePressure: () => void
  onSystemAudioMuted: () => void
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

export class RecordingController {
  private mediaRecorder?: MediaRecorder
  private screenStream?: MediaStream
  private microphoneStream?: MediaStream
  private mixedStream?: MediaStream
  private audioContext?: AudioContext
  private session?: RecordingSession
  private writer?: ChunkWriter
  private storagePressureTriggered = false
  private stopOperation?: Promise<string>

  constructor(private readonly callbacks: RecordingControllerCallbacks) {}

  async start(sourceId: string, preferences: AppPreferences): Promise<RecordingStartResult> {
    const quality = getQualityPreset(preferences.qualityPreset)
    const codec = chooseCodec(preferences.codecPreference, MediaRecorder.isTypeSupported)

    await window.recordingApi.prepareCapture({
      sourceId,
      includeSystemAudio: preferences.includeSystemAudio
    })

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate, max: quality.frameRate }
        },
        audio: preferences.includeSystemAudio
      })

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

      this.mixedStream = await this.createMixedStream(this.screenStream, this.microphoneStream)
      this.session = await window.recordingApi.createRecording({
        extension: codec.extension,
        mode: preferences.captureMode
      })
      this.writer = new ChunkWriter(
        this.session.id,
        (active) => this.handlePressure(active),
        this.callbacks.onWriteError
      )
      this.mediaRecorder = new MediaRecorder(this.mixedStream, {
        mimeType: codec.mimeType,
        videoBitsPerSecond: quality.videoBitsPerSecond,
        audioBitsPerSecond: quality.audioBitsPerSecond
      })
      this.bindRecorderEvents()
      this.screenStream.getVideoTracks()[0]?.addEventListener('ended', this.callbacks.onCaptureEnded, {
        once: true
      })
      this.mediaRecorder.start(CHUNK_INTERVAL_MS)

      const systemAudioTrack = this.screenStream.getAudioTracks()[0]
      systemAudioTrack?.addEventListener('mute', this.callbacks.onSystemAudioMuted)

      return {
        previewStream: this.screenStream,
        filePath: this.session.filePath,
        codec,
        hasSystemAudio: Boolean(
          systemAudioTrack && systemAudioTrack.readyState === 'live' && !systemAudioTrack.muted
        ),
        hasMicrophone: (this.microphoneStream?.getAudioTracks().length ?? 0) > 0
      }
    } catch (error) {
      await this.cleanupAfterFailure()
      throw error
    }
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.pause()
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') this.mediaRecorder.resume()
  }

  stop(): Promise<string> {
    this.stopOperation ??= this.performStop()
    return this.stopOperation
  }

  private async performStop(): Promise<string> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => {
        this.mediaRecorder!.addEventListener('stop', () => resolve(), { once: true })
      })
      this.mediaRecorder.stop()
      await stopped
    }

    try {
      await this.writer?.flush()
      return this.session
        ? await window.recordingApi.finishRecording(this.session.id)
        : ''
    } catch (error) {
      if (this.session) await window.recordingApi.abortRecording(this.session.id)
      throw error
    } finally {
      this.stopTracks()
      await this.audioContext?.close().catch(() => undefined)
    }
  }

  private bindRecorderEvents(): void {
    if (!this.mediaRecorder || !this.writer) return
    this.mediaRecorder.addEventListener('dataavailable', (event) => this.writer?.push(event.data))
    this.mediaRecorder.addEventListener('error', (event) => {
      const recorderError = (event as Event & { error?: DOMException }).error
      this.callbacks.onWriteError(recorderError ?? new Error('인코더에서 오류가 발생했습니다.'))
    })
  }

  private async createMixedStream(
    screenStream: MediaStream,
    microphoneStream?: MediaStream
  ): Promise<MediaStream> {
    const mixed = new MediaStream(screenStream.getVideoTracks())
    const audioStreams = [screenStream, microphoneStream].filter(
      (stream): stream is MediaStream => Boolean(stream?.getAudioTracks().length)
    )
    if (audioStreams.length === 0) return mixed

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
    destination.stream.getAudioTracks().forEach((track) => mixed.addTrack(track))
    return mixed
  }

  private handlePressure(active: boolean): void {
    if (!this.mediaRecorder) return
    if (active && !this.storagePressureTriggered) {
      this.storagePressureTriggered = true
      if (this.mediaRecorder.state === 'recording') this.mediaRecorder.pause()
      this.callbacks.onStoragePressure()
    }
  }

  private async cleanupAfterFailure(): Promise<void> {
    this.stopTracks()
    await this.audioContext?.close().catch(() => undefined)
    if (this.session) await window.recordingApi.abortRecording(this.session.id)
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
