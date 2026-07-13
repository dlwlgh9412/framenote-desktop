import { describe, expect, it } from 'vitest'
import { getCaptureVideoConstraints } from '../src/shared/capture-constraints'

describe('capture cursor policy', () => {
  it('hides the pointer in an application-window recording', () => {
    expect(getCaptureVideoConstraints('window', 2560, 1440, 30)).toMatchObject({
      cursor: 'never',
      width: { ideal: 2560 },
      height: { ideal: 1440 }
    })
  })

  it('keeps the pointer visible for a whole-screen recording', () => {
    expect(getCaptureVideoConstraints('screen', 1920, 1080, 30)).toMatchObject({
      cursor: 'always'
    })
  })
})

