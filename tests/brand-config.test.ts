import { describe, expect, it } from 'vitest'
import packageMetadata from '../package.json'
import { APP_ID, APP_NAME, LEGACY_APP_IDS } from '@shared/brand'

describe('brand configuration', () => {
  it('keeps runtime and package identity aligned', () => {
    expect(APP_NAME).toBe('FrameNote')
    expect(APP_ID).toBe('com.framenote.app')
    expect(APP_ID).toBe(packageMetadata.build.appId)
    expect(APP_NAME).toBe(packageMetadata.build.productName)
    expect(packageMetadata.build.artifactName).toBe('FrameNote-${version}-${os}-${arch}.${ext}')
    expect(LEGACY_APP_IDS).toContain('com.minuteframe.app')
  })
})
