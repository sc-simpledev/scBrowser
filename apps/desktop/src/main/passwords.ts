import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { IDENTITY_FIELDS, isTotpConfig, MIN_MASTER_LENGTH, originOf, parseTotp, passwordStrength, parsePasswordCsv, passwordCsv, totpUri, type Identity, type LeakCheck, type PasswordEntry, type PasswordState, type PasswordSummary, type TotpCode, type TotpConfig } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'
import { leakHash, parseLeakRange, totpCode } from './totp'

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
  totp?: TotpConfig
}

interface Contents {
  logins: Login[]
  /** Sites where the person said never to offer saving. */
  never: string[]
  /** Vaults from before this existed don't have it. */
  identities?: Identity[]
  /** From the last leak check, by login. Only counts for a login not changed since. */
  leaks?: Record<string, { count: number; checkedAt: number }>
  leaksCheckedAt?: number
}

interface Sealed {
  /** With no master password: the vault's random key, sealed by the system keychain. */
  device?: string
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

const summary = ({ id, origin, username, note, updatedAt, totp }: Login): PasswordSummary => ({ id, origin, username, note, updatedAt, ...(totp ? { totp: true } : {}) })

/** Adds health to each summary: weak, reused on another site, and found in a breach. */
function withHealth(logins: Login[], leaks: Contents['leaks'] = {}): PasswordSummary[] {
  const sites = new Map<string, Set<string>>()
  for (const login of logins) sites.set(login.password, (sites.get(login.password) ?? new Set()).add(login.origin))
  return logins.map((login) => {
    const leak = leaks[login.id]
    return { ...summary(login), weak: passwordStrength(login.password) < 2, reused: (sites.get(login.password)?.size ?? 0) > 1, leaked: !!leak && leak.count > 0 && leak.checkedAt >= login.updatedAt }
  })
}

/** Fetches Have I Been Pwned's list for a 5-character hash prefix. */
export type LeakRangeFetch = (prefix: string) => Promise<string>

/** Saved keys are checked again, so a bad value from an old or edited vault can't break making codes. */
function totpFrom(input: string | undefined, existing: TotpConfig | undefined): TotpConfig | undefined {
  if (input === undefined) return existing && isTotpConfig(existing) ? existing : undefined
  if (!input.trim()) return undefined
  const parsed = parseTotp(input)
  if (!parsed) throw new Error("That two-step key isn't valid. Paste the key the site shows, or the otpauth:// address from its QR code.")
  return parsed
}

/** The system keychain, through `safeStorage`. */
export interface DeviceSealer {
  encrypt: (value: string) => Promise<string>
  decrypt: (value: string) => Promise<string>
}

interface VaultDeps {
  kv: KeyValueRepo
  available: boolean
  /** Seals the key of a vault with no master password. */
  device?: DeviceSealer
  /** Minutes unused before locking itself, or 0 for never. */
  lockMinutes: () => number
  onChange: () => void
}

/**
 * Logins sealed with a key derived from a master password, which is never stored. While
 * locked, nothing here can be read; the key and logins only exist in memory once unlocked.
 *
 * A master password is optional. Without one, the key is random and kept sealed by the system
 * keychain, like Chrome's own passwords: it opens by itself when scTerra starts, and anyone using
 * this account can see the logins, but a copy of the profile on its own can't be read.
 */
export class PasswordVault {
  private key: Buffer | null = null
  private salt: Buffer | null = null
  private contents: Contents | null = null
  private lockTimer: NodeJS.Timeout | undefined
  private failures = 0

  /** Settles once a vault without a master password has opened by itself. */
  readonly ready: Promise<void>

  constructor(private readonly deps: VaultDeps) {
    this.ready = this.openWithDevice().then(() => undefined, () => undefined)
  }

  private get usesDevice(): boolean {
    return this.stored()?.device !== undefined
  }

  private async openWithDevice(): Promise<boolean> {
    const sealed = this.stored()
    if (!sealed?.device || !this.deps.device) return false
    const key = Buffer.from(await this.deps.device.decrypt(sealed.device), 'base64')
    this.contents = open(sealed, key)
    this.key = key
    this.salt = Buffer.from(sealed.salt, 'base64')
    this.deps.onChange()
    return true
  }

