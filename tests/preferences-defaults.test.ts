import { describe, expect, it } from 'vitest'
import { createDefaultPreferences } from '../src/shared/contracts'

describe('createDefaultPreferences', () => {
  it('defaults to compatible automatic recording with balanced storage and countdown', () => {
    expect(createDefaultPreferences('/tmp/MinuteFrame')).toMatchObject({
      recordingFormat: 'auto',
      codecPreference: 'auto',
      storageMode: 'balanced',
      countdownSeconds: 3,
      qualityPreset: 'balanced'
    })
  })
})
