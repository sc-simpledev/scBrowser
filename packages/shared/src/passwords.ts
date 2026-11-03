/** What the interface sees in lists. The password itself only comes back on request. */
export interface PasswordSummary {
  id: string
  origin: string
  username: string
  note: string
  updatedAt: number
}

export interface PasswordEntry {
  /** Left out for a new entry. */
  id?: string
  url: string
  username: string
  password: string
  note: string
}

export interface PasswordState {
  /** Private windows have no vault. */
  available: boolean
  /** A master password has been set. */
  exists: boolean
  unlocked: boolean
}

export const MIN_MASTER_LENGTH = 10
export const PASSWORD_LOCK_CHOICES = [5, 15, 60, 0] as const

/** The exact site a login belongs to, or null if it isn't a web address. */
export function originOf(url: string): string | null {
  const text = url.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  if (!URL.canParse(withScheme)) return null
  const parsed = new URL(withScheme)
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null
}

const LETTERS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*-_=+?'

/** A strong password. `random` fills an array with secure random values, so each process brings its own. */
export function generatePassword(random: (values: Uint32Array) => void, length = 20): string {
  const alphabet = LETTERS + DIGITS + SYMBOLS
  // Values past the last whole multiple would favour the start of the alphabet.
  const limit = Math.floor(2 ** 32 / alphabet.length) * alphabet.length
  let result = ''
  const values = new Uint32Array(length * 2)
  while (result.length < length) {
    random(values)
    for (const value of values) if (value < limit && result.length < length) result += alphabet[value % alphabet.length]
  }
  return result
}

/** Reads a CSV file, including quoted cells holding commas, quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      rows.push([...row, cell.replace(/\r$/, '')])
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length > 0) rows.push([...row, cell])
  return rows
}

/** Takes the files Chrome, Edge, Brave, Firefox and Bitwarden export. */
export function parsePasswordCsv(text: string): PasswordEntry[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''))
  if (!header) return []
  const names = header.map((name) => name.trim().toLowerCase())
  const column = (...options: string[]) => names.findIndex((name) => options.includes(name))
  const url = column('url', 'login_uri', 'web site', 'website')
  const username = column('username', 'login_username', 'login name')
  const password = column('password', 'login_password')
  const note = column('note', 'notes')
  if (url === -1 || password === -1) return []
  return rows.flatMap((row) => {
    const entry = { url: row[url] ?? '', username: row[username] ?? '', password: row[password] ?? '', note: row[note] ?? '' }
    return entry.password && originOf(entry.url) ? [entry] : []
  })
}

const csvCell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

export function passwordCsv(entries: Omit<PasswordEntry, 'id'>[]): string {
  const rows = entries.map(({ url, username, password, note }) => [url, username, password, note].map(csvCell).join(','))
  return ['url,username,password,note', ...rows].join('\n') + '\n'
}
