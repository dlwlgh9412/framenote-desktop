import {
  RECORDING_EXTENSIONS,
  isCodecPreference,
  isCountdownSeconds,
  isQualityPresetId,
  isRecordingFormatPreference,
  isStorageModeId,
  type CodecPreference,
  type CountdownSeconds,
  type QualityPresetId,
  type RecordingFormatPreference,
  type StorageModeId,
  type RecordingExtension
} from './recording-settings'

export const CAPTURE_MODES = ['meeting', 'screen'] as const
export type CaptureMode = (typeof CAPTURE_MODES)[number]

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
  recordingFormat: RecordingFormatPreference
  codecPreference: CodecPreference
  storageMode: StorageModeId
  countdownSeconds: CountdownSeconds
  qualityPreset: QualityPresetId
  captureMode: CaptureMode
  includeSystemAudio: boolean
  includeMicrophone: boolean
  microphoneDeviceId: string
}

export function createDefaultPreferences(outputDirectory: string): AppPreferences {
  return {
    outputDirectory,
    recordingFormat: 'auto',
    codecPreference: 'auto',
    storageMode: 'balanced',
    countdownSeconds: 3,
    qualityPreset: 'balanced',
    captureMode: 'meeting',
    includeSystemAudio: true,
    includeMicrophone: true,
    microphoneDeviceId: ''
  }
}

export function isCaptureMode(value: unknown): value is CaptureMode {
  return typeof value === 'string' && CAPTURE_MODES.includes(value as CaptureMode)
}

export function isRecordingExtension(value: unknown): value is RecordingExtension {
  return typeof value === 'string' && RECORDING_EXTENSIONS.includes(value as RecordingExtension)
}

function isPreferenceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizePreferencePatch(value: unknown): Partial<AppPreferences> {
  if (!isPreferenceRecord(value)) return {}
  const safe: Partial<AppPreferences> = {}
  if (isRecordingFormatPreference(value.recordingFormat)) {
    safe.recordingFormat = value.recordingFormat
  }
  if (isCodecPreference(value.codecPreference)) safe.codecPreference = value.codecPreference
  if (isStorageModeId(value.storageMode)) safe.storageMode = value.storageMode
  if (isCountdownSeconds(value.countdownSeconds)) safe.countdownSeconds = value.countdownSeconds
  if (isQualityPresetId(value.qualityPreset)) safe.qualityPreset = value.qualityPreset
  if (isCaptureMode(value.captureMode)) safe.captureMode = value.captureMode
  if (typeof value.includeSystemAudio === 'boolean') {
    safe.includeSystemAudio = value.includeSystemAudio
  }
  if (typeof value.includeMicrophone === 'boolean') {
    safe.includeMicrophone = value.includeMicrophone
  }
  if (typeof value.microphoneDeviceId === 'string' && value.microphoneDeviceId.length <= 512) {
    safe.microphoneDeviceId = value.microphoneDeviceId
  }
  return safe
}

export function normalizeAppPreferences(
  defaults: AppPreferences,
  value: unknown
): AppPreferences {
  if (!isPreferenceRecord(value)) return defaults
  const outputDirectory = typeof value.outputDirectory === 'string' &&
    value.outputDirectory.trim().length > 0 &&
    value.outputDirectory.length <= 4_096
    ? value.outputDirectory
    : defaults.outputDirectory
  return {
    ...defaults,
    ...sanitizePreferencePatch(value),
    outputDirectory
  }
}

export interface PermissionSnapshot {
  screen: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
  microphone: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
  systemAudio: 'granted' | 'restricted' | 'unknown'
  systemAudioSupported: boolean
  platform: 'darwin' | 'win32' | 'other'
}

export type PermissionSettingsKind = 'screen' | 'microphone' | 'systemAudio'

export interface PrepareCaptureRequest {
  sourceId: string
  sourceType: CaptureSource['type']
  displayId: string
  includeSystemAudio: boolean
}

export interface NativeSystemAudioRequest {
  sourceId: string
  sourceType: CaptureSource['type']
  displayId: string
}

export interface CreateRecordingRequest {
  extension: RecordingExtension
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
  openPermissionSettings: (kind: PermissionSettingsKind) => Promise<void>
  resetScreenPermission: () => Promise<void>
  getPreferences: () => Promise<AppPreferences>
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<AppPreferences>
  chooseOutputDirectory: () => Promise<AppPreferences>
  openOutputDirectory: () => Promise<void>
  prepareCapture: (request: PrepareCaptureRequest) => Promise<void>
  startNativeSystemAudio: (request: NativeSystemAudioRequest) => Promise<void>
  stopNativeSystemAudio: () => Promise<void>
  onNativeSystemAudioData: (callback: (samples: Float32Array) => void) => () => void
  onNativeSystemAudioError: (callback: (message: string) => void) => () => void
  createRecording: (request: CreateRecordingRequest) => Promise<RecordingSession>
  writeRecordingChunk: (sessionId: string, chunk: Uint8Array) => Promise<void>
  finishRecording: (sessionId: string) => Promise<string>
  abortRecording: (sessionId: string) => Promise<void>
  revealRecording: (filePath: string) => Promise<void>
  onQuitRequested: (callback: () => void) => () => void
  confirmReadyToQuit: () => void
}

export type { RecordingExtension }

export const IPC_CHANNELS = {
  listSources: 'sources:list',
  getPermissions: 'permissions:get',
  requestMicrophonePermission: 'permissions:request-microphone',
  openPermissionSettings: 'permissions:open-settings',
  resetScreenPermission: 'permissions:reset-screen',
  getPreferences: 'preferences:get',
  updatePreferences: 'preferences:update',
  chooseOutputDirectory: 'preferences:choose-directory',
  openOutputDirectory: 'preferences:open-directory',
  prepareCapture: 'capture:prepare',
  startNativeSystemAudio: 'system-audio:start-native',
  stopNativeSystemAudio: 'system-audio:stop-native',
  nativeSystemAudioData: 'system-audio:native-data',
  nativeSystemAudioError: 'system-audio:native-error',
  createRecording: 'recording:create',
  writeRecordingChunk: 'recording:write',
  finishRecording: 'recording:finish',
  abortRecording: 'recording:abort',
  revealRecording: 'recording:reveal',
  requestQuit: 'app:request-quit',
  readyToQuit: 'app:ready-to-quit'
} as const
