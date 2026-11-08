// Runs worker.ts locally in `wrangler dev` (no Cloudflare account, nothing deployed) against
// fake AI providers on this machine, so no real provider is ever called. Run with `npm test`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'

const serverDir = fileURLToPath(new URL('..', import.meta.url))
const wranglerCli = join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const environment = { version: '0.4.6', electron: '45.1.0', platform: 'linux', arch: 'x64' }

/** A provider speaking either format. `hold` keeps replies open until released. */
function fakeProvider() {
  const calls = []
  let held = []
  const state = { failNext: 0, hold: false }
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (part) => (body += part))
    request.on('end', async () => {
      calls.push({ url: request.url, headers: request.headers, body: JSON.parse(body || '{}') })
      if (state.hold) await new Promise((resolve) => held.push(resolve))
      if (request.url === '/v1/chat/completions') {
        if (state.failNext > 0) {
          state.failNext--
          return response.writeHead(500).end('down')
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`)
        return response.end('data: [DONE]\n\n')
      }
      if (request.url === '/v1/messages') {
        const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        event('message_start', {
          message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } }
        })
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'From Anthropic format' } })
        event('content_block_stop', { index: 0 })
        event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
        event('message_stop', {})
        return response.end()
      }
      response.writeHead(404).end()
    })
  })
  return {
    calls,
    state,
    release: () => {
      held.forEach((resolve) => resolve())
      held = []
    },
    start: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections()
      })
  }
}

/** Starts `wrangler dev` with these variables and fresh, throwaway storage. */
async function startWorker(vars) {
  const persist = mkdtempSync(join(tmpdir(), 'scterra-worker-'))
  const port = 8800 + Math.floor(Math.random() * 1000)
  const args = [wranglerCli, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false']
  for (const [name, value] of Object.entries(vars)) args.push('--var', `${name}:${value}`)
  // Its own process group, so stopping it also stops the workerd processes it starts.
  const child = spawn(process.execPath, args, { cwd: serverDir, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } })
  let output = ''
  child.stdout.on('data', (part) => (output += part))
  child.stderr.on('data', (part) => (output += part))
  const base = `http://127.0.0.1:${port}`
  for (let tries = 0; ; tries++) {
    try {
      await fetch(`${base}/health`)
      break
    } catch {
      // Not up yet.
    }
    if (tries > 120 || child.exitCode !== null) throw new Error(`wrangler dev did not start:\n${output}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return {
    base,
    log: () => output,
    stop: async () => {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      process.kill(-child.pid, 'SIGTERM')
      await exited
      rmSync(persist, { recursive: true, force: true })
    }
  }
}

const chat = (base, ip = '1.1.1.1', content = 'Hi') =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ model: 'anything', messages: [{ role: 'user', content }] })
  })

describe('Workers server with OpenAI-format routes', () => {
  const provider = fakeProvider()
  let worker
  before(async () => {
    const port = await provider.start()
    worker = await startWorker({
      API_KEY_1: 'fake-key-one',
      MODEL_1: 'fake-model-one',
      BASE_URL_1: `http://127.0.0.1:${port}/v1`,
      REASONING_1: 'low',
      API_KEY_2: 'fake-key-two',
      MODEL_2: 'fake-model-two',
      BASE_URL_2: `http://127.0.0.1:${port}/v1`,
      REQUESTS_PER_MINUTE: '5',
      CONCURRENT_PER_IP: '1'
    })
  })
  after(async () => {
    await worker?.stop()
    await provider.stop()
  })

  test('health and the public model list', async () => {
    assert.deepEqual(await (await fetch(`${worker.base}/health`)).json(), { ok: true })
    const models = await (await fetch(`${worker.base}/v1/models`)).json()
    assert.deepEqual(models.data.map((model) => model.id), ['scterra-chat'])
    assert.equal((await fetch(`${worker.base}/nowhere`)).status, 404)
  })

  test('streams a reply in OpenAI format, sending the route key and model upstream', async () => {
    const response = await chat(worker.base, '1.1.1.1')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/event-stream')
    const body = await response.text()
    assert.match(body, /"content":"Hello"/)
    assert.match(body, /"content":" there"/)
    assert.match(body, /"prompt_tokens":10/)
    assert.ok(body.trim().endsWith('data: [DONE]'))
    const call = provider.calls.at(-1)
    assert.match(call.headers.authorization, /^Bearer fake-key-(one|two)$/)
    assert.ok(['fake-model-one', 'fake-model-two'].includes(call.body.model))
    assert.equal(call.body.stream, true)
  })

  test('fails over to another route before any text is sent', async () => {
    // Both routes share the fake provider, so the first call fails and the next succeeds.
    provider.state.failNext = 1
    const before = provider.calls.length
    const response = await chat(worker.base, '2.2.2.2')
    const body = await response.text()
    assert.equal(response.status, 200)
    assert.equal(provider.calls.length - before, 2, 'one failed call, then one that worked')
    assert.match(body, /"content":"Hello"/)
    const [failed, worked] = provider.calls.slice(before)
    assert.notEqual(failed.body.model, worked.body.model, 'the backup is the other route')
  })

  test('hides upstream errors when every route fails', async () => {
    provider.state.failNext = 2
    const body = await (await chat(worker.base, '3.3.3.3')).text()
    assert.equal(provider.state.failNext, 0, 'both routes were tried')
    assert.match(body, /The AI service had a problem\./)
    assert.doesNotMatch(body, /down|500/)
  })

  test('rejects bad requests before calling a provider', async () => {
    const before = provider.calls.length
    const bad = await fetch(`${worker.base}/v1/chat/completions`, { method: 'POST', headers: { 'cf-connecting-ip': '4.4.4.4' }, body: '{' })
    assert.equal(bad.status, 400)
    assert.equal((await fetch(`${worker.base}/v1/chat/completions`)).status, 405)
    assert.equal(provider.calls.length, before)
  })

  test('limits concurrent replies per address, shared through the Durable Object', async () => {
    provider.state.hold = true
    const first = await chat(worker.base, '5.5.5.5')
    assert.equal(first.status, 200)
    const second = await chat(worker.base, '5.5.5.5')
    assert.equal(second.status, 429)
    await second.text()
    assert.equal((await chat(worker.base, '6.6.6.6')).status, 200, 'another address is unaffected')
    provider.state.hold = false
    provider.release()
    await first.text()
    // The slot is freed in waitUntil after the stream ends.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const third = await chat(worker.base, '5.5.5.5')
    assert.equal(third.status, 200)
    await third.text()
  })

  test('limits requests per minute, per address', async () => {
    const statuses = []
    for (let i = 0; i < 6; i++) {
      const response = await chat(worker.base, '7.7.7.7')
      statuses.push(response.status)
      await response.text()
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429])
    const blocked = await chat(worker.base, '7.7.7.7')
    assert.equal(blocked.headers.get('retry-after'), '60')
    await blocked.text()
  })

  test('takes reports, keeping only known fields, and logs them', async () => {
    const response = await fetch(`${worker.base}/v1/reports`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': '8.8.8.8' },
      body: JSON.stringify({ type: 'crash', ...environment, kind: 'page', reason: 'crashed-for-test', url: 'https://secret.example' })
    })
    assert.equal(response.status, 200)
    const bad = await fetch(`${worker.base}/v1/reports`, { method: 'POST', body: JSON.stringify({ type: 'other' }) })
    assert.equal(bad.status, 400)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.match(worker.log(), /crashed-for-test/)
    assert.doesNotMatch(worker.log(), /secret\.example/)
  })
})

