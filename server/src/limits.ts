import type { Config } from './config.ts'

/** Counters that expire. Memory for one server; Deno KV to share across several. */
export interface CounterStore {
  add(key: string, amount: number, ttlMs: number): Promise<number>
  get(key: string): Promise<number>
}

export class MemoryStore implements CounterStore {
  private readonly counters = new Map<string, { value: number; expires: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const entry = this.counters.get(key)
    if (entry && entry.expires <= this.now()) {
      this.counters.delete(key)
      return undefined
    }
    return entry
  }

  add(key: string, amount: number, ttlMs: number): Promise<number> {
    const entry = this.live(key)
    const value = (entry?.value ?? 0) + amount
    this.counters.set(key, { value, expires: entry?.expires ?? this.now() + ttlMs })
    return Promise.resolve(value)
  }

  get(key: string): Promise<number> {
    return Promise.resolve(this.live(key)?.value ?? 0)
  }
}

export class KvStore implements CounterStore {
  constructor(private readonly kv: Deno.Kv) {}

  async add(key: string, amount: number, ttlMs: number): Promise<number> {
    for (;;) {
      const entry = await this.kv.get<number>(['limits', key])
      const value = (entry.value ?? 0) + amount
      const { ok } = await this.kv.atomic().check(entry).set(['limits', key], value, { expireIn: ttlMs }).commit()
      if (ok) return value
    }
  }

  async get(key: string): Promise<number> {
    return (await this.kv.get<number>(['limits', key])).value ?? 0
  }
}

const MINUTE = 60_000
const DAY = 86_400_000

export type LimitResult = { allowed: true } | { allowed: false; code: 'rate_limited' | 'daily_limit' | 'busy'; retryAfterSeconds: number }

/** The address to limit by. Headers can be forged, so they count only behind a known proxy. */
export function clientAddress(request: Request, remote: string, trustedProxyHops: number): string {
  let address = remote
  if (trustedProxyHops > 0) {
    const chain = (request.headers.get('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean)
    address = chain.at(-trustedProxyHops) ?? remote
  }
  // One IPv6 customer usually owns a whole /64, so limit the block rather than each address.
  return address.includes(':') ? address.split(':').slice(0, 4).join(':') : address
}

export class Limiter {
  private readonly active = new Map<string, number>()

  constructor(
    private readonly store: CounterStore,
    private readonly config: Config,
    private readonly now: () => number = Date.now
  ) {}

  private day = () => Math.floor(this.now() / DAY)
  private secondsToTomorrow = () => Math.ceil((DAY - (this.now() % DAY)) / 1000)
  private tokensKey = (ip: string) => `tokens:${this.day()}:${ip}`
  private globalKey = () => `global:${this.day()}`

  /** Checks every limit and, if allowed, holds a concurrency slot until `release`. */
  async admit(ip: string): Promise<LimitResult> {
    const { config } = this
    if ((await this.store.get(this.globalKey())) >= config.globalTokensPerDay) {
      return { allowed: false, code: 'busy', retryAfterSeconds: this.secondsToTomorrow() }
    }
    if ((await this.store.get(this.tokensKey(ip))) >= config.tokensPerDay) {
      return { allowed: false, code: 'daily_limit', retryAfterSeconds: this.secondsToTomorrow() }
    }
    if ((this.active.get(ip) ?? 0) >= config.concurrentPerIp) {
      return { allowed: false, code: 'rate_limited', retryAfterSeconds: 5 }
    }
    const minute = Math.floor(this.now() / MINUTE)
    if ((await this.store.add(`minute:${minute}:${ip}`, 1, MINUTE * 2)) > config.requestsPerMinute) {
      return { allowed: false, code: 'rate_limited', retryAfterSeconds: 60 }
    }
    if ((await this.store.add(`requests:${this.day()}:${ip}`, 1, DAY * 2)) > config.requestsPerDay) {
      return { allowed: false, code: 'daily_limit', retryAfterSeconds: this.secondsToTomorrow() }
    }
    this.active.set(ip, (this.active.get(ip) ?? 0) + 1)
    return { allowed: true }
  }

  release(ip: string): void {
    const count = (this.active.get(ip) ?? 1) - 1
    if (count > 0) this.active.set(ip, count)
    else this.active.delete(ip)
  }

  async recordTokens(ip: string, tokens: number): Promise<void> {
    await this.store.add(this.tokensKey(ip), tokens, DAY * 2)
    await this.store.add(this.globalKey(), tokens, DAY * 2)
  }
}
