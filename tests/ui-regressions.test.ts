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

  it('hides quality metadata when an individual card is too narrow', async () => {
    const styles = await readFile(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(styles).toMatch(/\.quality-grid button\s*\{[^}]*container-type:\s*inline-size/s)
    expect(styles).toMatch(/\.quality-grid button\s*\{[^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(
      /@container[^\{]*\(max-width:\s*72px\)[\s\S]*\.quality-grid button span\s*\{[^}]*display:\s*none/s
    )
  })

  it('keeps recording controls evenly aligned and responsive', async () => {
    const styles = await readFile(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(styles).toMatch(
      /\.active-controls\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s
    )
    expect(styles).toMatch(/@container \(min-width:\s*350px\)[\s\S]*\.active-controls button/s)
  })

  it('opens the output directory from the path overflow button', async () => {
    const app = await readFile(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    expect(app).toMatch(
      /className="more-button"[\s\S]*?openOutputDirectory\(\)[\s\S]*?aria-label="저장 폴더 열기"/
    )
  })

  it('shows the selected quality resolution and frame rate below the presets', async () => {
    const app = await readFile(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    expect(app).toContain('className="quality-selection"')
    expect(app).toContain('{quality.width} × {quality.height}')
    expect(app).toContain('{quality.frameRate} fps')
  })

  it('offers optional audio extraction and reveals the completed audio file', async () => {
    const app = await readFile(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    expect(app).toContain('음성 파일 추출')
    expect(app).toContain('saveAudioFile: !preferences.saveAudioFile')
    expect(app).toContain('recorderState.audioFilePath')
    expect(app).toContain('음성 보기')
  })
})
