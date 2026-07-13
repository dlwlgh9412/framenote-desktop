import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppPreferences,
  CreateRecordingRequest,
  PrepareCaptureRequest,
  RecordingApi
} from '../shared/contracts'

const api: RecordingApi = {
  platform: process.platform,
  listSources: () => ipcRenderer.invoke('sources:list'),
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  requestMicrophonePermission: () => ipcRenderer.invoke('permissions:request-microphone'),
  openPermissionSettings: (kind) => ipcRenderer.invoke('permissions:open-settings', kind),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  updatePreferences: (patch: Partial<AppPreferences>) =>
    ipcRenderer.invoke('preferences:update', patch),
  chooseOutputDirectory: () => ipcRenderer.invoke('preferences:choose-directory'),
  openOutputDirectory: () => ipcRenderer.invoke('preferences:open-directory'),
  prepareCapture: (request: PrepareCaptureRequest) => ipcRenderer.invoke('capture:prepare', request),
  createRecording: (request: CreateRecordingRequest) => ipcRenderer.invoke('recording:create', request),
  writeRecordingChunk: (sessionId, chunk) => ipcRenderer.invoke('recording:write', sessionId, chunk),
  finishRecording: (sessionId) => ipcRenderer.invoke('recording:finish', sessionId),
  abortRecording: (sessionId) => ipcRenderer.invoke('recording:abort', sessionId),
  revealRecording: (filePath) => ipcRenderer.invoke('recording:reveal', filePath)
}

contextBridge.exposeInMainWorld('recordingApi', api)

