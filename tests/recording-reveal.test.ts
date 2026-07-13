import { describe, expect, it } from 'vitest'
import { resolveRecordingRevealTarget } from '../src/main/recording-reveal'

describe('recording reveal fallback', () => {
  it('selects the recording while it still exists', () => {
    expect(resolveRecordingRevealTarget('/videos/session.mp4', true)).toEqual({
      path: '/videos/session.mp4',
      selectFile: true
    })
  })

  it('opens the original recording directory after the recording was moved', () => {
    expect(resolveRecordingRevealTarget('/videos/session.mp4', false)).toEqual({
      path: '/videos',
      selectFile: false
    })
  })
})
