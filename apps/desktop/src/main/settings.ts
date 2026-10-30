import { nativeTheme } from 'electron'
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'settings'

export class SettingsStore {
  private settings: Settings
  private readonly listeners = new Set<(settings: Settings) => void>()

  constructor(private readonly kv: KeyValueRepo) {
    this.settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(kv.get(KEY)) }
    nativeTheme.themeSource = this.settings.theme
  }

  get(): Settings {
    return this.settings
  }

  set(patch: unknown): void {
    this.settings = { ...this.settings, ...sanitizeSettings(patch) }
    this.kv.set(KEY, this.settings)
    nativeTheme.themeSource = this.settings.theme
    for (const listener of this.listeners) listener(this.settings)
  }

  subscribe(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
