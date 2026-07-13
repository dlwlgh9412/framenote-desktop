import { describe, expect, it } from 'vitest'
import { createDefaultPreferences } from '../src/shared/contracts'

describe('createDefaultPreferences', () => {
  it('defaults to compatible automatic recording with balanced storage and countdown', () => {
    expect(createDefaultPreferences('/tmp/FrameNote')).toMatchObject({
      recordingFormat: 'auto',
      codecPreference: 'auto',
      storageMode: 'balanced',
      audioQuality: 'standard',
      countdownSeconds: 3,
      qualityPreset: 'balanced'
    })
  })
})
