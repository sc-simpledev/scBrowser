// The Cloudflare Workers version of main.ts. Same routes, limits and routing; limits are kept
// in one Durable Object so every Worker instance shares them.
import { DurableObject } from 'cloudflare:workers'
import { createHandler } from './src/app.ts'
import { loadConfig } from './src/config.ts'
import { type CounterStore, type LimitResult, Limiter } from './src/limits.ts'
import { loadRoutes } from './src/routes.ts'
import { createRouter } from './src/upstream.ts'

interface Env {
  LIMITS: DurableObjectNamespace<Limits>
  [name: string]: unknown
}

const reader = (env: Env) => (name: string) => (typeof env[name] === 'string' ? (env[name] as string) : undefined)

const HOUR = 3_600_000

/** Counters in the Durable Object's own SQLite storage, expiring like `MemoryStore`. */
export class SqlStore implements CounterStore {
  private swept = 0

  constructor(
    private readonly sql: SqlStorage,
    private readonly now: () => number = Date.now
  ) {
    sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value REAL NOT NULL, expires INTEGER NOT NULL)')
  }

  add(key: string, amount: number, ttlMs: number): Promise<number> {
    const now = this.now()
    if (now - this.swept > HOUR) {
      this.sql.exec('DELETE FROM counters WHERE expires <= ?', now)
      this.swept = now
    }
    const row = this.sql
      .exec<{ value: number }>(
        `INSERT INTO counters (key, value, expires) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET
           value = CASE WHEN expires <= ?4 THEN ?2 ELSE value + ?2 END,
           expires = CASE WHEN expires <= ?4 THEN ?3 ELSE expires END
         RETURNING value`,
        key,
        amount,
        now + ttlMs,
        now
      )
      .one()
    return Promise.resolve(row.value)
  }

  get(key: string): Promise<number> {
    const rows = this.sql.exec<{ value: number }>('SELECT value FROM counters WHERE key = ? AND expires > ?', key, this.now()).toArray()
    return Promise.resolve(rows[0]?.value ?? 0)
  }
}

/**
 * One instance holds every limit. Storage calls are synchronous here, so two requests can't
 * both slip under a limit at once. Concurrency slots live in memory and reset if it restarts.
 */
export class Limits extends DurableObject<Env> {
  private readonly limiter: Limiter

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.limiter = new Limiter(new SqlStore(ctx.storage.sql), loadConfig(reader(env)))
  }

  admit(ip: string): Promise<LimitResult> {
    return this.limiter.admit(ip)
  }

  finish(ip: string, tokens: number): Promise<void> {
    return this.limiter.finish(ip, tokens)
  }
}

type Handler = ReturnType<typeof createHandler>
let handler: Handler | Error | undefined

/** Built on the first request, as Workers only hand over variables then. */
function setUp(env: Env): Handler | Error {
  if (handler) return handler
  try {
    const config = loadConfig(reader(env))
    // A fresh stub each time, as Workers don't let one request use another's connections.
    const limits = () => env.LIMITS.get(env.LIMITS.idFromName('global'))
    handler = createHandler({
      config,
      limiter: {
        admit: (ip) => limits().admit(ip),
        finish: async (ip, tokens) => {
          await limits().finish(ip, tokens)
        }
      },
      upstream: createRouter(loadRoutes(reader(env)))
    })
  } catch (error) {
    handler = error instanceof Error ? error : new Error(String(error))
  }
  return handler
}

export default {
  fetch(request, env, ctx) {
    const handle = setUp(env)
    if (handle instanceof Error) {
      console.error(handle.message)
      return new Response(JSON.stringify({ error: { code: 'not_set_up', message: 'The AI server is not set up.' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      })
    }
    // Cloudflare sets this to the visitor's address and drops any copy the visitor sends.
    const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
    return handle(request, address, (work) => ctx.waitUntil(work))
  }
} satisfies ExportedHandler<Env>
