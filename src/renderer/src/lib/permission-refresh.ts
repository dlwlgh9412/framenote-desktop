import type { PermissionSnapshot } from '../../../shared/contracts'

type ScreenPermission = PermissionSnapshot['screen']

export function shouldRefreshSourcesForPermissionChange(
  previous: ScreenPermission | undefined,
  next: ScreenPermission
): boolean {
  return previous !== undefined && previous !== 'granted' && next === 'granted'
}

export function shouldClearSourcesForPermissionChange(
  previous: ScreenPermission | undefined,
  next: ScreenPermission
): boolean {
  return previous === 'granted' && next !== 'granted'
}