  /** A fresh random key, sealed by the keychain, for a vault with no master password. */
  private async deviceKey(): Promise<string> {
    if (!this.deps.device) throw new Error("This computer's keychain isn't available, so a master password is needed.")
    this.key?.fill(0)
    this.key = randomBytes(32)
    this.salt = randomBytes(SALT_BYTES)
    return this.deps.device.encrypt(this.key.toString('base64'))
  }

  private stored(): Sealed | null {
    const saved = this.deps.kv.get(KEY)
    return typeof saved === 'string' ? (JSON.parse(saved) as Sealed) : null
  }

  state(): PasswordState {
    const stored = this.stored()
    return { available: this.deps.available, exists: stored !== null, unlocked: this.contents !== null, master: stored !== null && stored.device === undefined }
  }

  get unlocked(): boolean {
    return this.contents !== null
  }

  private save(device = this.stored()?.device): void {
    this.deps.kv.set(KEY, JSON.stringify({ ...seal(this.contents!, this.key!, this.salt!), ...(device ? { device } : {}) }))
    this.deps.onChange()
  }

  /** Each use pushes back the time it locks itself. */
  private touch(): Contents {
    if (!this.contents) throw new Error('Unlock your passwords first.')
    clearTimeout(this.lockTimer)
    const minutes = this.usesDevice ? 0 : this.deps.lockMinutes()
    if (minutes > 0) {
      this.lockTimer = setTimeout(() => this.lock(), minutes * 60_000)
      this.lockTimer.unref?.()
    }
    return this.contents
  }

  /** An empty master password means none: the keychain seals it instead. */
  async create(master: string): Promise<void> {
    if (!this.deps.available) throw new Error('Private windows have no saved passwords.')
    if (this.stored()) throw new Error('You already have a password vault.')
    if (!master) {
      const device = await this.deviceKey()
      this.contents = { logins: [], never: [] }
      this.save(device)
      this.touch()
      return
    }
    if (master.length < MIN_MASTER_LENGTH) throw new Error(`Use at least ${MIN_MASTER_LENGTH} characters.`)
    this.salt = randomBytes(SALT_BYTES)
    this.key = await deriveKey(master, this.salt)
    this.contents = { logins: [], never: [] }
    this.save()
    this.touch()
  }

  /** Adds a master password to a vault that didn't have one. */
  async setMaster(next: string): Promise<void> {
    if (!this.usesDevice) throw new Error('You already have a master password.')
    if (next.length < MIN_MASTER_LENGTH) throw new Error(`Use at least ${MIN_MASTER_LENGTH} characters.`)
    const contents = this.touch()
    this.key?.fill(0)
    this.salt = randomBytes(SALT_BYTES)
    this.key = await deriveKey(next, this.salt)
    this.contents = contents
    this.deps.kv.set(KEY, JSON.stringify(seal(contents, this.key, this.salt)))
    this.deps.onChange()
    this.touch()
  }

  /** Takes the master password away after checking it, leaving the keychain to seal the vault. */
  async removeMaster(current: string): Promise<boolean> {
    const sealed = this.stored()
    if (!sealed || sealed.device) return false
    let contents: Contents
    try {
      contents = open(sealed, await deriveKey(current, Buffer.from(sealed.salt, 'base64')))
    } catch {
      return false
    }
    const device = await this.deviceKey()
    this.contents = contents
    this.save(device)
    this.touch()
    return true
  }

  /** False for a wrong password. Repeated wrong guesses take longer each time. */
  async unlock(master: string): Promise<boolean> {
    const sealed = this.stored()
    if (!sealed) return false
    if (sealed.device) return this.openWithDevice().catch(() => false)
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

  /** A vault with no master password has nothing to unlock with, so it stays open. */
  lock(): void {
    if (this.usesDevice && this.contents) return
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
    if (!sealed || sealed.device) return false
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
    clearTimeout(this.lockTimer)
    this.key?.fill(0)
    this.key = null
    this.contents = null
    this.deps.kv.delete(KEY)
    this.failures = 0
    this.deps.onChange()
  }

  list(): PasswordSummary[] {
    const contents = this.touch()
    return withHealth([...contents.logins].sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)), contents.leaks)
  }

  /** The current two-step code for a login. The key itself never leaves this process. */
  totp(id: string, now = Date.now()): TotpCode {
    const login = this.touch().logins.find((candidate) => candidate.id === id)
    if (!login?.totp || !isTotpConfig(login.totp)) throw new Error("That login doesn't have two-step codes.")
    return totpCode(login.totp, now)
  }

