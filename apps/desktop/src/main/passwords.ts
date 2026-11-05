import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { IDENTITY_FIELDS, MIN_MASTER_LENGTH, originOf, parsePasswordCsv, passwordCsv, type Identity, type PasswordEntry, type PasswordState, type PasswordSummary } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'passwords:vault'
const AAD = Buffer.from('scterra-vault-1')
const SALT_BYTES = 16
const IV_BYTES = 12
// Slow on purpose, as this is all that stands between a stolen profile and guessing the password.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 512 * 1024 * 1024 }
/** How long the next attempt waits, per wrong password so far. */
const FAILED_DELAY_MS = 1000
const MAX_FAILED_DELAY_MS = 30_000

interface Login {
  id: string
  origin: string
  username: string
  password: string
  note: string
  updatedAt: number
}

interface Contents {
  logins: Login[]
  /** Sites where the person said never to offer saving. */
  never: string[]
  /** Vaults from before this existed don't have it. */
  identities?: Identity[]
}

interface Sealed {
  salt: string
  iv: string
  tag: string
  data: string
}

const deriveKey = (master: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(master.normalize('NFKC'), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key)))
  })

function seal(contents: Contents, key: Buffer, salt: Buffer): Sealed {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD)
  const data = Buffer.concat([cipher.update(JSON.stringify(contents), 'utf8'), cipher.final()])
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

function open(sealed: Sealed, key: Buffer): Contents {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAAD(AAD)
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8')) as Contents
}

const summary = ({ id, origin, username, note, updatedAt }: Login): PasswordSummary => ({ id, origin, username, note, updatedAt })

interface VaultDeps {
  kv: KeyValueRepo
  available: boolean
  /** Minutes unused before locking itself, or 0 for never. */
  lockMinutes: () => number
  onChange: () => void
}

/**
 * Logins sealed with a key derived from a master password, which is never stored. While
 * locked, nothing here can be read; the key and logins only exist in memory once unlocked.
 */
export class PasswordVault {
  private key: Buffer | null = null
  private salt: Buffer | null = null
  private contents: Contents | null = null
  private lockTimer: NodeJS.Timeout | undefined
  private failures = 0

  constructor(private readonly deps: VaultDeps) {}

  private stored(): Sealed | null {
    const saved = this.deps.kv.get(KEY)
    return typeof saved === 'string' ? (JSON.parse(saved) as Sealed) : null
  }

  state(): PasswordState {
    return { available: this.deps.available, exists: this.stored() !== null, unlocked: this.contents !== null }
  }

  get unlocked(): boolean {
    return this.contents !== null
  }

  private save(): void {
    this.deps.kv.set(KEY, JSON.stringify(seal(this.contents!, this.key!, this.salt!)))
    this.deps.onChange()
  }

  /** Each use pushes back the time it locks itself. */
  private touch(): Contents {
    if (!this.contents) throw new Error('Unlock your passwords first.')
    clearTimeout(this.lockTimer)
    const minutes = this.deps.lockMinutes()
    if (minutes > 0) {
      this.lockTimer = setTimeout(() => this.lock(), minutes * 60_000)
      this.lockTimer.unref?.()
    }
    return this.contents
  }

  async create(master: string): Promise<void> {
    if (!this.deps.available) throw new Error('Private windows have no saved passwords.')
    if (this.stored()) throw new Error('You already have a master password.')
    if (master.length < MIN_MASTER_LENGTH) throw new Error(`Use at least ${MIN_MASTER_LENGTH} characters.`)
    this.salt = randomBytes(SALT_BYTES)
    this.key = await deriveKey(master, this.salt)
    this.contents = { logins: [], never: [] }
    this.save()
    this.touch()
  }

