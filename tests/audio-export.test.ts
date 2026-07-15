import { describe, expect, it } from 'vitest'
import { chooseAudioExportProfile } from '../src/shared/audio-export'

describe('chooseAudioExportProfile', () => {
  it('prefers a broadly playable M4A/AAC audio file', () => {
    const profile = chooseAudioExportProfile(() => true)

    expect(profile).toMatchObject({
      mimeType: 'audio/mp4;codecs=mp4a.40.2',
      extension: 'm4a',
      label: 'M4A · AAC'
    })
  })

  it('falls back to WebM/Opus when audio-only MP4 is unavailable', () => {
    const profile = chooseAudioExportProfile((mimeType) => mimeType.includes('webm;codecs=opus'))

    expect(profile).toMatchObject({
      mimeType: 'audio/webm;codecs=opus',
      extension: 'webm',
      label: 'WebM · Opus'
    })
  })

  it('reports when no audio-only encoder is available', () => {
    expect(() => chooseAudioExportProfile(() => false)).toThrow('오디오 형식')
  })
})
