import { createHandler } from './src/app.ts'
import { loadConfig } from './src/config.ts'
import { KvStore } from './src/deno_kv.ts'
import { Limiter, MemoryStore } from './src/limits.ts'
import { loadRoutes } from './src/routes.ts'
import { createRouter } from './src/upstream.ts'

const env = (name: string) => Deno.env.get(name)
const config = loadConfig(env)
// USE_KV shares limits across instances, as Deno Deploy may run several.
const store = env('USE_KV') === 'true' ? new KvStore(await Deno.openKv()) : new MemoryStore()
const handle = createHandler({
  config,
  limiter: new Limiter(store, config),
  upstream: createRouter(loadRoutes(env))
})

Deno.serve({ port: config.port }, (request, info) => {
  const { remoteAddr } = info
  return handle(request, remoteAddr.transport === 'tcp' ? remoteAddr.hostname : 'unknown')
})
