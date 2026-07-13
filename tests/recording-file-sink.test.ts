import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const blocker = vi.hoisted(() => ({ started: new Set<number>(), nextId: 1 }))
vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: () => {
      const id = blocker.nextId++
      blocker.started.add(id)
      return id
    },
    isStarted: (id: number) => blocker.started.has(id),
    stop: (id: number) => blocker.started.delete(id)
  }
}))

import { RecordingFileSink } from '../src/main/recording-file-sink'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('RecordingFileSink', () => {
  let outputDirectory: string

  beforeEach(async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), 'minuteframe-recording-'))
    blocker.started.clear()
  })

  afterEach(async () => {
    await rm(outputDirectory, { recursive: true, force: true })
  })

  it('keeps an in-progress recording visibly partial and atomically publishes it on finish', async () => {
    const sink = new RecordingFileSink()
    const session = await sink.create(outputDirectory, 'mp4', 'screen')

    expect(await exists(session.filePath)).toBe(false)
    expect(await exists(`${session.filePath}.partial`)).toBe(true)

    await sink.write(session.id, new Uint8Array([1, 2, 3, 4]))
    await expect(sink.finish(session.id)).resolves.toBe(session.filePath)
    expect(await readFile(session.filePath)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(await exists(`${session.filePath}.partial`)).toBe(false)
    expect(sink.hasActiveRecordings).toBe(false)
    expect(blocker.started.size).toBe(0)
  })

  it('removes a controlled-abort partial file instead of leaving a broken normal recording', async () => {
    const sink = new RecordingFileSink()
    const session = await sink.create(outputDirectory, 'webm', 'meeting')
    await sink.write(session.id, new Uint8Array([9, 8, 7]))

    await sink.abort(session.id)

    expect(await exists(session.filePath)).toBe(false)
    expect(await exists(`${session.filePath}.partial`)).toBe(false)
    expect(sink.hasActiveRecordings).toBe(false)
    expect(blocker.started.size).toBe(0)
  })

  it('preserves the synchronized partial file if publishing the final name fails', async () => {
    const sink = new RecordingFileSink()
    const session = await sink.create(outputDirectory, 'mp4', 'meeting')
    await sink.write(session.id, new Uint8Array([5, 4, 3, 2, 1]))
    await mkdir(session.filePath)

    await expect(sink.finish(session.id)).rejects.toThrow('.partial')
    expect(await readFile(`${session.filePath}.partial`)).toEqual(Buffer.from([5, 4, 3, 2, 1]))
    expect(sink.hasActiveRecordings).toBe(false)
    expect(blocker.started.size).toBe(0)

    await sink.abort(session.id)
    expect(await exists(`${session.filePath}.partial`)).toBe(true)
  })
})
