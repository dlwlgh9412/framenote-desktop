import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const paths = vi.hoisted(() => ({
  userData: '',
  videos: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: 'userData' | 'videos') => paths[name]
  }
}))

import { PreferenceStore } from '../src/main/preference-store'

describe('PreferenceStore', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'framenote-preferences-'))
    paths.userData = root
    paths.videos = join(root, 'Videos')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('sanitizes invalid persisted fields instead of returning values that crash the UI', async () => {
    await writeFile(join(root, 'preferences.json'), JSON.stringify({
      outputDirectory: 42,
      recordingFormat: 'avi',
      codecPreference: 'mpeg2',
      storageMode: 'tiny',
      countdownSeconds: -30,
      qualityPreset: '8k',
      captureMode: 'broadcast',
      includeSystemAudio: 'yes',
      includeMicrophone: null,
      microphoneDeviceId: 42
    }))

    await expect(new PreferenceStore().get()).resolves.toEqual({
      outputDirectory: join(root, 'Videos', 'FrameNote'),
      recordingFormat: 'auto',
      codecPreference: 'auto',
      storageMode: 'balanced',
      countdownSeconds: 3,
      qualityPreset: 'balanced',
      captureMode: 'meeting',
      includeSystemAudio: true,
      includeMicrophone: true,
      microphoneDeviceId: ''
    })
  })

  it('preserves valid persisted fields while filling newly added defaults', async () => {
    await writeFile(join(root, 'preferences.json'), JSON.stringify({
      recordingFormat: 'webm',
      codecPreference: 'vp9',
      qualityPreset: 'ultra',
      includeMicrophone: false
    }))

    await expect(new PreferenceStore().get()).resolves.toMatchObject({
      recordingFormat: 'webm',
      codecPreference: 'vp9',
      storageMode: 'balanced',
      countdownSeconds: 3,
      qualityPreset: 'ultra',
      includeMicrophone: false
    })
  })

  it('falls back to defaults when the persisted JSON is truncated', async () => {
    await writeFile(join(root, 'preferences.json'), '{"qualityPreset":')

    await expect(new PreferenceStore().get()).resolves.toMatchObject({
      qualityPreset: 'balanced',
      captureMode: 'meeting'
    })
  })

  it('serializes concurrent updates so the shared temporary file cannot race', async () => {
    const store = new PreferenceStore()
    const updates = Array.from({ length: 20 }, (_, index) =>
      store.update({ microphoneDeviceId: `microphone-${index}` })
    )

    const results = await Promise.allSettled(updates)
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true)
    await expect(store.get()).resolves.toMatchObject({
      microphoneDeviceId: 'microphone-19'
    })
  })
})
