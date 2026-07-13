import { app, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { IPC_CHANNELS, type NativeSystemAudioRequest } from '../shared/contracts'
import {
  describeNativeAudioExit,
  FramedPcmParser,
  resolveNativeAudioTarget
} from './system-audio-capture'

const READY_TIMEOUT_MS = 15_000

function helperPath(): string {
  const executable = process.platform === 'win32'
    ? 'framenote-audio-capture.exe'
    : 'framenote-audio-capture'
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', executable)
    : join(
        app.getAppPath(),
        'build',
        'native',
        process.platform === 'win32' ? join('windows', process.arch) : 'macos',
        executable
      )
}

export class NativeSystemAudioManager {
  private child?: ChildProcessWithoutNullStreams
  private targetWebContents?: WebContents

  async start(request: NativeSystemAudioRequest, webContents: WebContents): Promise<void> {
    await this.stop()
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      throw new Error('Native application audio capture is not supported on this operating system.')
    }

    const target = resolveNativeAudioTarget(request)
    const child = spawn(
      helperPath(),
      ['--type', target.type, '--id', String(target.id)],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    )
    child.stdin.end()
    this.child = child
    this.targetWebContents = webContents
    const parser = new FramedPcmParser()

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child || webContents.isDestroyed()) return
      try {
        for (const frame of parser.push(chunk)) {
          webContents.send(IPC_CHANNELS.nativeSystemAudioData, frame)
        }
      } catch (error) {
        this.reportError(error)
        void this.stop()
      }
    })

    await new Promise<void>((resolve, reject) => {
      let stderrBuffer = ''
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        error ? reject(error) : resolve()
      }
      const timeout = setTimeout(() => {
        finish(new Error('시스템 오디오 캡처 도우미가 시작 시간 안에 응답하지 않았습니다.'))
      }, READY_TIMEOUT_MS)

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer = (stderrBuffer + chunk.toString('utf8')).slice(-16_384)
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line === 'READY') finish()
          if (line.startsWith('ERROR:')) {
            const message = line.slice('ERROR:'.length).trim()
            if (!settled) finish(new Error(message))
            else this.reportError(new Error(message))
          }
        }
      })
      child.once('error', (error) => finish(error))
      child.once('exit', (code, signal) => {
        const wasCurrentCapture = this.child === child
        const recipient = wasCurrentCapture ? this.targetWebContents : undefined
        const error = new Error(describeNativeAudioExit(code, signal))
        if (!settled) finish(error)
        else if (wasCurrentCapture && recipient && !recipient.isDestroyed()) {
          recipient.send(IPC_CHANNELS.nativeSystemAudioError, error.message)
        }
        if (this.child === child) {
          this.child = undefined
          this.targetWebContents = undefined
        }
      })
    }).catch(async (error) => {
      await this.stop()
      throw new Error(
        `선택한 화면 또는 앱의 소리를 캡처하지 못했습니다. 시스템 오디오 권한을 확인해 주세요. ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    this.targetWebContents = undefined
    if (!child || child.killed) return
    await new Promise<void>((resolve) => {
      let finished = false
      let forceTimeout: NodeJS.Timeout | undefined
      const finish = (): void => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        if (forceTimeout) clearTimeout(forceTimeout)
        resolve()
      }
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        forceTimeout = setTimeout(finish, 500)
      }, 1_500)
      child.once('exit', () => {
        finish()
      })
      child.kill('SIGTERM')
    })
  }

  private reportError(error: unknown): void {
    const webContents = this.targetWebContents
    if (!webContents || webContents.isDestroyed()) return
    webContents.send(
      IPC_CHANNELS.nativeSystemAudioError,
      error instanceof Error ? error.message : String(error)
    )
  }
}
