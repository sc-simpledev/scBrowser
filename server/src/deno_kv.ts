import type { CounterStore } from './limits.ts'

/** Shares limits across Deno Deploy instances. */
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
