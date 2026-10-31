import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { createHandler, PUBLIC_MODEL } from './app.ts'
import { loadConfig } from './config.ts'
import { clientAddress, Limiter, MemoryStore } from './limits.ts'
import type { Upstream } from './upstream.ts'

const replying = (log: unknown[] = []): Upstream => ({
  async *stream(request) {
    log.push(request)
    yield { type: 'text', text: 'Hello' }
    yield { type: 'done', inputTokens: 10, outputTokens: 5, stopReason: 'end_turn' }
  }
})

function setup(overrides: Record<string, string> = {}, upstream = replying(), now = () => 1_000_000) {
  const config = loadConfig((name) => overrides[name])
  const limiter = new Limiter(new MemoryStore(now), config, now)
  return { handle: createHandler({ config, limiter, upstream }), limiter }
}

const chat = (body: unknown = { messages: [{ role: 'user', content: 'Hi' }] }, headers: HeadersInit = {}) =>
  new Request('http://server/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) })

Deno.test('streams a reply in OpenAI format', async () => {
  const { handle } = setup()
  const response = await handle(chat(), '1.1.1.1')
  assertEquals(response.status, 200)
  const body = await response.text()
  assertStringIncludes(body, '"content":"Hello"')
  assertStringIncludes(body, '"prompt_tokens":10')
  assert(body.trim().endsWith('data: [DONE]'))
})

Deno.test('lists only the public model', async () => {
  const { handle } = setup()
  const body = await (await handle(new Request('http://server/v1/models'), '1.1.1.1')).json()
  assertEquals(body.data.map((m: { id: string }) => m.id), [PUBLIC_MODEL])
})

Deno.test('ignores a client asking for a bigger reply or another model', async () => {
  const log: { maxTokens: number }[] = []
  const { handle } = setup({ MAX_OUTPUT_TOKENS: '100' }, replying(log))
  await (await handle(chat({ model: 'claude-fable-5-1', max_tokens: 999999, messages: [{ role: 'user', content: 'Hi' }] }), '1.1.1.1')).text()
  assertEquals(log[0]?.maxTokens, 100)
})

Deno.test('limits requests per minute, per address', async () => {
  const { handle } = setup({ REQUESTS_PER_MINUTE: '2' })
  await (await handle(chat(), '1.1.1.1')).text()
  await (await handle(chat(), '1.1.1.1')).text()
  const blocked = await handle(chat(), '1.1.1.1')
  assertEquals(blocked.status, 429)
  assertEquals(blocked.headers.get('retry-after'), '60')
  assertEquals((await handle(chat(), '2.2.2.2')).status, 200)
})

Deno.test('limits requests and tokens per day', async () => {
  const days = setup({ REQUESTS_PER_DAY: '1' })
  await (await days.handle(chat(), '1.1.1.1')).text()
  assertEquals(((await (await days.handle(chat(), '1.1.1.1')).json()) as { error: { code: string } }).error.code, 'daily_limit')

  const tokens = setup({ TOKENS_PER_DAY: '15' })
  await (await tokens.handle(chat(), '1.1.1.1')).text()
  await new Promise((r) => setTimeout(r, 0))
  assertEquals((await tokens.handle(chat(), '1.1.1.1')).status, 429)
})

Deno.test('a global budget stops everyone, returning 503', async () => {
  const { handle } = setup({ GLOBAL_TOKENS_PER_DAY: '15' })
  await (await handle(chat(), '1.1.1.1')).text()
  await new Promise((r) => setTimeout(r, 0))
  assertEquals((await handle(chat(), '9.9.9.9')).status, 503)
})

Deno.test('limits concurrent requests and frees the slot afterwards', async () => {
  let finish = () => {}
  const held = new Promise<void>((resolve) => (finish = resolve))
  const slow: Upstream = {
    async *stream() {
      await held
      yield { type: 'done', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' }
    }
  }
  const { handle } = setup({ CONCURRENT_PER_IP: '1' }, slow)
  const first = await handle(chat(), '1.1.1.1')
  assertEquals((await handle(chat(), '1.1.1.1')).status, 429)
  finish()
  await first.text()
  assertEquals((await handle(chat(), '1.1.1.1')).status, 200)
})

Deno.test('rejects oversized and malformed requests before spending anything', async () => {
  const log: unknown[] = []
  const { handle } = setup({ MAX_BODY_BYTES: '200', MAX_INPUT_CHARS: '50' }, replying(log))
  assertEquals((await handle(chat({ messages: [{ role: 'user', content: 'x'.repeat(500) }] }), '1.1.1.1')).status, 413)
  assertEquals((await handle(chat({ messages: [{ role: 'user', content: 'x'.repeat(60) }] }), '1.1.1.1')).status, 400)
  assertEquals((await handle(chat({ messages: [] }), '1.1.1.1')).status, 400)
  assertEquals((await handle(chat({ messages: [{ role: 'tool', content: 'x' }] }), '1.1.1.1')).status, 400)
  assertEquals((await handle(new Request('http://server/v1/chat/completions', { method: 'POST', body: '{' }), '1.1.1.1')).status, 400)
  assertEquals(log.length, 0)
})

Deno.test('never shows upstream errors', async () => {
  const failing: Upstream = {
    // deno-lint-ignore require-yield
    async *stream() {
      throw new Error('secret upstream detail')
    }
  }
  const { handle } = setup({}, failing)
  const body = await (await handle(chat(), '1.1.1.1')).text()
  assertStringIncludes(body, 'The AI service had a problem.')
  assert(!body.includes('secret'))
})

Deno.test('a cancelled reply still counts against the daily limit', async () => {
  const hanging: Upstream = {
    async *stream(_request, signal) {
      yield { type: 'text', text: 'Partial' }
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    }
  }
  const { handle } = setup({ TOKENS_PER_DAY: '100' }, hanging)
  const response = await handle(chat({ messages: [{ role: 'user', content: 'x'.repeat(1000) }] }), '1.1.1.1')
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
  await new Promise((r) => setTimeout(r, 10))
  assertEquals((await handle(chat(), '1.1.1.1')).status, 429)
})

Deno.test('forged forwarding headers do not change the limited address', () => {
  const forged = new Request('http://server/', { headers: { 'x-forwarded-for': '6.6.6.6' } })
  assertEquals(clientAddress(forged, '1.1.1.1', 0), '1.1.1.1')
  const proxied = new Request('http://server/', { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' } })
  assertEquals(clientAddress(proxied, '10.0.0.1', 1), '7.7.7.7')
})

Deno.test('groups IPv6 addresses by /64', () => {
  const request = new Request('http://server/')
  assertEquals(clientAddress(request, '2001:db8:1:2:aaaa::1', 0), clientAddress(request, '2001:db8:1:2:bbbb::9', 0))
})
