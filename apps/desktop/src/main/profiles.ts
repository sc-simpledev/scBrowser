import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export const DEFAULT_PROFILE = 'Default'

const VALID_NAME = /^[\w -]{1,40}$/
const FLAG = '--profile='

const named = process.argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length)
const requested = named && VALID_NAME.test(named) ? named : DEFAULT_PROFILE
let base = ''

export const currentProfile = () => requested

/** Points the app at the profile's folder. Must run before the app is ready. */
export function applyProfile(): void {
  base = app.getPath('userData')
  if (requested === DEFAULT_PROFILE) return
  const folder = join(base, 'profiles', requested)
  mkdirSync(folder, { recursive: true })
  app.setPath('userData', folder)
}

export function listProfiles(): { current: string; names: string[] } {
  let names: string[] = []
  try {
    names = readdirSync(join(base, 'profiles'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    // No extra profiles have been created yet.
  }
  return { current: requested, names: [DEFAULT_PROFILE, ...names.sort()] }
}

/** Each profile runs as its own copy of the app, with its own data and windows. */
export function openProfile(name: string): void {
  if (!VALID_NAME.test(name)) throw new Error('Profile names can use letters, numbers, spaces and dashes.')
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), ...(name === DEFAULT_PROFILE ? [] : [`${FLAG}${name}`])]
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref()
}
