import type { AppPreferences, CaptureSource } from '../../../shared/contracts'
import type { RecordingController, RecordingStartResult } from './recording-controller'

type RecordingStarter = Pick<RecordingController, 'start' | 'abort'>
type PreviewElement = Pick<HTMLVideoElement, 'play' | 'srcObject'>

export async function startRecordingWithPreview(
  controller: RecordingStarter,
  source: CaptureSource,
  preferences: AppPreferences,
  getPreview: () => PreviewElement | null
): Promise<RecordingStartResult> {
  let result: RecordingStartResult | undefined
  let preview: PreviewElement | null = null

  try {
    result = await controller.start(source, preferences)
    preview = getPreview()
    if (preview) {
      preview.srcObject = result.previewStream
      await preview.play()
    }
    return result
  } catch (error) {
    if (result) {
      try {
        await controller.abort()
      } catch {
        // Preserve the original startup error shown to the user.
      } finally {
        if (preview) preview.srcObject = null
      }
    }
    throw error
  }
}
