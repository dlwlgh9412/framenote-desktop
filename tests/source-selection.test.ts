import { describe, expect, it } from 'vitest'
import {
  selectSourceIdForTab,
  shouldRunLivePreview
} from '../src/renderer/src/lib/source-selection'
import type { CaptureSource } from '../src/shared/contracts'

const sources = [
  { id: 'screen:1:0', name: 'Display', type: 'screen' },
  { id: 'window:2:0', name: 'First window', type: 'window' },
  { id: 'window:3:0', name: 'Second window', type: 'window' }
].map((source) => ({
  ...source,
  type: source.type as CaptureSource['type'],
  thumbnailDataUrl: 'data:image/png;base64,',
  displayId: ''
}))

describe('capture source selection', () => {
  it('selects the first source in a newly selected tab', () => {
    expect(selectSourceIdForTab(sources, 'window', 'screen:1:0')).toBe('window:2:0')
    expect(selectSourceIdForTab(sources, 'screen', 'window:2:0')).toBe('screen:1:0')
  })

  it('keeps an existing selection while refreshing the same tab', () => {
    expect(selectSourceIdForTab(sources, 'window', 'window:3:0')).toBe('window:3:0')
  })

  it('does not reopen a live capture after a recording is completed', () => {
    expect(shouldRunLivePreview('idle', true, true, false)).toBe(true)
    expect(shouldRunLivePreview('completed', true, true, false)).toBe(false)
    expect(shouldRunLivePreview('idle', false, true, false)).toBe(false)
  })
})

