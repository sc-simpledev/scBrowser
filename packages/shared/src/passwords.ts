/** What the interface sees in lists. The password itself only comes back on request. */
export interface PasswordSummary {
  id: string
  origin: string
  username: string
  note: string
  updatedAt: number
  /** Short, simple or common, from `passwordStrength`. */
  weak?: boolean
  /** The same password is saved for another site. */
  reused?: boolean
  /** Turns up in known data breaches, from the last leak check. */
  leaked?: boolean
  /** Two-step codes are set up for it. */
  totp?: boolean
}

/** A two-step code and how long it has left. */
export interface TotpCode {
  code: string
  period: number
  remaining: number
}

export interface LeakCheck {
  checked: number
  leaked: number
  /** When it last ran, or null if it never has. */
  checkedAt: number | null
}

export interface PasswordEntry {
  /** Left out for a new entry. */
  id?: string
  url: string
  username: string
  password: string
  note: string
  /**
   * A setup key or `otpauth://` address for two-step codes. Left out keeps what's saved,
   * and an empty string removes it. Saved codes never come back to a page.
   */
  totp?: string
}

export interface PasswordState {
  /** Private windows have no vault. */
  available: boolean
  /** A vault has been set up, with or without a master password. */
  exists: boolean
  unlocked: boolean
  /** False when the vault is sealed by this computer's keychain alone, and opens by itself. */
  master: boolean
}

/** Details for filling in forms. Sealed in the vault with the logins, and never synced. */
export interface Identity {
  /** Left out for a new one. */
  id?: string
  label: string
  fullName: string
  email: string
  phone: string
  organization: string
  address1: string
  address2: string
  city: string
  region: string
  postalCode: string
  country: string
}

export const IDENTITY_FIELDS: { key: Exclude<keyof Identity, 'id'>; label: string }[] = [
  { key: 'label', label: 'Name for this set, like Home or Work' },
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'organization', label: 'Organisation' },
  { key: 'address1', label: 'Address' },
  { key: 'address2', label: 'Address line 2' },
  { key: 'city', label: 'City or suburb' },
  { key: 'region', label: 'State or region' },
  { key: 'postalCode', label: 'Postcode' },
  { key: 'country', label: 'Country' }
]

export const EMPTY_IDENTITY: Identity = { label: '', fullName: '', email: '', phone: '', organization: '', address1: '', address2: '', city: '', region: '', postalCode: '', country: '' }

export const identityName = (identity: Identity) => identity.label || identity.fullName || identity.email || 'Unnamed'

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
export function generatePassword(random: (values: Uint32Array) => void, length = 20, { symbols = true, digits = true }: { symbols?: boolean; digits?: boolean } = {}): string {
  const alphabet = LETTERS + (digits ? DIGITS : '') + (symbols ? SYMBOLS : '')
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
  const totp = column('totp', 'login_totp', 'otpauth')
  if (url === -1 || password === -1) return []
  return rows.flatMap((row) => {
    const entry: PasswordEntry = { url: row[url] ?? '', username: row[username] ?? '', password: row[password] ?? '', note: row[note] ?? '' }
    if (row[totp]?.trim()) entry.totp = row[totp]!.trim()
    return entry.password && originOf(entry.url) ? [entry] : []
  })
}

const csvCell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

/** Two-step keys get a column only when some login has one, so plain exports look as they always did. */
export function passwordCsv(entries: Omit<PasswordEntry, 'id'>[]): string {
  const withTotp = entries.some((entry) => entry.totp)
  const rows = entries.map(({ url, username, password, note, totp }) => [url, username, password, note, ...(withTotp ? [totp ?? ''] : [])].map(csvCell).join(','))
  return [withTotp ? 'url,username,password,note,totp' : 'url,username,password,note', ...rows].join('\n') + '\n'
}

const COMMON = new Set(['password', 'passw0rd', '123456', '12345678', '123456789', 'qwerty', 'letmein', 'iloveyou', 'admin', 'welcome', 'monkey', 'dragon', 'abc123', 'football', 'baseball', 'sunshine', 'princess', 'master', 'trustno1', '111111', '000000'])

/** A rough score from 0 (very weak) to 4 (strong), from length and the kinds of character used. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9]/g, ''))) return 0
  if (/^(.)\1+$/.test(password)) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(password)).length
  const bits = password.length * Math.log2([0, 26, 52, 62, 90][kinds] ?? 26)
  if (bits < 28) return 0
  if (bits < 40) return 1
  if (bits < 60) return 2
  if (bits < 80) return 3
  return 4
}

export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const
