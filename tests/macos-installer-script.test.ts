import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import packageMetadata from '../package.json'

describe('macOS installer image', () => {
  it('places a PKG installer in the DMG instead of requiring a manual app drag', async () => {
    const script = await readFile(join(process.cwd(), 'scripts/package-macos-adhoc.sh'), 'utf8')

    expect(script).toContain('productbuild')
    expect(script).toContain('.pkg')
    expect(script).not.toContain('ln -s /Applications')
    expect(script).toContain('--requirements')
    expect(script).toContain('MinuteFramePermissionIdentity')
    expect(script).toContain('helper_id="$app_id.audio-capture"')
    expect(script).toContain('identifier \"$helper_id\"')
    expect(packageMetadata.scripts['package:mac']).toBe('./scripts/package-macos-adhoc.sh')
  })
})
