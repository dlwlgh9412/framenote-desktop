import { powerSaveBlocker } from 'electron'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import type { CaptureMode, RecordingExtension, RecordingSession } from '../shared/contracts'

interface OpenRecording {
  handle: FileHandle
  filePath: string
  partialPath: string
}

export class RecordingFileSink {
  private readonly sessions = new Map<string, OpenRecording>()
  private powerBlockerId: number | undefined

  get hasActiveRecordings(): boolean {
    return this.sessions.size > 0
  }

  async create(
    outputDirectory: string,
    extension: RecordingExtension,
    mode: CaptureMode
  ): Promise<RecordingSession> {
    await mkdir(outputDirectory, { recursive: true })
    const recording = await this.openAvailableRecording(outputDirectory, extension, mode)
    const id = randomUUID()
    this.sessions.set(id, recording)
    this.startPowerBlocker()
    return { id, filePath: recording.filePath }
  }

  async write(sessionId: string, data: Uint8Array): Promise<void> {
    const recording = this.requireSession(sessionId)
    let offset = 0
    while (offset < data.byteLength) {
      const { bytesWritten } = await recording.handle.write(data, offset, data.byteLength - offset)
      if (bytesWritten === 0) throw new Error('The recording file stopped accepting data.')
      offset += bytesWritten
    }
  }

  async finish(sessionId: string): Promise<string> {
    const recording = this.requireSession(sessionId)
    await recording.handle.sync()
    await recording.handle.close()
    try {
      await rename(recording.partialPath, recording.filePath)
    } catch (error) {
      this.releaseSession(sessionId)
      const detail = error instanceof Error ? ` ${error.message}` : ''
      throw new Error(
        `녹화 데이터는 보존했지만 최종 파일로 게시하지 못했습니다: ${recording.partialPath}.${detail}`
      )
    }
    this.releaseSession(sessionId)
    return recording.filePath
  }

  async abort(sessionId: string): Promise<void> {
    const recording = this.sessions.get(sessionId)
    if (!recording) return
    await recording.handle.close().catch(() => undefined)
    try {
      await unlink(recording.partialPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    } finally {
      this.releaseSession(sessionId)
    }
  }

  private requireSession(sessionId: string): OpenRecording {
    const recording = this.sessions.get(sessionId)
    if (!recording) throw new Error('Recording session was not found.')
    return recording
  }

  private async openAvailableRecording(
    outputDirectory: string,
    extension: RecordingExtension,
    mode: CaptureMode
  ): Promise<OpenRecording> {
    const now = new Date()
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-') + '_' + [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('-')
    const prefix = mode === 'meeting' ? 'Meeting' : 'Screen'

    for (let index = 0; index < 1_000; index += 1) {
      const suffix = index === 0 ? '' : `_${index + 1}`
      const candidate = join(outputDirectory, `${prefix}_${timestamp}${suffix}.${extension}`)
      if (await this.pathExists(candidate)) continue
      const partialPath = `${candidate}.partial`
      try {
        const handle = await open(partialPath, 'wx')
        return { handle, filePath: candidate, partialPath }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }

    throw new Error(`Could not allocate a recording file in ${basename(outputDirectory)}.`)
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private releaseSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.stopPowerBlockerIfIdle()
  }

  private startPowerBlocker(): void {
    if (this.powerBlockerId === undefined || !powerSaveBlocker.isStarted(this.powerBlockerId)) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
  }

  private stopPowerBlockerIfIdle(): void {
    if (this.sessions.size === 0 && this.powerBlockerId !== undefined) {
      if (powerSaveBlocker.isStarted(this.powerBlockerId)) powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = undefined
    }
  }
}
