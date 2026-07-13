import { describe, expect, it, vi } from 'vitest'
import { LivePreviewController } from '../src/renderer/src/lib/live-preview'
import type { CaptureSource } from '../src/shared/contracts'

const source = (id: string): CaptureSource => ({
  id,
  name: id,
  type: 'window',
  thumbnailDataUrl: 'data:image/png;base64,',
  displayId: ''
})

function stream(): MediaStream {
  const stop = vi.fn()
  return {
    getTracks: () => [{ stop }]
  } as unknown as MediaStream
}

describe('LivePreviewController', () => {
  it('opens a video-only selected-source stream and releases it on stop', async () => {
    const preview = stream()
    const prepareCapture = vi.fn().mockResolvedValue(undefined)
    const getDisplayMedia = vi.fn().mockResolvedValue(preview)
    const onStream = vi.fn()
    const controller = new LivePreviewController({ prepareCapture, getDisplayMedia, onStream })

    await controller.show(source('window:42:0'))

    expect(prepareCapture).toHaveBeenCalledWith({
      sourceId: 'window:42:0',
      sourceType: 'window',
      displayId: '',
      includeSystemAudio: false
    })
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: expect.objectContaining({ cursor: 'never' })
    }))
    expect(onStream).toHaveBeenLastCalledWith(preview)

    await controller.stop()
    expect(preview.getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(onStream).toHaveBeenLastCalledWith(null)
  })

  it('discards an obsolete stream when the selected source changes during acquisition', async () => {
    let release!: (value: MediaStream) => void
    const obsolete = stream()
    const current = stream()
    const first = new Promise<MediaStream>((resolve) => { release = resolve })
    const getDisplayMedia = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(current)
    const onStream = vi.fn()
    const controller = new LivePreviewController({
      prepareCapture: vi.fn().mockResolvedValue(undefined),
      getDisplayMedia,
      onStream
    })

    const firstShow = controller.show(source('window:1:0'))
    while (getDisplayMedia.mock.calls.length === 0) await Promise.resolve()
    const secondShow = controller.show(source('window:2:0'))
    release(obsolete)
    await Promise.all([firstShow, secondShow])

    expect(obsolete.getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(onStream).not.toHaveBeenCalledWith(obsolete)
    expect(onStream).toHaveBeenLastCalledWith(current)
  })
})
