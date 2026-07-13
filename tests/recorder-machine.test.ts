import { describe, expect, it } from 'vitest'
import { initialRecorderState, transitionRecorder } from '@shared/recorder-machine'

describe('transitionRecorder', () => {
  it('follows the complete start, pause, resume, and save flow', () => {
    const preparing = transitionRecorder(initialRecorderState, { type: 'start_requested' })
    const recording = transitionRecorder(preparing, { type: 'capture_ready' })
    const paused = transitionRecorder(recording, { type: 'pause' })
    const resumed = transitionRecorder(paused, { type: 'resume' })
    const finalizing = transitionRecorder(resumed, { type: 'stop' })
    const completed = transitionRecorder(finalizing, {
      type: 'saved',
      filePath: '/recordings/meeting.mp4'
    })

    expect([
      preparing.status,
      recording.status,
      paused.status,
      resumed.status,
      finalizing.status,
      completed.status
    ]).toEqual(['preparing', 'recording', 'paused', 'recording', 'finalizing', 'completed'])
    expect(completed.filePath).toBe('/recordings/meeting.mp4')
  })
})

