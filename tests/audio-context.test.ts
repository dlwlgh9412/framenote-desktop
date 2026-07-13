import { describe, expect, it, vi } from 'vitest'
import { ensureAudioContextRunning } from '../src/renderer/src/lib/recording-controller'

describe('ensureAudioContextRunning', () => {
  it('resumes a suspended audio graph before recording starts', async () => {
    const context = {
      state: 'suspended' as AudioContextState,
      resume: vi.fn().mockResolvedValue(undefined)
    }

    await ensureAudioContextRunning(context)

    expect(context.resume).toHaveBeenCalledOnce()
  })

  it('does not resume an audio graph that is already running', async () => {
    const context = {
      state: 'running' as AudioContextState,
      resume: vi.fn().mockResolvedValue(undefined)
    }

    await ensureAudioContextRunning(context)

    expect(context.resume).not.toHaveBeenCalled()
  })
})
