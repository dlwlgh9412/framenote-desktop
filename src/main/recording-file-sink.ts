import { powerSaveBlocker } from 'electron'
import { mkdir, open, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import type { CaptureMode, RecordingExtension, RecordingSession } from '../shared/contracts'

interface OpenRecording {
  handle: FileHandle
  filePath: string
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
    const filePath = await this.availableFilePath(outputDirectory, extension, mode)
    const handle = await open(filePath, 'wx')
    const id = randomUUID()
    this.sessions.set(id, { handle, filePath })
    this.startPowerBlocker()
    return { id, filePath }
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
    this.sessions.delete(sessionId)
    this.stopPowerBlockerIfIdle()
    return recording.filePath
  }

  async abort(sessionId: string): Promise<void> {
    const recording = this.sessions.get(sessionId)
    if (!recording) return
    await recording.handle.close().catch(() => undefined)
    this.sessions.delete(sessionId)
    this.stopPowerBlockerIfIdle()
  }

  private requireSession(sessionId: string): OpenRecording {
    const recording = this.sessions.get(sessionId)
    if (!recording) throw new Error('Recording session was not found.')
    return recording
  }

  private async availableFilePath(
    outputDirectory: string,
    extension: RecordingExtension,
    mode: CaptureMode
  ): Promise<string> {
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
      try {
        await stat(candidate)
      } catch {
        return candidate
      }
    }

    throw new Error(`Could not allocate a recording file in ${basename(outputDirectory)}.`)
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
