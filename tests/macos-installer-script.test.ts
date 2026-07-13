import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import packageMetadata from '../package.json'

describe('macOS installer image', () => {
  it('places a PKG installer in the DMG instead of requiring a manual app drag', async () => {
    const script = await readFile(join(process.cwd(), 'scripts/package-macos-adhoc.sh'), 'utf8')
    const releaseScript = await readFile(
      join(process.cwd(), 'scripts/package-macos-release.sh'),
      'utf8'
    )
    const workflow = await readFile(join(process.cwd(), '.github/workflows/build.yml'), 'utf8')

    expect(script).toContain('productbuild')
    expect(script).toContain('.pkg')
    expect(script).not.toContain('ln -s /Applications')
    expect(script).toContain('--requirements')
    expect(script).toContain('MinuteFramePermissionIdentity')
    expect(script).toContain('helper_id="$app_id.audio-capture"')
    expect(script).toContain('identifier \"$helper_id\"')
    expect(script).toContain('cursor_policy_path=')
    expect(script).toContain('"$cursor_policy_path"')
    expect(releaseScript).toContain('verify-macos-bundle.sh')
    expect(packageMetadata.scripts['package:mac']).toBe('./scripts/package-macos-release.sh')
    expect(packageMetadata.scripts['package:mac:adhoc']).toBe('./scripts/package-macos-adhoc.sh')
    expect(releaseScript).toContain('productbuild --sign')
    expect(releaseScript).toContain('notarytool submit')
    expect(releaseScript).toContain('stapler staple')
    expect(releaseScript).not.toContain('identity=null')
    expect(workflow).toContain('MAC_INSTALLER_CSC_LINK')
    expect(workflow).toContain('MAC_INSTALLER_CSC_KEY_PASSWORD')
    expect(workflow).toContain('security import')
    expect(workflow).toContain('Developer ID Installer:')
  })
})
