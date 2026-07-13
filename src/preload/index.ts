import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppPreferences,
  type CreateRecordingRequest,
  type PrepareCaptureRequest,
  type RecordingApi
} from '../shared/contracts'

const api: RecordingApi = {
  platform: process.platform,
  listSources: () => ipcRenderer.invoke(IPC_CHANNELS.listSources),
  getPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.getPermissions),
  requestMicrophonePermission: () => ipcRenderer.invoke(IPC_CHANNELS.requestMicrophonePermission),
  openPermissionSettings: (kind) => ipcRenderer.invoke(IPC_CHANNELS.openPermissionSettings, kind),
  getPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.getPreferences),
  updatePreferences: (patch: Partial<AppPreferences>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updatePreferences, patch),
  chooseOutputDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseOutputDirectory),
  openOutputDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.openOutputDirectory),
  prepareCapture: (request: PrepareCaptureRequest) => ipcRenderer.invoke(IPC_CHANNELS.prepareCapture, request),
  createRecording: (request: CreateRecordingRequest) => ipcRenderer.invoke(IPC_CHANNELS.createRecording, request),
  writeRecordingChunk: (sessionId, chunk) => ipcRenderer.invoke(IPC_CHANNELS.writeRecordingChunk, sessionId, chunk),
  finishRecording: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.finishRecording, sessionId),
  abortRecording: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.abortRecording, sessionId),
  revealRecording: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.revealRecording, filePath),
  onQuitRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.requestQuit, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.requestQuit, listener)
  },
  confirmReadyToQuit: () => ipcRenderer.send(IPC_CHANNELS.readyToQuit)
}

contextBridge.exposeInMainWorld('recordingApi', api)
