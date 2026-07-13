import { describe, expect, it } from 'vitest'
import { requiresApplicationsInstall } from '../src/main/macos-installation'

describe('requiresApplicationsInstall', () => {
  it('requires packaged macOS builds to run from an Applications folder', () => {
    expect(requiresApplicationsInstall('darwin', true, false)).toBe(true)
  })

  it('does not interrupt local macOS development', () => {
    expect(requiresApplicationsInstall('darwin', false, false)).toBe(false)
  })

  it('does not apply macOS installation rules to Windows', () => {
    expect(requiresApplicationsInstall('win32', true, false)).toBe(false)
  })

  it('allows packaged macOS builds already installed in Applications', () => {
    expect(requiresApplicationsInstall('darwin', true, true)).toBe(false)
  })
})
