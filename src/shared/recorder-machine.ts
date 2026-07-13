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
  error?: string
}

export type RecorderEvent =
  | { type: 'start_requested' }
  | { type: 'capture_ready' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'saved'; filePath: string }
  | { type: 'failed'; message: string }
  | { type: 'reset' }

export const initialRecorderState: RecorderState = { status: 'idle' }

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
        ? { status: 'completed', filePath: event.filePath }
        : state
    case 'completed':
    case 'error':
      return state
  }
}

