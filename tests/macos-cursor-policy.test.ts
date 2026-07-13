import { describe, expect, it, vi } from 'vitest'
import {
  loadMacosCursorPolicy,
  resolveMacosCursorPolicyPath
} from '../src/main/macos-cursor-policy'

describe('macOS window cursor policy', () => {
  it('loads the development native module only on macOS', () => {
    const loader = vi.fn()
    const path = resolveMacosCursorPolicyPath(false, '/app', '/resources')

    expect(loadMacosCursorPolicy('darwin', path, loader)).toBe(true)
    expect(loader).toHaveBeenCalledWith('/app/build/native/macos/minuteframe-cursor-policy.node')
  })

  it('resolves the packaged resource and leaves other platforms untouched', () => {
    const loader = vi.fn()
    const path = resolveMacosCursorPolicyPath(true, '/app', '/resources')

    expect(path).toBe('/resources/bin/minuteframe-cursor-policy.node')
    expect(loadMacosCursorPolicy('win32', path, loader)).toBe(false)
    expect(loader).not.toHaveBeenCalled()
  })
})