describe('Workers server with an Anthropic-format route', () => {
  const provider = fakeProvider()
  let worker
  before(async () => {
    const port = await provider.start()
    worker = await startWorker({
      API_KEY_1: 'fake-anthropic-key',
      MODEL_1: 'fake-claude',
      BASE_URL_1: `http://127.0.0.1:${port}`,
      FORMAT_1: 'anthropic',
      TOKENS_PER_DAY: '20'
    })
  })
  after(async () => {
    await worker?.stop()
    await provider.stop()
  })

  test('streams through the Anthropic SDK inside the Workers runtime', async () => {
    const response = await chat(worker.base, '1.1.1.1')
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /"content":"From Anthropic format"/)
    assert.match(body, /"prompt_tokens":12,"completion_tokens":4/)
    const call = provider.calls.at(-1)
    assert.equal(call.url, '/v1/messages')
    // SDK 1.x sends the key as a bearer token.
    assert.ok(call.headers['x-api-key'] === 'fake-anthropic-key' || call.headers.authorization === 'Bearer fake-anthropic-key')
    assert.equal(call.body.model, 'fake-claude')
  })

  test('charges tokens to the daily limit', async () => {
    // The first reply used 16 tokens of 20; the second goes over, so the third is refused.
    await (await chat(worker.base, '1.1.1.1')).text()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const blocked = await chat(worker.base, '1.1.1.1')
    assert.equal(blocked.status, 429)
    assert.equal((await blocked.json()).error.code, 'daily_limit')
  })
})

describe('Workers server without routes', () => {
  let worker
  before(async () => {
    worker = await startWorker({})
  })
  after(async () => {
    await worker?.stop()
  })

  test('says it is not set up instead of crashing', async () => {
    const response = await fetch(`${worker.base}/health`)
    assert.equal(response.status, 500)
    assert.equal((await response.json()).error.code, 'not_set_up')
  })
})
