import type { RecordingApi } from '../../shared/contracts'

declare global {
  interface Window {
    recordingApi: RecordingApi
  }
}

export {}

