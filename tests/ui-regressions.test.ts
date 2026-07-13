import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop UI regressions', () => {
  it('keeps the settings close control visible while the modal scrolls', async () => {
    const styles = await readFile(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(styles).toMatch(/\.settings-modal__header\s*\{[^}]*position:\s*sticky/s)
    expect(styles).toMatch(/\.settings-modal__header\s*\{[^}]*top:\s*0/s)
  })

  it('uses generic audio wording and exposes a recording-preview visibility control', async () => {
    const app = await readFile(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    expect(app).not.toContain('Meet, Zoom과 재생 소리')
    expect(app).toContain('선택한 앱에서 재생되는 소리')
    expect(app).toContain('화면 미리보기 숨기기')
  })

  it('scales interface icons on large desktop layouts', async () => {
    const styles = await readFile(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(styles).toMatch(/@media \(min-width: 1600px\)[\s\S]*\.workspace svg[^}]*scale\(1\.15\)/)
  })
})
