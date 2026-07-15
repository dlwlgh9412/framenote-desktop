import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
  systemPreferences
} from 'electron'
import { join } from 'node:path'
import { access, mkdir } from 'node:fs/promises'
import { release } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { APP_ID, APP_NAME, LEGACY_APP_IDS } from '../shared/brand'
import {
  getSystemAudioBackend,
  supportsSelectedApplicationAudio
} from '../shared/audio-capture'
import {
  IPC_CHANNELS,
  isAudioRecordingExtension,
  isCaptureMode,
  isRecordingArtifactKind,
  isRecordingFileExtension,
  isRecordingExtension,
  sanitizePreferencePatch,
  type AppPreferences,
  type CreateRecordingRequest,
  type ListSourcesRequest,
  type NativeSystemAudioRequest,
  type PermissionSettingsKind,
  type PermissionSnapshot,
  type PrepareCaptureRequest
} from '../shared/contracts'
import { requiresApplicationsInstall } from './macos-installation'
import { loadMacosCursorPolicy, resolveMacosCursorPolicyPath } from './macos-cursor-policy'
import { NativeSystemAudioManager } from './native-system-audio-manager'
import { PreferenceStore } from './preference-store'
import { RecordingFileSink } from './recording-file-sink'
import { resolveRecordingRevealTarget } from './recording-reveal'

app.setName(APP_NAME)

let mainWindow: BrowserWindow | null = null
let pendingCapture: PrepareCaptureRequest | null = null
let allowWindowClose = false
let closePromptOpen = false
let nativeAudioShutdownStarted = false
const preferenceStore = new PreferenceStore()
const fileSink = new RecordingFileSink()
const nativeSystemAudio = new NativeSystemAudioManager()
const execFileAsync = promisify(execFile)
const OPEN_SCREEN_PERMISSION_SETTINGS_ARG = '--open-screen-permission-settings'

if (process.platform === 'darwin') {
  const cursorPolicyPath = resolveMacosCursorPolicyPath(
    app.isPackaged,
    app.getAppPath(),
    process.resourcesPath
  )
  try {
    loadMacosCursorPolicy(process.platform, cursorPolicyPath, (path) => require(path))
  } catch (error) {
    console.error('macOS window cursor policy could not be loaded.', error)
  }
}

function screenPermissionSettingsUrl(): string {
  return 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'
}

async function ensureStableMacInstallation(): Promise<boolean> {
  if (
    !requiresApplicationsInstall(
      process.platform,
      app.isPackaged,
      process.platform === 'darwin' && app.isInApplicationsFolder()
    )
  ) {
    return true
  }

  const result = await dialog.showMessageBox({
    type: 'info',
    title: `${APP_NAME} 설치`,
    message: '화면 기록 권한을 유지하려면 먼저 앱을 설치해야 합니다.',
    detail:
      'DMG에서 직접 실행하면 macOS 권한 요청이 반복될 수 있습니다. 응용 프로그램 폴더로 이동한 뒤 자동으로 다시 실행합니다.',
    buttons: ['응용 프로그램으로 이동', '종료'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })

  if (result.response !== 0) {
    app.quit()
    return false
  }

  try {
    if (app.moveToApplicationsFolder({ conflictHandler: () => true })) {
      return false
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: '앱을 이동하지 못했습니다',
      message: `${APP_NAME}를 응용 프로그램 폴더로 직접 옮겨 주세요.`,
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['확인']
    })
    app.quit()
    return false
  }

  await dialog.showMessageBox({
    type: 'warning',
    title: '설치가 취소되었습니다',
    message: '앱을 응용 프로그램 폴더로 옮긴 뒤 다시 실행해 주세요.',
    buttons: ['확인']
  })
  app.quit()
  return false
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f6f8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.on('close', async (event) => {
    if (allowWindowClose || !fileSink.hasActiveRecordings) return
    event.preventDefault()
    if (closePromptOpen) return
    closePromptOpen = true
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: '녹화를 종료할까요?',
      message: '현재 녹화가 진행 중입니다.',
      detail: '앱을 닫으면 현재 파일이 정상적으로 마무리되지 않을 수 있습니다.',
      buttons: ['계속 녹화', '저장 후 종료'],
      cancelId: 0,
      defaultId: 0
    })
    closePromptOpen = false
    if (result.response === 1) {
      mainWindow?.webContents.send(IPC_CHANNELS.requestQuit)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerCaptureHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const capture = pendingCapture
    pendingCapture = null
    if (!capture) {
      callback({})
      return
    }

    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const source = sources.find(({ id }) => id === capture.sourceId)
    if (!source) {
      callback({})
      return
    }

    callback({
      video: source,
      audio: getSystemAudioBackend(
        platformName(),
        capture.sourceType,
        capture.includeSystemAudio,
        supportsSelectedApplicationAudio(platformName(), release())
      ) === 'electron-loopback'
        ? 'loopback'
        : undefined
    })
  })
}

