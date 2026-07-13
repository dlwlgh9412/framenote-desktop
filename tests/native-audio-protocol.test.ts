import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  describeNativeAudioExit,
  FramedPcmParser,
  resolveNativeAudioTarget
} from '../src/main/system-audio-capture'
import type { NativeSystemAudioRequest } from '../src/shared/contracts'

describe('native audio target resolution', () => {
  it('uses the display id for a whole screen and the native window id for a window', () => {
    expect(resolveNativeAudioTarget({
      sourceId: 'screen:0:0', sourceType: 'screen', displayId: '734003213'
    })).toEqual({ type: 'screen', id: 734003213 })
    expect(resolveNativeAudioTarget({
      sourceId: 'window:4917:0', sourceType: 'window', displayId: ''
    })).toEqual({ type: 'window', id: 4917 })
  })

  it('rejects a source without a usable native identifier', () => {
    expect(() => resolveNativeAudioTarget({
      sourceId: 'screen:0:0', sourceType: 'screen', displayId: ''
    })).toThrow('display')
    expect(() => resolveNativeAudioTarget({
      sourceId: 'window:4917:0',
      sourceType: 'invalid' as NativeSystemAudioRequest['sourceType'],
      displayId: ''
    })).toThrow('type')
    expect(() => resolveNativeAudioTarget({
      sourceId: 'screen:0:0', sourceType: 'window', displayId: ''
    })).toThrow('window')
  })
})

describe('FramedPcmParser', () => {
  it('reassembles split length-prefixed Float32 PCM frames', () => {
    const samples = new Float32Array([0.25, -0.25, 0.5, -0.5])
    const header = Buffer.alloc(4)
    header.writeUInt32LE(samples.byteLength)
    const packet = Buffer.concat([header, Buffer.from(samples.buffer)])
    const parser = new FramedPcmParser()

    expect(parser.push(packet.subarray(0, 3))).toEqual([])
    expect(parser.push(packet.subarray(3, 9))).toEqual([])
    const frames = parser.push(packet.subarray(9))

    expect(frames).toHaveLength(1)
    expect(Array.from(frames[0])).toEqual(Array.from(samples))
  })

  it('rejects malformed or unbounded frame lengths', () => {
    const parser = new FramedPcmParser()
    const header = Buffer.alloc(4)
    header.writeUInt32LE(64 * 1024 * 1024)
    expect(() => parser.push(header)).toThrow('PCM frame')
  })
})

describe('native audio helper lifecycle', () => {
  it('treats even a clean unrequested helper exit as a capture failure', () => {
    expect(describeNativeAudioExit(0, null)).toContain('code 0')
    expect(describeNativeAudioExit(null, 'SIGKILL')).toContain('SIGKILL')
  })
})

describe('macOS ScreenCaptureKit helper bootstrap', () => {
  it('uses ScreenCaptureKit for a display and a Core Audio process tap for a window app', async () => {
    const source = await readFile(
      join(process.cwd(), 'native/macos/SystemAudioCapture.swift'),
      'utf8'
    )

    expect(source).toContain('import AppKit')
    expect(source).toContain('import CoreAudio')
    expect(source).toContain('NSApplication.shared')
    expect(source).toContain('AudioHardwareCreateProcessTap')
    expect(source).toContain('AudioHardwareCreateAggregateDevice')
    expect(source).toContain('processObjectIDs(descendingFrom: rootPID)')
    expect(source).toContain('monitorProcessAudio(descendingFrom: application.processID)')
    expect(source).not.toContain('has no active Core Audio process yet')
    expect(source).toContain('StereoLinearResampler')
    expect(source).toContain('outputSampleRate: 48_000')
    expect(source).toContain('maxPendingBytes')
    expect(source).toContain('queue.async')
    expect(source).not.toContain('desktopIndependentWindow')
    expect(source).not.toContain('including: [application]')
  })
})
