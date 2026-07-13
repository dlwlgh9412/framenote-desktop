import { describe, expect, it } from 'vitest'
import { chooseCodec, CODEC_PROFILES } from '@shared/recording-settings'

describe('chooseCodec', () => {
  it('uses MP4 H.264/AAC first when automatic compatibility mode is selected', () => {
    const supported = new Set([
      CODEC_PROFILES.h264.mimeType,
      CODEC_PROFILES.vp9.mimeType,
      CODEC_PROFILES.vp8.mimeType
    ])

    expect(chooseCodec('auto', (mimeType) => supported.has(mimeType))).toEqual(
      CODEC_PROFILES.h264
    )
  })
})

