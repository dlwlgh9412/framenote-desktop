import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { APP_NAME } from '../shared/brand'
import { createDefaultPreferences, type AppPreferences } from '../shared/contracts'

const defaultPreferences = (): AppPreferences =>
  createDefaultPreferences(join(app.getPath('videos'), APP_NAME))

export class PreferenceStore {
  private readonly filePath = join(app.getPath('userData'), 'preferences.json')

  async get(): Promise<AppPreferences> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppPreferences>
      return { ...defaultPreferences(), ...value }
    } catch {
      return defaultPreferences()
    }
  }

  async update(patch: Partial<AppPreferences>): Promise<AppPreferences> {
    const next = { ...(await this.get()), ...patch }
    const temporaryPath = `${this.filePath}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
    return next
  }
}
