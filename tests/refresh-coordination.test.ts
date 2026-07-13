import { describe, expect, it, vi } from 'vitest'
import { SingleFlight } from '../src/renderer/src/lib/single-flight'
import {
  shouldClearSourcesForPermissionChange,
  shouldRefreshSourcesForPermissionChange
} from '../src/renderer/src/lib/permission-refresh'

describe('SingleFlight', () => {
  it('coalesces concurrent refreshes and allows a later refresh after completion', async () => {
    let release!: () => void
    const firstOperation = new Promise<void>((resolve) => { release = resolve })
    const operation = vi.fn()
      .mockReturnValueOnce(firstOperation)
      .mockResolvedValueOnce(undefined)
    const gate = new SingleFlight()

    const first = gate.run(operation)
    const second = gate.run(operation)
    expect(second).toBe(first)
    expect(operation).toHaveBeenCalledTimes(1)

    release()
    await first
    await gate.run(operation)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('allows retry after a failed operation', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined)
    const gate = new SingleFlight()

    await expect(gate.run(operation)).rejects.toThrow('transient failure')
    await expect(gate.run(operation)).resolves.toBeUndefined()
    expect(operation).toHaveBeenCalledTimes(2)
  })
})

describe('shouldRefreshSourcesForPermissionChange', () => {
  it('refreshes thumbnails only when screen permission becomes granted', () => {
    expect(shouldRefreshSourcesForPermissionChange('denied', 'granted')).toBe(true)
    expect(shouldRefreshSourcesForPermissionChange('not-determined', 'granted')).toBe(true)
    expect(shouldRefreshSourcesForPermissionChange('granted', 'granted')).toBe(false)
    expect(shouldRefreshSourcesForPermissionChange('granted', 'denied')).toBe(false)
    expect(shouldRefreshSourcesForPermissionChange(undefined, 'granted')).toBe(false)
  })

  it('clears stale sources when a previously granted permission is revoked', () => {
    expect(shouldClearSourcesForPermissionChange('granted', 'denied')).toBe(true)
    expect(shouldClearSourcesForPermissionChange('granted', 'restricted')).toBe(true)
    expect(shouldClearSourcesForPermissionChange('granted', 'not-determined')).toBe(true)
    expect(shouldClearSourcesForPermissionChange('denied', 'denied')).toBe(false)
    expect(shouldClearSourcesForPermissionChange(undefined, 'denied')).toBe(false)
  })
})