  /** False for a wrong password. Repeated wrong guesses take longer each time. */
  async unlock(master: string): Promise<boolean> {
    const sealed = this.stored()
    if (!sealed) return false
    if (this.failures > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_FAILED_DELAY_MS, this.failures * FAILED_DELAY_MS)))
    const salt = Buffer.from(sealed.salt, 'base64')
    const key = await deriveKey(master, salt)
    try {
      this.contents = open(sealed, key)
    } catch {
      this.failures++
      return false
    }
    this.failures = 0
    this.key = key
    this.salt = salt
    this.touch()
    this.deps.onChange()
    return true
  }

  lock(): void {
    clearTimeout(this.lockTimer)
    this.key?.fill(0)
    this.key = null
    this.contents = null
    this.deps.onChange()
  }

  /** Reseals everything under a new password, after checking the old one. */
  async changeMaster(current: string, next: string): Promise<boolean> {
    if (next.length < MIN_MASTER_LENGTH) throw new Error(`Use at least ${MIN_MASTER_LENGTH} characters.`)
    const sealed = this.stored()
    if (!sealed) return false
    let contents: Contents
    try {
      contents = open(sealed, await deriveKey(current, Buffer.from(sealed.salt, 'base64')))
    } catch {
      return false
    }
    this.key?.fill(0)
    this.salt = randomBytes(SALT_BYTES)
    this.key = await deriveKey(next, this.salt)
    this.contents = contents
    this.save()
    this.touch()
    return true
  }

  /** For a forgotten master password: without it the logins can't be recovered, so they go. */
  reset(): void {
    this.lock()
    this.deps.kv.delete(KEY)
    this.failures = 0
    this.deps.onChange()
  }

  list(): PasswordSummary[] {
    return [...this.touch().logins].sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)).map(summary)
  }

  /** Only logins for this exact site, so a lookalike or a subdomain never matches. */
  matches(origin: string): PasswordSummary[] {
    return this.touch().logins.filter((login) => login.origin === origin).map(summary)
  }

  reveal(id: string): string {
    const login = this.touch().logins.find((candidate) => candidate.id === id)
    if (!login) throw new Error("That login isn't saved any more.")
    return login.password
  }

  find(id: string): PasswordSummary & { password: string } {
    return { ...summary(this.touch().logins.find((login) => login.id === id) ?? this.missing()), password: this.reveal(id) }
  }

  private missing(): never {
    throw new Error("That login isn't saved any more.")
  }

  saveEntry(entry: PasswordEntry): string {
    const contents = this.touch()
    const origin = originOf(entry.url)
    if (!origin) throw new Error('Use a web address, like https://example.com.')
    if (!entry.password) throw new Error('Enter a password.')
    const existing = entry.id ? contents.logins.find((login) => login.id === entry.id) : contents.logins.find((login) => login.origin === origin && login.username === entry.username)
    const login: Login = { id: existing?.id ?? randomUUID(), origin, username: entry.username, password: entry.password, note: entry.note, updatedAt: Date.now() }
    contents.logins = [...contents.logins.filter((candidate) => candidate !== existing), login]
    this.save()
    return login.id
  }

  remove(id: string): void {
    const contents = this.touch()
    contents.logins = contents.logins.filter((login) => login.id !== id)
    this.save()
  }

  /** What a sign-in on this site would mean: already saved, a new login, a changed password, or nothing to offer. */
  offerFor(origin: string, username: string, password: string): 'new' | 'update' | null {
    const contents = this.touch()
    if (contents.never.includes(origin)) return null
    const existing = contents.logins.find((login) => login.origin === origin && login.username === username)
    if (!existing) return 'new'
    return existing.password === password ? null : 'update'
  }

  neverFor(origin: string): void {
    const contents = this.touch()
    if (!contents.never.includes(origin)) contents.never.push(origin)
    this.save()
  }

  identities(): Identity[] {
    return this.touch().identities ?? []
  }

  identity(id: string): Identity {
    const found = this.identities().find((identity) => identity.id === id)
    if (!found) throw new Error("Those details aren't saved any more.")
    return found
  }

  saveIdentity(input: Identity): string {
    const contents = this.touch()
    const id = input.id ?? randomUUID()
    const clean = { ...Object.fromEntries(IDENTITY_FIELDS.map(({ key }) => [key, input[key].trim()])), id } as Identity
    if (IDENTITY_FIELDS.every(({ key }) => !clean[key])) throw new Error('Enter something to save.')
    contents.identities = [...(contents.identities ?? []).filter((identity) => identity.id !== id), clean]
    this.save()
    return id
  }

  removeIdentity(id: string): void {
    const contents = this.touch()
    contents.identities = (contents.identities ?? []).filter((identity) => identity.id !== id)
    this.save()
  }

  /** Returns how many were new or changed. */
  importCsv(text: string): number {
    const contents = this.touch()
    let changed = 0
    for (const entry of parsePasswordCsv(text)) {
      const origin = originOf(entry.url)!
      const existing = contents.logins.find((login) => login.origin === origin && login.username === entry.username)
      if (existing?.password === entry.password) continue
      contents.logins = contents.logins.filter((login) => login !== existing)
      contents.logins.push({ id: existing?.id ?? randomUUID(), origin, username: entry.username, password: entry.password, note: entry.note, updatedAt: Date.now() })
      changed++
    }
    if (changed > 0) this.save()
    return changed
  }

  exportCsv(): string {
    return passwordCsv(this.touch().logins.map(({ origin, username, password, note }) => ({ url: origin, username, password, note })))
  }
}
