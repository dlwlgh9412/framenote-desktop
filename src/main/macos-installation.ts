export function requiresApplicationsInstall(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  isInApplicationsFolder: boolean
): boolean {
  return platform === 'darwin' && isPackaged && !isInApplicationsFolder
}
