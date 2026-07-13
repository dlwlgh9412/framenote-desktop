import { describe, expect, it } from 'vitest'
import {
  audioModePatch,
  getAudioCaptureMode,
  getSystemAudioBackend
} from '../src/shared/audio-capture'

describe('audio capture modes', () => {
  it('maps explicit modes to independent system/app and microphone switches', () => {
    expect(audioModePatch('all')).toEqual({ includeSystemAudio: true, includeMicrophone: true })
    expect(audioModePatch('system')).toEqual({ includeSystemAudio: true, includeMicrophone: false })
    expect(audioModePatch('microphone')).toEqual({ includeSystemAudio: false, includeMicrophone: true })
    expect(audioModePatch('none')).toEqual({ includeSystemAudio: false, includeMicrophone: false })
  })

  it('derives the selected mode from persisted independent switches', () => {
    expect(getAudioCaptureMode(true, true)).toBe('all')
    expect(getAudioCaptureMode(true, false)).toBe('system')
    expect(getAudioCaptureMode(false, true)).toBe('microphone')
    expect(getAudioCaptureMode(false, false)).toBe('none')
  })
})

describe('system audio backend', () => {
  it('uses content-filtered native capture for macOS screens and windows', () => {
    expect(getSystemAudioBackend('darwin', 'screen', true)).toBe('native-content')
    expect(getSystemAudioBackend('darwin', 'window', true)).toBe('native-content')
  })

  it('uses Windows loopback for a whole screen and process capture for one window', () => {
    expect(getSystemAudioBackend('win32', 'screen', true)).toBe('electron-loopback')
    expect(getSystemAudioBackend('win32', 'window', true)).toBe('native-content')
  })

  it('does not start a system backend when app/system sound is disabled', () => {
    expect(getSystemAudioBackend('darwin', 'window', false)).toBe('none')
    expect(getSystemAudioBackend('win32', 'screen', false)).toBe('none')
  })
})