function registerPermissionHandlers(): void {
  const isTrustedCapturePermission = (permission: string): boolean =>
    permission === 'media' || permission === 'display-capture'
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return isTrustedCapturePermission(permission) && webContents?.id === mainWindow?.webContents.id
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedCapturePermission(permission) && webContents.id === mainWindow?.webContents.id)
  })
}

function platformName(): PermissionSnapshot['platform'] {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  return 'other'
}

function permissionStatus(kind: 'screen' | 'microphone'): PermissionSnapshot['screen'] {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus(kind)
}

function supportsSystemAudio(): boolean {
  if (process.platform === 'win32') return true
  if (process.platform !== 'darwin') return false
  return Number(release().split('.')[0]) >= 22
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.listSources, async (_event, request?: ListSourcesRequest) => {
    const includeVisuals = request?.includeVisuals !== false
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: includeVisuals ? { width: 384, height: 216 } : { width: 0, height: 0 },
      fetchWindowIcons: includeVisuals
    })
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnailDataUrl: includeVisuals ? source.thumbnail.toDataURL() : '',
      appIconDataUrl: includeVisuals && !source.appIcon?.isEmpty()
        ? source.appIcon?.toDataURL()
        : undefined,
      displayId: source.display_id
    }))
  })

  ipcMain.handle(IPC_CHANNELS.getPermissions, (): PermissionSnapshot => ({
    screen: permissionStatus('screen'),
    microphone: permissionStatus('microphone'),
    systemAudio: process.platform === 'darwin'
      ? 'unknown'
      : supportsSystemAudio() ? 'granted' : 'restricted',
    systemAudioSupported: supportsSystemAudio(),
    selectedApplicationAudioSupported: supportsSelectedApplicationAudio(
      platformName(),
      release()
    ),
    platform: platformName()
  }))

  ipcMain.handle(IPC_CHANNELS.requestMicrophonePermission, async () => {
    if (process.platform !== 'darwin') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle(IPC_CHANNELS.openPermissionSettings, async (_event, kind: unknown) => {
    if (process.platform !== 'darwin') return
    const panes: Record<PermissionSettingsKind, string> = {
      screen: 'Privacy_ScreenCapture',
      microphone: 'Privacy_Microphone',
      systemAudio: 'Privacy_AudioCapture'
    }
    if (typeof kind !== 'string' || !Object.hasOwn(panes, kind)) return
    await shell.openExternal(
      `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${panes[kind as PermissionSettingsKind]}`
    )
  })

  ipcMain.handle(IPC_CHANNELS.resetScreenPermission, async () => {
    if (process.platform !== 'darwin') return
    if (fileSink.hasActiveRecordings) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: '녹화를 먼저 종료해 주세요',
        message: '녹화 중에는 화면 기록 권한을 초기화할 수 없습니다.',
        detail: '현재 녹화를 안전하게 저장한 뒤 다시 시도해 주세요.',
        buttons: ['확인']
      })
      return
    }
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: '화면 기록 권한 다시 연결',
      message: '기존 화면 기록 권한 연결을 초기화할까요?',
      detail:
        '앱 업데이트 후 권한을 켜도 인식되지 않을 때 사용하세요. 앱이 재실행되고 macOS 설정에서 한 번 다시 허용해야 합니다.',
      buttons: ['초기화하고 재실행', '취소'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (result.response !== 0) return

    const resetResults = await Promise.allSettled(
      [APP_ID, ...LEGACY_APP_IDS].map((bundleId) =>
        execFileAsync('/usr/bin/tccutil', ['reset', 'ScreenCapture', bundleId])
      )
    )
    if (resetResults.every(({ status }) => status === 'rejected')) {
      const firstFailure = resetResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      await dialog.showMessageBox(mainWindow!, {
        type: 'error',
        title: '권한을 초기화하지 못했습니다',
        message: 'macOS 화면 기록 권한을 변경하지 못했습니다.',
        detail: firstFailure?.reason instanceof Error
          ? firstFailure.reason.message
          : String(firstFailure?.reason ?? '알 수 없는 오류'),
        buttons: ['확인']
      })
      return
    }
    const args = process.argv
      .slice(1)
      .filter((argument) => argument !== OPEN_SCREEN_PERMISSION_SETTINGS_ARG)
      .concat(OPEN_SCREEN_PERMISSION_SETTINGS_ARG)
    app.relaunch({ args })
    app.exit(0)
  })

  ipcMain.handle(IPC_CHANNELS.getPreferences, () => preferenceStore.get())
  ipcMain.handle(IPC_CHANNELS.updatePreferences, (_event, patch: Partial<AppPreferences>) =>
    preferenceStore.update(sanitizePreferencePatch(patch))
  )
  ipcMain.handle(IPC_CHANNELS.chooseOutputDirectory, async () => {
    const current = await preferenceStore.get()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '녹화 저장 폴더 선택',
      defaultPath: current.outputDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return current
    return preferenceStore.update({ outputDirectory: result.filePaths[0] })
  })
  ipcMain.handle(IPC_CHANNELS.openOutputDirectory, async () => {
    const { outputDirectory } = await preferenceStore.get()
    await mkdir(outputDirectory, { recursive: true })
    const error = await shell.openPath(outputDirectory)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC_CHANNELS.prepareCapture, (_event, request: PrepareCaptureRequest) => {
    pendingCapture = request
  })
  ipcMain.handle(
    IPC_CHANNELS.startNativeSystemAudio,
    (event, request: NativeSystemAudioRequest) => nativeSystemAudio.start(request, event.sender)
  )
  ipcMain.handle(IPC_CHANNELS.stopNativeSystemAudio, () => nativeSystemAudio.stop())

  ipcMain.handle(IPC_CHANNELS.createRecording, async (_event, request: CreateRecordingRequest) => {
    if (!isRecordingFileExtension(request.extension)) throw new Error('Unsupported file extension.')
    if (!isCaptureMode(request.mode)) throw new Error('Unsupported capture mode.')
    if (!isRecordingArtifactKind(request.artifact)) throw new Error('Unsupported recording artifact.')
    if (request.artifact === 'video' && !isRecordingExtension(request.extension)) {
      throw new Error('Unsupported video file extension.')
    }
    if (request.artifact === 'audio' && !isAudioRecordingExtension(request.extension)) {
      throw new Error('Unsupported audio file extension.')
    }
    const preferences = await preferenceStore.get()
    return fileSink.create(
      preferences.outputDirectory,
      request.extension,
      request.mode,
      request.artifact
    )
  })
  ipcMain.handle(IPC_CHANNELS.writeRecordingChunk, (_event, sessionId: string, chunk: Uint8Array) =>
    chunk instanceof Uint8Array && chunk.byteLength <= 64 * 1024 * 1024
      ? fileSink.write(sessionId, chunk)
      : Promise.reject(new Error('Invalid recording chunk.'))
  )
  ipcMain.handle(IPC_CHANNELS.finishRecording, (_event, sessionId: string) => fileSink.finish(sessionId))
  ipcMain.handle(IPC_CHANNELS.abortRecording, (_event, sessionId: string) => fileSink.abort(sessionId))
  ipcMain.handle(IPC_CHANNELS.revealRecording, async (_event, filePath: string) => {
    const fileExists = await access(filePath).then(() => true).catch(() => false)
    const target = resolveRecordingRevealTarget(filePath, fileExists)
    if (target.selectFile) {
      shell.showItemInFolder(target.path)
      return
    }
    await mkdir(target.path, { recursive: true })
    const error = await shell.openPath(target.path)
    if (error) throw new Error(error)
  })
  ipcMain.on(IPC_CHANNELS.readyToQuit, (event) => {
    if (event.sender.id !== mainWindow?.webContents.id) return
    allowWindowClose = true
    app.quit()
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.whenReady().then(async () => {
  if (!(await ensureStableMacInstallation())) return

  app.setAppUserModelId(APP_ID)
  registerCaptureHandler()
  registerPermissionHandlers()
  registerIpc()
  createWindow()

  if (process.argv.includes(OPEN_SCREEN_PERMISSION_SETTINGS_ARG)) {
    setTimeout(() => void shell.openExternal(screenPermissionSettingsUrl()), 1_200)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (nativeAudioShutdownStarted) return
  event.preventDefault()
  nativeAudioShutdownStarted = true
  void nativeSystemAudio.stop().finally(() => app.quit())
})
