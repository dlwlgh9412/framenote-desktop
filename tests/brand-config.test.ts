import { describe, expect, it } from 'vitest'
import packageMetadata from '../package.json'
import { APP_ID, APP_NAME } from '@shared/brand'

describe('brand configuration', () => {
  it('keeps runtime and package identity aligned', () => {
    expect(APP_ID).toBe(packageMetadata.build.appId)
    expect(APP_NAME).toBe(packageMetadata.build.productName)
  })
})
