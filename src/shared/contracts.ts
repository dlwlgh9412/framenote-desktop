import type { CodecPreference, QualityPresetId } from './recording-settings'

export type CaptureMode = 'meeting' | 'screen'

export interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
  appIconDataUrl?: string
  displayId: string
}

export interface AppPreferences {
  outputDirectory: string
  codecPreference: CodecPreference
  qualityPreset: QualityPresetId
  captureMode: CaptureMode
  includeSystemAudio: boolean
  includeMicrophone: boolean
  microphoneDeviceId: string
}

export interface PermissionSnapshot {
  screen: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
  microphone: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
  systemAudioSupported: boolean
  platform: 'darwin' | 'win32' | 'other'
}

export interface PrepareCaptureRequest {
  sourceId: string
  includeSystemAudio: boolean
}

export interface CreateRecordingRequest {
  extension: 'mp4' | 'webm'
  mode: CaptureMode
}

export interface RecordingSession {
  id: string
  filePath: string
}

export interface RecordingApi {
  platform: NodeJS.Platform
  listSources: () => Promise<CaptureSource[]>
  getPermissions: () => Promise<PermissionSnapshot>
  requestMicrophonePermission: () => Promise<boolean>
  openPermissionSettings: (kind: 'screen' | 'microphone') => Promise<void>
  getPreferences: () => Promise<AppPreferences>
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<AppPreferences>
  chooseOutputDirectory: () => Promise<AppPreferences>
  openOutputDirectory: () => Promise<void>
  prepareCapture: (request: PrepareCaptureRequest) => Promise<void>
  createRecording: (request: CreateRecordingRequest) => Promise<RecordingSession>
  writeRecordingChunk: (sessionId: string, chunk: Uint8Array) => Promise<void>
  finishRecording: (sessionId: string) => Promise<string>
  abortRecording: (sessionId: string) => Promise<void>
  revealRecording: (filePath: string) => Promise<void>
}

