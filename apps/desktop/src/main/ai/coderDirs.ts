import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { KeyValueRepo } from '../storage/kv'

/** Folders besides a project that Terra Code may also read and edit there (/add-dir), by project. */
const KEY = 'coder:extra-dirs'
export const MAX_EXTRA_DIRS = 8

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const all = (kv: KeyValueRepo) => {
  const value = kv.get(KEY)
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string[]>) : {}
}

export function extraDirsFor(kv: KeyValueRepo, folder: string): string[] {
  if (!folder) return []
  const list = all(kv)[real(folder)]
  return Array.isArray(list) ? list.filter((dir) => typeof dir === 'string') : []
}

export function setExtraDirs(kv: KeyValueRepo, folder: string, dirs: string[]): string[] {
  const key = real(folder)
  const next = [...new Set(dirs.map(real))].filter((dir) => dir !== key).slice(0, MAX_EXTRA_DIRS)
  const { [key]: _old, ...rest } = all(kv)
  kv.set(KEY, next.length ? { ...rest, [key]: next } : rest)
  return next
}
