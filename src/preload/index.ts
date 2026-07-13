import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AppPreferences,
  type CreateRecordingRequest,
  type ListSourcesRequest,
  type PrepareCaptureRequest,
  type RecordingApi
} from '../shared/contracts'

const api: RecordingApi = {
  platform: process.platform,
  listSources: (request?: ListSourcesRequest) => ipcRenderer.invoke(IPC_CHANNELS.listSources, request),
  getPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.getPermissions),
  requestMicrophonePermission: () => ipcRenderer.invoke(IPC_CHANNELS.requestMicrophonePermission),
  openPermissionSettings: (kind) => ipcRenderer.invoke(IPC_CHANNELS.openPermissionSettings, kind),
  resetScreenPermission: () => ipcRenderer.invoke(IPC_CHANNELS.resetScreenPermission),
  getPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.getPreferences),
  updatePreferences: (patch: Partial<AppPreferences>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updatePreferences, patch),
  chooseOutputDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseOutputDirectory),
  openOutputDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.openOutputDirectory),
  prepareCapture: (request: PrepareCaptureRequest) => ipcRenderer.invoke(IPC_CHANNELS.prepareCapture, request),
  startNativeSystemAudio: (request) => ipcRenderer.invoke(IPC_CHANNELS.startNativeSystemAudio, request),
  stopNativeSystemAudio: () => ipcRenderer.invoke(IPC_CHANNELS.stopNativeSystemAudio),
  onNativeSystemAudioData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, samples: Float32Array): void => callback(samples)
    ipcRenderer.on(IPC_CHANNELS.nativeSystemAudioData, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.nativeSystemAudioData, listener)
  },
  onNativeSystemAudioError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on(IPC_CHANNELS.nativeSystemAudioError, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.nativeSystemAudioError, listener)
  },
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
