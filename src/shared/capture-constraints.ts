import type { CaptureSource } from './contracts'

export type CaptureVideoConstraints = MediaTrackConstraints & {
  cursor: 'always' | 'never'
}

export function getCaptureVideoConstraints(
  sourceType: CaptureSource['type'],
  width: number,
  height: number,
  frameRate: number
): CaptureVideoConstraints {
  return {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: frameRate, max: frameRate },
    cursor: sourceType === 'window' ? 'never' : 'always'
  }
}

