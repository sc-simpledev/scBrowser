import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings'
import { LOCAL_SETTINGS } from './sync'

const KIND = 'scterra-settings'

/** Settings that belong to this computer, like folders and panel widths, stay out of a backup, as they do out of sync. */
const portable = (settings: Partial<Settings>): Partial<Settings> =>
  Object.fromEntries(Object.entries(settings).filter(([key]) => !LOCAL_SETTINGS.includes(key as keyof Settings))) as Partial<Settings>

/** What Export settings writes: plain JSON, readable and holding no keys or passwords, as none are settings. */
export function settingsFile(settings: Settings, at = Date.now()) {
  return { kind: KIND, version: 1, exportedAt: new Date(at).toISOString(), settings: portable(settings) }
}

/** The settings in an exported file, checked one by one, or null if it isn't one. Unknown or bad values are dropped. */
export function settingsFromFile(json: unknown): Partial<Settings> | null {
  const file = json as { kind?: unknown; settings?: unknown } | null
  if (typeof file !== 'object' || file === null || file.kind !== KIND) return null
  return portable(sanitizeSettings(file.settings))
}

/** Whether a setting differs from what scTerra starts with. */
export const isChangedSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[key])
