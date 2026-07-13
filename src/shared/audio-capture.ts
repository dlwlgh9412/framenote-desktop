import type { CaptureSource } from './contracts'

export const AUDIO_CAPTURE_MODES = ['all', 'system', 'microphone', 'none'] as const
export type AudioCaptureMode = (typeof AUDIO_CAPTURE_MODES)[number]
export type SystemAudioBackend = 'none' | 'electron-loopback' | 'native-content'

export function supportsSelectedApplicationAudio(
  platform: 'darwin' | 'win32' | 'other',
  kernelRelease: string
): boolean {
  const components = kernelRelease.split('.').map((value) => Number(value))
  if (components.some((value) => !Number.isFinite(value))) return false
  if (platform === 'darwin') {
    const [major = 0, minor = 0] = components
    return major > 23 || (major === 23 && minor >= 2)
  }
  if (platform === 'win32') return (components[2] ?? 0) >= 20_348
  return false
}

export function audioModePatch(mode: AudioCaptureMode): {
  includeSystemAudio: boolean
  includeMicrophone: boolean
} {
  return {
    includeSystemAudio: mode === 'all' || mode === 'system',
    includeMicrophone: mode === 'all' || mode === 'microphone'
  }
}

export function getAudioCaptureMode(
  includeSystemAudio: boolean,
  includeMicrophone: boolean
): AudioCaptureMode {
  if (includeSystemAudio && includeMicrophone) return 'all'
  if (includeSystemAudio) return 'system'
  if (includeMicrophone) return 'microphone'
  return 'none'
}

export function getSystemAudioBackend(
  platform: 'darwin' | 'win32' | 'other',
  sourceType: CaptureSource['type'],
  enabled: boolean,
  selectedApplicationAudioSupported = true
): SystemAudioBackend {
  if (!enabled) return 'none'
  if (sourceType === 'window' && !selectedApplicationAudioSupported) return 'none'
  if (platform === 'darwin') return 'native-content'
  if (platform === 'win32') {
    return sourceType === 'window' ? 'native-content' : 'electron-loopback'
  }
  return 'none'
}