  leakStatus(): LeakCheck {
    const contents = this.touch()
    const leaked = withHealth(contents.logins, contents.leaks).filter((login) => login.leaked).length
    return { checked: contents.leaksCheckedAt ? contents.logins.length : 0, leaked, checkedAt: contents.leaksCheckedAt ?? null }
  }

  /**
   * Looks each password up in Have I Been Pwned by k-anonymity: only the first 5 characters of its
   * SHA-1 are sent, and the rest is matched here. Only ever run when the person asks.
   */
  async checkLeaks(fetchRange: LeakRangeFetch): Promise<LeakCheck> {
    const startedAt = Date.now()
    const hashes = new Map(this.touch().logins.map((login) => [login.id, leakHash(login.password)]))
    const prefixes = [...new Set([...hashes.values()].map((hash) => hash.slice(0, 5)))]
    const ranges = new Map<string, Map<string, number>>()
    // A few at a time: fast enough for a big vault, without hammering the service.
    for (let i = 0; i < prefixes.length; i += 6) {
      const batch = prefixes.slice(i, i + 6)
      const bodies = await Promise.all(batch.map((prefix) => fetchRange(prefix)))
      batch.forEach((prefix, index) => ranges.set(prefix, parseLeakRange(bodies[index]!)))
    }
    // It may have locked while waiting, and then the answers are dropped.
    const contents = this.touch()
    const leaks: NonNullable<Contents['leaks']> = {}
    for (const login of contents.logins) {
      const hash = hashes.get(login.id)
      // Changed while the check ran, so this answer was for the old password.
      if (!hash || login.updatedAt > startedAt || hash !== leakHash(login.password)) continue
      leaks[login.id] = { count: ranges.get(hash.slice(0, 5))?.get(hash.slice(5)) ?? 0, checkedAt: startedAt }
    }
    contents.leaks = leaks
    contents.leaksCheckedAt = startedAt
    this.save()
    return this.leakStatus()
  }

  /** Only logins for this exact site, so a lookalike or a subdomain never matches. */
  matches(origin: string): PasswordSummary[] {
    const site = sameSite(origin)
    const logins = this.touch().logins
    const exact = logins.filter((login) => login.origin === origin)
    // `www.` and the bare name are one site, which matters for logins imported from other browsers.
    return [...exact, ...logins.filter((login) => login.origin !== origin && sameSite(login.origin) === site && !exact.some((other) => other.username === login.username))].map(summary)
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
    const totp = totpFrom(entry.totp, existing?.totp)
    const login: Login = { id: existing?.id ?? randomUUID(), origin, username: entry.username, password: entry.password, note: entry.note, updatedAt: Date.now(), ...(totp ? { totp } : {}) }
    contents.logins = [...contents.logins.filter((candidate) => candidate !== existing), login]
    this.save()
    return login.id
  }

  remove(id: string): void {
    const contents = this.touch()
    contents.logins = contents.logins.filter((login) => login.id !== id)
    if (contents.leaks) delete contents.leaks[id]
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
      // A bad two-step key in the file shouldn't stop the rest importing, so it's just left out.
      const totp = entry.totp ? (parseTotp(entry.totp) ?? existing?.totp) : existing?.totp
      if (existing?.password === entry.password && totp?.secret === existing.totp?.secret) continue
      contents.logins = contents.logins.filter((login) => login !== existing)
      contents.logins.push({ id: existing?.id ?? randomUUID(), origin, username: entry.username, password: entry.password, note: entry.note, updatedAt: Date.now(), ...(totp ? { totp } : {}) })
      changed++
    }
    if (changed > 0) this.save()
    return changed
  }

  exportCsv(): string {
    return passwordCsv(
      this.touch().logins.map(({ origin, username, password, note, totp }) => ({ url: origin, username, password, note, ...(totp ? { totp: totpUri(totp, username ? `${new URL(origin).host}:${username}` : new URL(origin).host) } : {}) }))
    )
  }
}

/** An origin with a leading `www.` dropped, keeping the scheme and port. */
function sameSite(origin: string): string {
  return origin.replace(/^(https?:\/\/)www\./, '$1')
}
