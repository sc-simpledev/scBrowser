import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { ProviderSecret } from '@scbrowser/ai'
import { estimateCost, type AiState, type AiStatus, type ModelRef, type ModelRole, type ProviderConfig, type ProviderProtocol, type ProviderUsage } from '@scbrowser/shared'
import type { KeyValueRepo } from '../storage/kv'

const PROVIDERS = 'ai:providers'
const ROLES = 'ai:roles'
const USAGE = 'ai:usage'
const DISABLED = 'ai:disabled-hosts'
const secretKey = (id: string) => `ai:secret:${id}`

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
  private readonly listeners = new Set<() => void>()

  constructor(private readonly kv: KeyValueRepo) {
    // Without a keyring Linux would refuse to store keys at all. Allow it, and let the
    // AI settings page warn that they're only obfuscated (see `keysProtected`).
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      safeStorage.setUsePlainTextEncryption(true)
    }
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
      providers: this.providers().map((p) => ({ ...p, hasKey: this.secret(p.id).apiKey !== '' })),
      roles: this.roles(),
      usage: this.usage(),
      disabledHosts: this.disabledHosts(),
      keysProtected: this.keysProtected()
    }
  }

  status(): AiStatus {
    const chat = this.roles().chat
    const provider = chat && this.provider(chat.providerId)
    return {
      ready: !!provider,
      model: provider ? chat.model : null,
      providerName: provider?.name ?? null,
      disabledHosts: this.disabledHosts()
    }
  }

  save(input: ProviderInput): string {
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
      const current = this.secret(id)
      this.writeSecret(id, {
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

  secret(id: string): ProviderSecret {
    const stored = this.kv.get(secretKey(id))
    if (typeof stored !== 'string') return { apiKey: '', headers: {} }
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(stored, 'base64'))) as ProviderSecret
    } catch {
      // The keychain changed or the value can't be read; treat the key as missing.
      return { apiKey: '', headers: {} }
    }
  }

  private writeSecret(id: string, secret: ProviderSecret): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This system can't store API keys securely yet.")
    this.kv.set(secretKey(id), safeStorage.encryptString(JSON.stringify(secret)).toString('base64'))
  }

  private keysProtected(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
