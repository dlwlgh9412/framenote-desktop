import type { NativeSystemAudioRequest } from '../shared/contracts'

const MAX_PCM_FRAME_BYTES = 4 * 1024 * 1024

export interface NativeAudioTarget {
  type: NativeSystemAudioRequest['sourceType']
  id: number
}

export function describeNativeAudioExit(
  code: number | null,
  signal: NodeJS.Signals | null
): string {
  return `시스템 오디오 캡처가 종료되었습니다 (${signal ?? `code ${code ?? 'unknown'}`}).`
}

export function resolveNativeAudioTarget(request: NativeSystemAudioRequest | unknown): NativeAudioTarget {
  if (typeof request !== 'object' || request === null) {
    throw new Error('Invalid native audio capture request.')
  }
  const candidate = request as Partial<NativeSystemAudioRequest>
  if (candidate.sourceType !== 'screen' && candidate.sourceType !== 'window') {
    throw new Error('Invalid native audio source type.')
  }
  if (typeof candidate.sourceId !== 'string' || typeof candidate.displayId !== 'string') {
    throw new Error('Invalid native audio source identifiers.')
  }

  if (candidate.sourceType === 'screen') {
    const id = Number(candidate.displayId)
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('The selected display does not expose a native display id.')
    }
    return { type: 'screen', id }
  }

  const match = /^window:(\d+):/.exec(candidate.sourceId)
  const id = Number(match?.[1])
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('The selected window does not expose a native window id.')
  }
  return { type: 'window', id }
}

export class FramedPcmParser {
  private buffered = Buffer.alloc(0)

  push(chunk: Uint8Array): Float32Array[] {
    this.buffered = Buffer.concat([
      this.buffered,
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    ])
    const frames: Float32Array[] = []

    while (this.buffered.byteLength >= 4) {
      const byteLength = this.buffered.readUInt32LE(0)
      if (byteLength === 0 || byteLength > MAX_PCM_FRAME_BYTES || byteLength % 4 !== 0) {
        throw new Error(`Invalid native PCM frame length: ${byteLength}.`)
      }
      if (this.buffered.byteLength < byteLength + 4) break
      const payload = this.buffered.subarray(4, byteLength + 4)
      const copy = new Uint8Array(byteLength)
      copy.set(payload)
      frames.push(new Float32Array(copy.buffer))
      this.buffered = this.buffered.subarray(byteLength + 4)
    }
    return frames
  }
}
