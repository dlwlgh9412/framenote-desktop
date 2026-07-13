import type { CaptureSource } from '../../../shared/contracts'
import type { RecorderStatus } from '../../../shared/recorder-machine'

export function selectSourceIdForTab(
  sources: CaptureSource[],
  tab: CaptureSource['type'],
  currentId: string
): string {
  const current = sources.find(({ id, type }) => id === currentId && type === tab)
  return current?.id ?? sources.find(({ type }) => type === tab)?.id ?? ''
}

export function shouldRunLivePreview(
  status: RecorderStatus,
  requested: boolean,
  hasSource: boolean,
  needsScreenPermission: boolean
): boolean {
  return requested && hasSource && !needsScreenPermission &&
    (status === 'idle' || status === 'error')
}

