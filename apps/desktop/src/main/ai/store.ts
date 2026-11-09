import { MAX_MEMORY_NOTES, type MemoryNote } from '@scbrowser/shared'
import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { ProviderSecret } from '@scbrowser/ai'
import {
  DEFAULT_SKILLS,
  estimateCost,
  HOSTED_AI_URL,
  HOSTED_MODEL,
  HOSTED_NAME,
  HOSTED_PROVIDER_ID,
  type AiState, type AiStatus, type ModelRef, type ModelRole, type ProviderConfig, type ProviderProtocol,
  type ProviderUsage,
  type Skill
} from '@scbrowser/shared'
import type { KeyValueRepo } from '../storage/kv'

const MEMORY_KEY = 'ai:memory'
const PROVIDERS = 'ai:providers'
const ROLES = 'ai:roles'
const USAGE = 'ai:usage'
const DISABLED = 'ai:disabled-hosts'
const SKILLS = 'ai:skills'
const OLD_HOSTED_NAME = 'scDelta AI'
const secretKey = (id: string) => `ai:secret:${id}`
/** Kept in the clear so the settings page can say a key is saved without decrypting it. */
const hasKeyKey = (id: string) => `ai:has-key:${id}`

const ANTHROPIC_DEFAULT_CHAT = 'claude-opus-5-5'

export interface ProviderInput {
  id: string | null
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: string[]
  /** Undefined keeps the stored key; an empty string clears it. */
  apiKey?: string
  /** "Name: value" per line. Undefined keeps the stored headers. */
  headers?: string
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const name = line.slice(0, colon).trim()
    if (/^[\w-]+$/.test(name)) headers[name] = line.slice(colon + 1).trim()
  }
  return headers
}

const isFirstParty = (baseUrl: string, protocol: ProviderProtocol) =>
  protocol === 'anthropic' && new URL(baseUrl).origin === 'https://api.anthropic.com'

/** Provider settings. Secrets are encrypted with the OS keychain and stay in the main process. */
export class AiStore {
  memory(): MemoryNote[] {
    const saved = this.kv.get(MEMORY_KEY)
    return Array.isArray(saved) ? (saved as MemoryNote[]) : []
  }

  addMemory(text: string, now = Date.now()): MemoryNote | null {
    const trimmed = text.trim()
    const all = this.memory()
    if (!trimmed || all.length >= MAX_MEMORY_NOTES) return null
    const note = { id: randomUUID(), text: trimmed, createdAt: now }
    this.kv.set(MEMORY_KEY, [note, ...all])
    return note
  }

  updateMemory(id: string, text: string): void {
    const trimmed = text.trim()
    if (trimmed) this.kv.set(MEMORY_KEY, this.memory().map((note) => (note.id === id ? { ...note, text: trimmed } : note)))
  }

  removeMemory(id: string): void {
    this.kv.set(MEMORY_KEY, this.memory().filter((note) => note.id !== id))
  }

  private readonly listeners = new Set<() => void>()

