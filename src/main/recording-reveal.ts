export interface RecordingRevealTarget {
  path: string
  selectFile: boolean
}

export function resolveRecordingRevealTarget(
  recordedFilePath: string,
  recordedFileExists: boolean
): RecordingRevealTarget {
  return recordedFileExists
    ? { path: recordedFilePath, selectFile: true }
    : { path: dirname(recordedFilePath), selectFile: false }
}
import { dirname } from 'node:path'
