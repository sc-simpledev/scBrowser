import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { loadRoutes, shuffleByWeight, type Route } from './routes.ts'
import { createRouteUpstream, createRouter, type Upstream, type UpstreamEvent } from './upstream.ts'

const fromEnv = (values: Record<string, string>) => (name: string) => values[name]

const route = (id: number, weight = 1): Route => ({ id, apiKey: `k${id}`, model: `m${id}`, format: 'openai', weight })

const request = { system: '', messages: [{ role: 'user' as const, content: 'Hi' }], maxTokens: 10 }

const collect = async (upstream: Upstream) => {
  const events: UpstreamEvent[] = []
  for await (const event of upstream.stream(request, new AbortController().signal)) events.push(event)
  return events
}

const named = (text: string): Upstream => ({
  async *stream() {
    yield { type: 'text', text }
    yield { type: 'done', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' }
  }
})

const broken: Upstream = {
  // deno-lint-ignore require-yield
  async *stream() {
    throw new Error('rate limited')
  }
}

Deno.test('reads numbered routes with gaps and defaults', () => {
  const routes = loadRoutes(fromEnv({
    API_KEY_1: 'a',
    MODEL_1: 'claude-opus-5-5',
    REASONING_1: 'low',
    API_KEY_3: 'b',
    MODEL_3: 'gpt',
    BASE_URL_3: 'https://gateway.dev/v1',
    WEIGHTING_3: '4'
  }))
  assertEquals(routes, [
    { id: 1, apiKey: 'a', model: 'claude-opus-5-5', format: 'anthropic', weight: 1, reasoning: 'low' },
    { id: 3, apiKey: 'b', model: 'gpt', format: 'openai', weight: 4, baseUrl: 'https://gateway.dev/v1' }
  ])
})

Deno.test('rejects bad setups at startup', () => {
  assertThrows(() => loadRoutes(fromEnv({})), Error, 'API_KEY_1')
  assertThrows(() => loadRoutes(fromEnv({ API_KEY_1: 'a' })), Error, 'MODEL_1')
  assertThrows(() => loadRoutes(fromEnv({ API_KEY_1: 'a', MODEL_1: 'm', WEIGHTING_1: '-1' })), Error, 'WEIGHTING_1')
  assertThrows(() => loadRoutes(fromEnv({ API_KEY_1: 'a', MODEL_1: 'm', FORMAT_1: 'x' })), Error, 'FORMAT_1')
})

Deno.test('a weight of zero switches a route off', () => {
  const routes = loadRoutes(fromEnv({ API_KEY_1: 'a', MODEL_1: 'm', WEIGHTING_1: '0', API_KEY_2: 'b', MODEL_2: 'n' }))
  assertEquals(routes.map((r) => r.id), [2])
})

Deno.test('picks routes in proportion to their weight', () => {
  const routes = [route(1, 1), route(2, 3)]
  const counts = { 1: 0, 2: 0 }
  let seed = 0
  const random = () => (seed = (seed * 16807 + 1) % 2147483647) / 2147483647
  for (let i = 0; i < 4000; i++) counts[shuffleByWeight(routes, random)[0]!.id as 1 | 2]++
  const share = counts[2] / 4000
  assertEquals(share > 0.7 && share < 0.8, true)
})

Deno.test('one route is used directly, without randomness', async () => {
  const router = createRouter([route(1)], () => named('only'), () => {
    throw new Error('random should not be called')
  })
  assertEquals((await collect(router))[0], { type: 'text', text: 'only' })
})

Deno.test('moves to the next route if one fails before any text', async () => {
  const router = createRouter([route(1), route(2)], (r) => (r.id === 1 ? broken : named('second')), () => 0)
  assertEquals((await collect(router))[0], { type: 'text', text: 'second' })
})

Deno.test('does not retry once text has been sent, or when all fail', async () => {
  const partial: Upstream = {
    async *stream() {
      yield { type: 'text', text: 'half' }
      throw new Error('dropped')
    }
  }
  await assertRejects(() => collect(createRouter([route(1), route(2)], (r) => (r.id === 1 ? partial : named('x')), () => 0)))
  await assertRejects(() => collect(createRouter([route(1), route(2)], () => broken)))
})

Deno.test('OpenAI-format routes send key, model and reasoning, and parse the stream', async () => {
  let sent: { url: string; body: Record<string, unknown>; auth: string | null } | undefined
  const fake = ((url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(init.body as string), auth: new Headers(init.headers).get('authorization') }
    return Promise.resolve(new Response(
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\ndata: {"choices":[{"delta":{"content":"y"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata: [DONE]\n\n'
    ))
  }) as typeof fetch
  const events = await collect(createRouteUpstream({ ...route(1), baseUrl: 'https://gw.dev/v1/', reasoning: 'high' }, fake))
  assertEquals(events, [
    { type: 'text', text: 'He' },
    { type: 'text', text: 'y' },
    { type: 'done', inputTokens: 2, outputTokens: 3, stopReason: 'stop' }
  ])
  assertEquals(sent?.url, 'https://gw.dev/v1/chat/completions')
  assertEquals(sent?.auth, 'Bearer k1')
  assertEquals(sent?.body.model, 'm1')
  assertEquals(sent?.body.reasoning_effort, 'high')
})
