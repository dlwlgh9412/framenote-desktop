import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { APP_NAME } from '../shared/brand'
import {
  createDefaultPreferences,
  normalizeAppPreferences,
  type AppPreferences
} from '../shared/contracts'

const defaultPreferences = (): AppPreferences =>
  createDefaultPreferences(join(app.getPath('videos'), APP_NAME))

export class PreferenceStore {
  private readonly filePath = join(app.getPath('userData'), 'preferences.json')
  private updateTail: Promise<void> = Promise.resolve()

  async get(): Promise<AppPreferences> {
    try {
      return normalizeAppPreferences(
        defaultPreferences(),
        JSON.parse(await readFile(this.filePath, 'utf8'))
      )
    } catch {
      return defaultPreferences()
    }
  }

  update(patch: Partial<AppPreferences>): Promise<AppPreferences> {
    const operation = this.updateTail.then(() => this.performUpdate(patch))
    this.updateTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async performUpdate(patch: Partial<AppPreferences>): Promise<AppPreferences> {
    const current = await this.get()
    const next = normalizeAppPreferences(current, { ...current, ...patch })
    const temporaryPath = `${this.filePath}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
    return next
  }
}
