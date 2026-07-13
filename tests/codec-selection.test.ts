import { describe, expect, it } from 'vitest'
import {
  chooseCodec,
  CODEC_PROFILES,
  getCompatibleCodecs,
  isCodecSupported
} from '@shared/recording-settings'

describe('chooseCodec', () => {
  it('uses MP4 H.264/AAC first when automatic compatibility mode is selected', () => {
    const supported = new Set(Object.values(CODEC_PROFILES).flatMap(({ mimeTypes }) => mimeTypes))

    expect(chooseCodec('auto', 'auto', (mimeType) => supported.has(mimeType))).toMatchObject({
      id: 'h264',
      extension: 'mp4',
      mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
    })
  })

  it('uses a high-level H.264 profile only for high-resolution plans', () => {
    expect(chooseCodec('mp4', 'h264', () => true, {
      preferHighQualityH264: true
    }).mimeType).toBe('video/mp4;codecs=avc1.640033,mp4a.40.2')
  })

  it('keeps file format and codec as separate constraints', () => {
    expect(getCompatibleCodecs('mp4')).toEqual(['h264'])
    expect(getCompatibleCodecs('webm')).toEqual(['vp9', 'vp8'])

    expect(chooseCodec('webm', 'auto', () => true)).toMatchObject({
      id: 'vp9',
      extension: 'webm'
    })
    expect(() => chooseCodec('mp4', 'vp9', () => true)).toThrow(
      'MP4 파일 형식에서는 H.264 코덱만 사용할 수 있습니다.'
    )
  })

  it('tries compatible MIME variants for the selected codec', () => {
    const fallbackMime = CODEC_PROFILES.h264.mimeTypes.at(-1)!
    expect(isCodecSupported('h264', (mimeType) => mimeType === fallbackMime)).toBe(true)
    expect(chooseCodec('mp4', 'h264', (mimeType) => mimeType === fallbackMime).mimeType)
      .toBe(fallbackMime)
  })

  it('does not silently replace a codec that the user selected explicitly', () => {
    expect(() => chooseCodec('auto', 'h264', () => false)).toThrow(
      '선택한 H.264 / AAC 코덱을 현재 기기에서 사용할 수 없습니다.'
    )
  })
})
