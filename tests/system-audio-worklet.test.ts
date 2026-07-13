import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface TestProcessor {
  chunks: Float32Array[]
  offset: number
  queuedSamples: number
  port: { onmessage?: (event: { data: Float32Array }) => void }
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean
}

async function loadProcessor(): Promise<new () => TestProcessor> {
  const source = await readFile(
    join(process.cwd(), 'src/renderer/public/system-audio-worklet.js'),
    'utf8'
  )
  let processor: (new () => TestProcessor) | undefined
  class MockAudioWorkletProcessor {
    port: { onmessage?: (event: { data: Float32Array }) => void } = {}
  }
  runInNewContext(source, {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    Float32Array,
    sampleRate: 48_000,
    registerProcessor: (_name: string, constructor: new () => TestProcessor) => {
      processor = constructor
    }
  })
  if (!processor) throw new Error('The audio worklet processor was not registered.')
  return processor
}

describe('native system audio worklet queue', () => {
  it('counts only unread samples when dropping a partially consumed chunk', async () => {
    const Processor = await loadProcessor()
    const processor = new Processor()
    processor.port.onmessage?.({ data: new Float32Array(8).fill(0.25) })
    processor.process([], [[new Float32Array(1), new Float32Array(1)]])

    const replacement = new Float32Array(200_000).fill(0.5)
    processor.port.onmessage?.({ data: replacement })

    expect(processor.offset).toBe(0)
    expect(processor.chunks).toHaveLength(1)
    expect(processor.queuedSamples).toBe(replacement.length)
  })
})
