import type { AudioRecordingExtension } from './contracts'

export interface AudioExportProfile {
  mimeType: string
  extension: AudioRecordingExtension
  label: string
}

export const AUDIO_EXPORT_PROFILES: readonly AudioExportProfile[] = [
  {
    mimeType: 'audio/mp4;codecs=mp4a.40.2',
    extension: 'm4a',
    label: 'M4A · AAC'
  },
  {
    mimeType: 'audio/mp4',
    extension: 'm4a',
    label: 'M4A · AAC'
  },
  {
    mimeType: 'audio/webm;codecs=opus',
    extension: 'webm',
    label: 'WebM · Opus'
  },
  {
    mimeType: 'audio/webm',
    extension: 'webm',
    label: 'WebM · Opus'
  }
]

export function chooseAudioExportProfile(
  isSupported: (mimeType: string) => boolean
): AudioExportProfile {
  const profile = AUDIO_EXPORT_PROFILES.find(({ mimeType }) => isSupported(mimeType))
  if (!profile) {
    throw new Error('현재 기기에서 음성 파일을 저장할 수 있는 오디오 형식을 찾지 못했습니다.')
  }
  return profile
}
