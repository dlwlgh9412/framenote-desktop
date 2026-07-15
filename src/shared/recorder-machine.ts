export type RecorderStatus =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'completed'
  | 'error'

export interface RecorderState {
  status: RecorderStatus
  filePath?: string
  audioFilePath?: string
  error?: string
}

export type RecorderEvent =
  | { type: 'start_requested' }
  | { type: 'capture_ready' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'saved'; filePath: string; audioFilePath?: string }
  | { type: 'failed'; message: string }
  | { type: 'reset' }

export const initialRecorderState: RecorderState = { status: 'idle' }

const activeStatuses: ReadonlySet<RecorderStatus> = new Set([
  'preparing',
  'recording',
  'paused',
  'finalizing'
])

export const RECORDER_STATUS_LABELS: Record<RecorderStatus, string> = {
  idle: '준비됨',
  preparing: '준비 중',
  recording: '녹화 중',
  paused: '일시정지',
  finalizing: '저장 중',
  completed: '준비됨',
  error: '준비됨'
}

export function isRecorderActive(state: RecorderState): boolean {
  return activeStatuses.has(state.status)
}

export function canStopRecorder(state: RecorderState): boolean {
  return state.status === 'recording' || state.status === 'paused'
}

export function controlsAreLocked(state: RecorderState): boolean {
  return state.status === 'preparing' || state.status === 'finalizing'
}

export function transitionRecorder(state: RecorderState, event: RecorderEvent): RecorderState {
  if (event.type === 'failed') return { status: 'error', error: event.message }
  if (event.type === 'reset') return initialRecorderState

  switch (state.status) {
    case 'idle':
      return event.type === 'start_requested' ? { status: 'preparing' } : state
    case 'preparing':
      return event.type === 'capture_ready' ? { status: 'recording' } : state
    case 'recording':
      if (event.type === 'pause') return { status: 'paused' }
      if (event.type === 'stop') return { status: 'finalizing' }
      return state
    case 'paused':
      if (event.type === 'resume') return { status: 'recording' }
      if (event.type === 'stop') return { status: 'finalizing' }
      return state
    case 'finalizing':
      return event.type === 'saved'
        ? {
            status: 'completed',
            filePath: event.filePath,
            audioFilePath: event.audioFilePath
          }
        : state
    case 'completed':
    case 'error':
      return state
  }
}