  constructor(private readonly kv: KeyValueRepo) {
    // Without a keyring Linux would refuse to store keys at all. Allow it, and let the
    // AI settings page warn that they're only obfuscated (see `keysProtected`).
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      safeStorage.setUsePlainTextEncryption(true)
    }
    this.retireOldHosted()
  }

  /** The service was called scDelta AI, at the same address. Its entry becomes the one scTerra AI. */
  private retireOldHosted(): void {
    const isOld = (p: ProviderConfig) => p.id !== HOSTED_PROVIDER_ID && (p.name === OLD_HOSTED_NAME || !!p.hosted)
    const old = this.providers().filter(isOld)
    if (old.length === 0) return
    const inUse = Object.values(this.roles()).some((ref) => old.some((p) => p.id === ref.providerId))
    this.kv.set(PROVIDERS, this.providers().filter((p) => !isOld(p)))
    old.forEach((p) => {
      this.kv.delete(secretKey(p.id))
      this.kv.delete(hasKeyKey(p.id))
    })
    const moved = Object.entries(this.roles()).map(([role, ref]) => [role, old.some((p) => p.id === ref.providerId) ? { providerId: HOSTED_PROVIDER_ID, model: HOSTED_MODEL } : ref])
    this.kv.set(ROLES, Object.fromEntries(moved))
    if (inUse && !this.provider(HOSTED_PROVIDER_ID) && this.hostedUrl()) this.addHosted()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  providers(): ProviderConfig[] {
    return (this.kv.get(PROVIDERS) as ProviderConfig[] | undefined) ?? []
  }

  provider(id: string): ProviderConfig | undefined {
    return this.providers().find((p) => p.id === id)
  }

  roles(): Partial<Record<ModelRole, ModelRef>> {
    return (this.kv.get(ROLES) as Partial<Record<ModelRole, ModelRef>> | undefined) ?? {}
  }

  disabledHosts(): string[] {
    return (this.kv.get(DISABLED) as string[] | undefined) ?? []
  }

  private usage(): Record<string, ProviderUsage> {
    return (this.kv.get(USAGE) as Record<string, ProviderUsage> | undefined) ?? {}
  }

  state(): AiState {
    return {
      providers: this.providers().map((p) => ({ ...p, hasKey: this.hasKey(p.id) })),
      roles: this.roles(),
      usage: this.usage(),
      disabledHosts: this.disabledHosts(),
      keysProtected: this.keysProtected(),
      hostedAvailable: this.hostedUrl() !== null,
      skills: this.skills()
    }
  }

  status(): AiStatus {
    const chat = this.roles().chat
    const provider = chat && this.provider(chat.providerId)
    return {
      ready: !!provider,
      model: provider?.hosted ? provider.name : provider ? chat.model : null,
      providerName: provider?.name ?? null,
      disabledHosts: this.disabledHosts(),
      hostedAvailable: this.hostedUrl() !== null,
      skills: this.skills()
    }
  }

  private hostedUrl(): string | null {
    const override = process.env.SCTERRA_AI_URL
    if (override === 'off') return null
    return override || HOSTED_AI_URL || null
  }

  /** Switches chat to the hosted service. Only ever done at the person's request. */
  enableHosted(): void {
    this.addHosted()
    this.setRole('chat', { providerId: HOSTED_PROVIDER_ID, model: HOSTED_MODEL })
  }

  private addHosted(): void {
    const baseUrl = this.hostedUrl()
    if (!baseUrl) throw new Error('scTerra AI is not available in this build.')
    const hosted: ProviderConfig = {
      id: HOSTED_PROVIDER_ID,
      name: HOSTED_NAME,
      protocol: 'openai',
      baseUrl,
      models: [HOSTED_MODEL],
      firstParty: false,
      hosted: true
    }
    this.kv.set(PROVIDERS, [...this.providers().filter((p) => p.id !== HOSTED_PROVIDER_ID), hosted])
  }

  skills(): Skill[] {
    return (this.kv.get(SKILLS) as Skill[] | undefined) ?? DEFAULT_SKILLS
  }

  saveSkills(skills: Skill[]): void {
    this.kv.set(SKILLS, skills)
    this.notify()
  }

  private hasKey(id: string): boolean {
    const flag = this.kv.get(hasKeyKey(id))
    // Keys saved before the flag existed are counted by their stored secret.
    return typeof flag === 'boolean' ? flag : typeof this.kv.get(secretKey(id)) === 'string'
  }

  async save(input: ProviderInput): Promise<string> {
    if (!URL.canParse(input.baseUrl)) throw new Error('Check the address: it should look like https://example.com/v1')
    const url = new URL(input.baseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The address must start with http or https.')
    const id = input.id ?? randomUUID()
    const config: ProviderConfig = {
      id,
      name: input.name.trim() || url.host,
      protocol: input.protocol,
      baseUrl: input.baseUrl.trim(),
      models: input.models,
      firstParty: isFirstParty(input.baseUrl, input.protocol)
    }
    const others = this.providers().filter((p) => p.id !== id)
    this.kv.set(PROVIDERS, [...others, config])

    if (input.apiKey !== undefined || input.headers !== undefined) {
      const current = await this.secret(id)
      await this.writeSecret(id, {
        apiKey: input.apiKey ?? current.apiKey,
        headers: input.headers === undefined ? current.headers : parseHeaders(input.headers)
      })
    }
    if (config.firstParty && !this.roles().chat) this.setRole('chat', { providerId: id, model: ANTHROPIC_DEFAULT_CHAT })
    this.notify()
    return id
  }

  remove(id: string): void {
    this.kv.set(PROVIDERS, this.providers().filter((p) => p.id !== id))
    this.kv.delete(secretKey(id))
    this.kv.delete(hasKeyKey(id))
    const roles = Object.fromEntries(Object.entries(this.roles()).filter(([, ref]) => ref.providerId !== id))
    this.kv.set(ROLES, roles)
    this.notify()
  }

  setRole(role: ModelRole, ref: ModelRef): void {
    if (!this.provider(ref.providerId)) throw new Error('Unknown provider')
    this.kv.set(ROLES, { ...this.roles(), [role]: ref })
    this.notify()
  }

  setSiteDisabled(host: string, disabled: boolean): void {
    const others = this.disabledHosts().filter((h) => h !== host)
    this.kv.set(DISABLED, disabled ? [...others, host].sort() : others)
    this.notify()
  }

  addUsage(providerId: string, model: string, inputTokens: number, outputTokens: number): void {
    const usage = this.usage()
    const current = usage[providerId] ?? { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
    // Gateways set their own prices, so only Anthropic's own API gets an estimate.
    const cost = this.provider(providerId)?.firstParty ? estimateCost(model, inputTokens, outputTokens) : null
    this.kv.set(USAGE, {
      ...usage,
      [providerId]: {
        inputTokens: current.inputTokens + inputTokens,
        outputTokens: current.outputTokens + outputTokens,
        estimatedUsd: cost === null || current.estimatedUsd === null ? null : current.estimatedUsd + cost
      }
    })
    this.notify()
  }

  async secret(id: string): Promise<ProviderSecret> {
    const stored = this.kv.get(secretKey(id))
    if (typeof stored !== 'string') return { apiKey: '', headers: {} }
    try {
      return JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))).result) as ProviderSecret
    } catch {
      // The keychain changed or the value can't be read; treat the key as missing.
      return { apiKey: '', headers: {} }
    }
  }

  private async writeSecret(id: string, secret: ProviderSecret): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("This system can't store API keys securely yet.")
    this.kv.set(secretKey(id), (await safeStorage.encryptStringAsync(JSON.stringify(secret))).toString('base64'))
    this.kv.set(hasKeyKey(id), secret.apiKey !== '')
  }

  private keysProtected(): boolean {
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
