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

export function mergeCaptureSourceVisuals(
  currentSources: CaptureSource[],
  nextSources: CaptureSource[],
  includeVisuals: boolean
): CaptureSource[] {
  if (includeVisuals) return nextSources
  const currentById = new Map(currentSources.map((source) => [source.id, source]))
  return nextSources.map((source) => {
    const current = currentById.get(source.id)
    return {
      ...source,
      thumbnailDataUrl: current?.thumbnailDataUrl ?? '',
      appIconDataUrl: current?.appIconDataUrl
    }
  })
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
