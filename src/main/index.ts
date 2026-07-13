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
import { mkdir } from 'node:fs/promises'
import { release } from 'node:os'
import {
  IPC_CHANNELS,
  isCaptureMode,
  isRecordingExtension,
  type AppPreferences,
  type CreateRecordingRequest,
  type PermissionSettingsKind,
  type PermissionSnapshot,
  type PrepareCaptureRequest
} from '../shared/contracts'
import { isCodecPreference, isQualityPresetId } from '../shared/recording-settings'
import { requiresApplicationsInstall } from './macos-installation'
import { PreferenceStore } from './preference-store'
import { RecordingFileSink } from './recording-file-sink'

let mainWindow: BrowserWindow | null = null
let pendingCapture: PrepareCaptureRequest | null = null
let allowWindowClose = false
let closePromptOpen = false
const preferenceStore = new PreferenceStore()
const fileSink = new RecordingFileSink()

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
    title: 'Meeting Capture 설치',
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
      message: 'Meeting Capture를 응용 프로그램 폴더로 직접 옮겨 주세요.',
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
      audio: capture.includeSystemAudio ? 'loopback' : undefined
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

function sanitizePreferencePatch(patch: Partial<AppPreferences>): Partial<AppPreferences> {
  const safe: Partial<AppPreferences> = {}
  if (isCodecPreference(patch.codecPreference)) {
    safe.codecPreference = patch.codecPreference
  }
  if (isQualityPresetId(patch.qualityPreset)) {
    safe.qualityPreset = patch.qualityPreset
  }
  if (isCaptureMode(patch.captureMode)) {
    safe.captureMode = patch.captureMode
  }
  if (typeof patch.includeSystemAudio === 'boolean') safe.includeSystemAudio = patch.includeSystemAudio
  if (typeof patch.includeMicrophone === 'boolean') safe.includeMicrophone = patch.includeMicrophone
  if (typeof patch.microphoneDeviceId === 'string' && patch.microphoneDeviceId.length <= 512) {
    safe.microphoneDeviceId = patch.microphoneDeviceId
  }
  return safe
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.listSources, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 384, height: 216 },
      fetchWindowIcons: true
    })
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnailDataUrl: source.thumbnail.toDataURL(),
      appIconDataUrl: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
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

  ipcMain.handle(IPC_CHANNELS.createRecording, async (_event, request: CreateRecordingRequest) => {
    if (!isRecordingExtension(request.extension)) throw new Error('Unsupported file extension.')
    if (!isCaptureMode(request.mode)) throw new Error('Unsupported capture mode.')
    const preferences = await preferenceStore.get()
    return fileSink.create(preferences.outputDirectory, request.extension, request.mode)
  })
  ipcMain.handle(IPC_CHANNELS.writeRecordingChunk, (_event, sessionId: string, chunk: Uint8Array) =>
    chunk instanceof Uint8Array && chunk.byteLength <= 64 * 1024 * 1024
      ? fileSink.write(sessionId, chunk)
      : Promise.reject(new Error('Invalid recording chunk.'))
  )
  ipcMain.handle(IPC_CHANNELS.finishRecording, (_event, sessionId: string) => fileSink.finish(sessionId))
  ipcMain.handle(IPC_CHANNELS.abortRecording, (_event, sessionId: string) => fileSink.abort(sessionId))
  ipcMain.handle(IPC_CHANNELS.revealRecording, (_event, filePath: string) => shell.showItemInFolder(filePath))
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

  app.setAppUserModelId('com.meetingcapture.app')
  registerCaptureHandler()
  registerPermissionHandlers()
  registerIpc()
  createWindow()

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
