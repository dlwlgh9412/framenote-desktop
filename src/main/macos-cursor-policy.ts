import { join } from 'node:path'

const CURSOR_POLICY_FILENAME = 'minuteframe-cursor-policy.node'

export function resolveMacosCursorPolicyPath(
  isPackaged: boolean,
  appPath: string,
  resourcesPath: string
): string {
  return isPackaged
    ? join(resourcesPath, 'bin', CURSOR_POLICY_FILENAME)
    : join(appPath, 'build', 'native', 'macos', CURSOR_POLICY_FILENAME)
}

export function loadMacosCursorPolicy(
  platform: NodeJS.Platform,
  path: string,
  loader: (path: string) => unknown
): boolean {
  if (platform !== 'darwin') return false
  const loaded = loader(path)
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    !('installed' in loaded) ||
    loaded.installed !== true
  ) {
    throw new Error('The native macOS window cursor policy hook was not installed.')
  }
  return true
}
