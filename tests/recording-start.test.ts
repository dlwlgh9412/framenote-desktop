import { describe, expect, it, vi } from 'vitest'
import { startRecordingWithPreview } from '../src/renderer/src/lib/recording-start'
import type { AppPreferences } from '../src/shared/contracts'
import type { RecordingStartResult } from '../src/renderer/src/lib/recording-controller'

const preferences = {
  recordingFormat: 'auto',
  codecPreference: 'auto',
  storageMode: 'balanced',
  countdownSeconds: 0,
  qualityPreset: 'balanced',
  captureMode: 'screen',
  includeSystemAudio: false,
  includeMicrophone: false,
  microphoneDeviceId: '',
  outputDirectory: '/tmp'
} satisfies AppPreferences

function recordingResult(): RecordingStartResult {
  return {
    previewStream: {} as MediaStream,
    filePath: '/tmp/recording.mp4',
    codec: {
      id: 'h264',
      label: 'H.264 / AAC',
      detail: 'MP4용 범용 코덱',
      mimeTypes: ['video/mp4'],
      mimeType: 'video/mp4',
      extension: 'mp4',
      bitrateFactor: 1
    },
    hasSystemAudio: false,
    hasMicrophone: false
  }
}

describe('startRecordingWithPreview', () => {
  it('aborts the recorder and detaches the stream if preview playback fails after capture started', async () => {
    const result = recordingResult()
    const controller = {
      start: vi.fn().mockResolvedValue(result),
      abort: vi.fn().mockResolvedValue(undefined)
    }
    const preview = {
      srcObject: null as MediaProvider | null,
      play: vi.fn().mockRejectedValue(new DOMException('preview failed', 'NotSupportedError'))
    }

    await expect(startRecordingWithPreview(controller, 'screen:1', preferences, () => preview))
      .rejects.toThrow('preview failed')
    expect(controller.abort).toHaveBeenCalledOnce()
    expect(preview.srcObject).toBeNull()
  })

  it('returns the capture result without stopping when preview starts normally', async () => {
    const result = recordingResult()
    const controller = {
      start: vi.fn().mockResolvedValue(result),
      abort: vi.fn()
    }
    const preview = {
      srcObject: null as MediaProvider | null,
      play: vi.fn().mockResolvedValue(undefined)
    }

    await expect(startRecordingWithPreview(controller, 'screen:1', preferences, () => preview))
      .resolves.toBe(result)
    expect(controller.abort).not.toHaveBeenCalled()
    expect(preview.srcObject).toBe(result.previewStream)
  })
})
