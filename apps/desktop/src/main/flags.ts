import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { BROWSER_FLAGS } from '@scbrowser/shared'

const path = () => join(app.getPath('userData'), 'flags.json')

/** Kept in a plain file because flags must apply before the database or app are ready. */
export function readFlags(): string[] {
  try {
    const saved = JSON.parse(readFileSync(path(), 'utf8')) as unknown
    return Array.isArray(saved) ? saved.filter((id) => BROWSER_FLAGS.some((flag) => flag.id === id)) : []
  } catch {
    return []
  }
}

export function setFlag(id: string, enabled: boolean): void {
  if (!BROWSER_FLAGS.some((flag) => flag.id === id)) throw new Error('Unknown flag')
  const others = readFlags().filter((flag) => flag !== id)
  writeFileSync(path(), JSON.stringify(enabled ? [...others, id] : others))
}

/** Must run before the app is ready. */
export function applyFlags(): void {
  const flags = readFlags()
  if (flags.includes('no-gpu')) app.disableHardwareAcceleration()
  if (flags.includes('no-smooth-scrolling')) app.commandLine.appendSwitch('disable-smooth-scrolling')
}
