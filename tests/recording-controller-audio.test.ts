import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RecordingController,
  type RecordingControllerCallbacks
} from '../src/renderer/src/lib/recording-controller'
import {
  createDefaultPreferences,
  type CaptureSource,
  type CreateRecordingRequest,
  type RecordingSession
} from '../src/shared/contracts'

interface FakeTrack {
  kind: 'audio' | 'video'
  readyState: MediaStreamTrackState
  stop: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
}

function track(kind: FakeTrack['kind']): FakeTrack {
  return {
    kind,
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn()
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}

  getTracks(): FakeTrack[] {
    return this.tracks
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter(({ kind }) => kind === 'video')
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter(({ kind }) => kind === 'audio')
  }

  addTrack(next: FakeTrack): void {
    this.tracks.push(next)
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = (mimeType: string): boolean =>
    mimeType.startsWith('video/mp4') || mimeType.startsWith('audio/mp4')

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  private readonly listeners = new Map<string, EventListener[]>()

  constructor(
    readonly stream: FakeMediaStream,
    readonly options: MediaRecorderOptions
  ) {
    FakeMediaRecorder.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type) ?? []
    current.push(listener)
    this.listeners.set(type, current)
  }

  start(): void {
    this.state = 'recording'
  }

  pause(): void {
    this.state = 'paused'
  }

  resume(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.emit('dataavailable', { data: new Blob([this.options.mimeType ?? 'recording']) })
    this.emit('stop', {})
  }

  private emit(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event as Event))
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  private readonly destinationTrack = track('audio')

  createMediaStreamDestination(): { stream: FakeMediaStream } {
    return { stream: new FakeMediaStream([this.destinationTrack]) }
  }

  createDynamicsCompressor(): {
    threshold: { value: number }
    knee: { value: number }
    ratio: { value: number }
    attack: { value: number }
    release: { value: number }
    connect: <T>(target: T) => T
  } {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: <T>(target: T): T => target
    }
  }

  createMediaStreamSource(): { connect: <T>(target: T) => T } {
    return { connect: <T>(target: T): T => target }
  }

  createGain(): { gain: { value: number }; connect: <T>(target: T) => T } {
    return {
      gain: { value: 0 },
      connect: <T>(target: T): T => target
    }
  }

  resume(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

const source: CaptureSource = {
  id: 'screen:1:0',
  name: 'Screen 1',
  type: 'screen',
  thumbnailDataUrl: 'data:image/png;base64,',
  displayId: '1'
}

function callbacks(): RecordingControllerCallbacks {
  return {
    onCaptureEnded: vi.fn(),
    onWriteError: vi.fn(),
    onStoragePressure: vi.fn(),
    onSystemAudioMuted: vi.fn(),
    onSystemAudioError: vi.fn(),
    onAudioExportError: vi.fn()
  }
}

function installMediaMocks(rejectAudioWrite = false): {
  api: {
    createRecording: ReturnType<typeof vi.fn>
    writeRecordingChunk: ReturnType<typeof vi.fn>
    finishRecording: ReturnType<typeof vi.fn>
    abortRecording: ReturnType<typeof vi.fn>
  }
  callbacks: RecordingControllerCallbacks
} {
  const sessions: Record<CreateRecordingRequest['artifact'], RecordingSession> = {
    video: { id: 'video-session', filePath: '/tmp/Screen.mp4' },
    audio: { id: 'audio-session', filePath: '/tmp/Screen_Audio.m4a' }
  }
  const createRecording = vi.fn(async (request: CreateRecordingRequest) => sessions[request.artifact])
  const writeRecordingChunk = vi.fn(async (sessionId: string) => {
    if (rejectAudioWrite && sessionId === sessions.audio.id) throw new Error('audio disk error')
  })
  const finishRecording = vi.fn(async (sessionId: string) =>
    sessionId === sessions.video.id ? sessions.video.filePath : sessions.audio.filePath
  )
  const abortRecording = vi.fn().mockResolvedValue(undefined)
  const recordingCallbacks = callbacks()

  vi.stubGlobal('MediaStream', FakeMediaStream)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(new FakeMediaStream([track('video')])),
      getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([track('audio')]))
    }
  })
  vi.stubGlobal('window', {
    location: { href: 'http://localhost/' },
    recordingApi: {
      platform: 'other',
      prepareCapture: vi.fn().mockResolvedValue(undefined),
      createRecording,
      writeRecordingChunk,
      finishRecording,
      abortRecording,
      stopNativeSystemAudio: vi.fn().mockResolvedValue(undefined)
    }
  })

  return {
    api: { createRecording, writeRecordingChunk, finishRecording, abortRecording },
    callbacks: recordingCallbacks
  }
}

describe('RecordingController audio extraction', () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records and finalizes a separate audio-only file with the video', async () => {
    const { api, callbacks: recordingCallbacks } = installMediaMocks()
    const controller = new RecordingController(recordingCallbacks)
    const preferences = {
      ...createDefaultPreferences('/tmp'),
      captureMode: 'screen' as const,
      includeSystemAudio: false,
      includeMicrophone: true,
      saveAudioFile: true,
      countdownSeconds: 0 as const
    }

    const started = await controller.start(source, preferences)

    expect(api.createRecording).toHaveBeenNthCalledWith(1, {
      extension: 'mp4',
      mode: 'screen',
      artifact: 'video'
    })
    expect(api.createRecording).toHaveBeenNthCalledWith(2, {
      extension: 'm4a',
      mode: 'screen',
      artifact: 'audio'
    })
    expect(started).toMatchObject({
      filePath: '/tmp/Screen.mp4',
      audioFilePath: '/tmp/Screen_Audio.m4a',
      audioFormatLabel: 'M4A · AAC'
    })
    expect(FakeMediaRecorder.instances).toHaveLength(2)

    controller.pause()
    expect(FakeMediaRecorder.instances.every(({ state }) => state === 'paused')).toBe(true)
    controller.resume()
    expect(FakeMediaRecorder.instances.every(({ state }) => state === 'recording')).toBe(true)

    await expect(controller.stop()).resolves.toEqual({
      filePath: '/tmp/Screen.mp4',
      audioFilePath: '/tmp/Screen_Audio.m4a'
    })
    expect(api.writeRecordingChunk).toHaveBeenCalledWith('video-session', expect.any(Uint8Array))
    expect(api.writeRecordingChunk).toHaveBeenCalledWith('audio-session', expect.any(Uint8Array))
    expect(api.finishRecording).toHaveBeenCalledTimes(2)
    expect(recordingCallbacks.onAudioExportError).not.toHaveBeenCalled()
  })

  it('preserves the completed video when writing the optional audio file fails', async () => {
    const { api, callbacks: recordingCallbacks } = installMediaMocks(true)
    const controller = new RecordingController(recordingCallbacks)
    const preferences = {
      ...createDefaultPreferences('/tmp'),
      captureMode: 'screen' as const,
      includeSystemAudio: false,
      includeMicrophone: true,
      saveAudioFile: true
    }

    await controller.start(source, preferences)

    await expect(controller.stop()).resolves.toEqual({
      filePath: '/tmp/Screen.mp4',
      audioFilePath: undefined
    })
    expect(api.finishRecording).toHaveBeenCalledWith('video-session')
    expect(api.finishRecording).not.toHaveBeenCalledWith('audio-session')
    expect(api.abortRecording).toHaveBeenCalledWith('audio-session')
    expect(recordingCallbacks.onAudioExportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'audio disk error' })
    )
    expect(recordingCallbacks.onWriteError).not.toHaveBeenCalled()
  })
})
