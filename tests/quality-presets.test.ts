import { describe, expect, it } from 'vitest'
import { getQualityPreset } from '@shared/recording-settings'

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
      videoBitsPerSecond: 10_000_000
    })
    expect(getQualityPreset('smooth')).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 60,
      videoBitsPerSecond: 12_000_000
    })
  })
})
