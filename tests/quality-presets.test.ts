import { describe, expect, it } from 'vitest'
import {
  estimateMegabytesPerHour,
  getEncodingPlan,
  getEncodingPreview,
  getQualityPreset
} from '@shared/recording-settings'

describe('getQualityPreset', () => {
  it('maps the default meeting preset to balanced 1080p recording constraints', () => {
    expect(getQualityPreset('balanced')).toEqual({
      id: 'balanced',
      label: '균형',
      detail: '회의 녹화 권장',
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 192_000
    })
  })

  it('offers efficient, detailed, and smooth trade-off presets', () => {
    expect(getQualityPreset('efficient')).toMatchObject({
      width: 1280,
      height: 720,
      frameRate: 30,
      videoBitsPerSecond: 3_000_000
    })
    expect(getQualityPreset('detailed')).toMatchObject({
      width: 2560,
      height: 1440,
      frameRate: 30,
      videoBitsPerSecond: 16_000_000
    })
    expect(getQualityPreset('smooth')).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 60,
      videoBitsPerSecond: 12_000_000
    })
  })

  it('offers a 4K preset for high-resolution screens', () => {
    expect(getQualityPreset('ultra')).toMatchObject({
      width: 3840,
      height: 2160,
      frameRate: 30,
      videoBitsPerSecond: 32_000_000
    })
  })

  it('reduces target bitrate for compact VP9 recordings and estimates their size', () => {
    const compact4k = getEncodingPlan('ultra', 'compact', 'vp9')
    const balanced4k = getEncodingPlan('ultra', 'balanced', 'h264')

    expect(compact4k.videoBitsPerSecond).toBe(16_100_000)
    expect(compact4k.audioBitsPerSecond).toBe(128_000)
    expect(compact4k.estimatedMegabytesPerHour).toBe(
      estimateMegabytesPerHour(16_100_000, 128_000)
    )
    expect(compact4k.estimatedMegabytesPerHour).toBeLessThan(
      balanced4k.estimatedMegabytesPerHour
    )
  })

  it('uses the supported automatic codec for the shared size preview', () => {
    const preview = getEncodingPreview({
      recordingFormat: 'auto',
      codecPreference: 'auto',
      qualityPreset: 'ultra',
      storageMode: 'compact'
    }, (mimeType) => mimeType.includes('vp9'))

    expect(preview.codec).toBe('vp9')
    expect(preview.supported).toBe(true)
    expect(preview.plan.videoBitsPerSecond).toBe(16_100_000)
  })
})
