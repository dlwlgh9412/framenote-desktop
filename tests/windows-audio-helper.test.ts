import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('Windows selected-application audio helper', () => {
  it('uses the official process-loopback API and resolves the selected HWND to a process', async () => {
    const source = await readFile(
      join(process.cwd(), 'native/windows/SystemAudioCapture.cpp'),
      'utf8'
    )

    expect(source).toContain('GetWindowThreadProcessId')
    expect(source).toContain('AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK')
    expect(source).toContain('PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE')
    expect(source).toContain('VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK')
    expect(source).toContain('ActivateAudioInterfaceAsync')
  })

  it('builds and bundles an architecture-matched helper in Windows packages', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))

    expect(packageJson.scripts['build:win-audio']).toBeTruthy()
    expect(packageJson.scripts['package:win']).toContain('build:win-audio')
    expect(packageJson.build.win.extraResources[0].from).toContain('${arch}')
  })
})
