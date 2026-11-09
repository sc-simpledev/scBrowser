import type { Config } from './config.ts'
import { clientAddress, type Limiter } from './limits.ts'
import type { Upstream, UpstreamMessage, UpstreamTool, UpstreamToolCall } from './upstream.ts'

/** The only model apps can name; which real model runs is our choice. */
export const PUBLIC_MODEL = 'scterra-chat'

const CHARS_PER_TOKEN = 4

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const failure = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  json({ error: { code, message } }, status, headers)

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`

interface ChatBody {
  system: string
  messages: UpstreamMessage[]
  maxTokens: number
  tools?: UpstreamTool[]
}

const MAX_TOOLS = 32

function parseTools(value: unknown): UpstreamTool[] | null {
  if (!Array.isArray(value) || value.length > MAX_TOOLS) return null
  const tools: UpstreamTool[] = []
  for (const item of value as { type?: unknown; function?: { name?: unknown; description?: unknown; parameters?: unknown } }[]) {
    const fn = item?.function
    if (item?.type !== 'function' || typeof fn?.name !== 'string' || fn.name.length > 64 || typeof fn.description !== 'string' || typeof fn.parameters !== 'object' || fn.parameters === null) return null
    tools.push({ name: fn.name, description: fn.description, parameters: fn.parameters as Record<string, unknown> })
  }
  return tools
}

function parseToolCalls(value: unknown): UpstreamToolCall[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const calls: UpstreamToolCall[] = []
  for (const item of value as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]) {
    if (typeof item?.id !== 'string' || typeof item.function?.name !== 'string' || typeof item.function.arguments !== 'string') return null
    calls.push({ id: item.id, name: item.function.name, arguments: item.function.arguments })
  }
  return calls
}

function parseChat(text: string, config: Config): ChatBody | string {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return 'The request is not valid JSON.'
  }
  const { messages, max_tokens: maxTokens, tools: rawTools } = (body ?? {}) as { messages?: unknown; max_tokens?: unknown; tools?: unknown }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 500) return 'messages is required.'

  const system: string[] = []
  const conversation: UpstreamMessage[] = []
  let characters = 0
  const tools = rawTools === undefined ? undefined : parseTools(rawTools)
  if (tools === null) return 'tools is not valid.'
  if (tools) characters += JSON.stringify(tools).length
  for (const message of messages as { role?: unknown; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown }[]) {
    if (message?.role === 'tool') {
      if (typeof message.content !== 'string' || typeof message.tool_call_id !== 'string') return 'Each tool result needs text content and an id.'
      characters += message.content.length
      const result = { id: message.tool_call_id, content: message.content }
      const last = conversation.at(-1)
      // Several results in a row answer one reply, and go up as one turn.
      if (last?.toolResults) last.toolResults.push(result)
      else conversation.push({ role: 'user', content: '', toolResults: [result] })
      continue
    }
    if (message?.role === 'assistant' && message.tool_calls !== undefined) {
      const toolCalls = parseToolCalls(message.tool_calls)
      if (!toolCalls || (message.content !== null && typeof message.content !== 'string')) return 'tool_calls is not valid.'
      const content = message.content ?? ''
      characters += (content as string).length + toolCalls.reduce((sum, call) => sum + call.arguments.length, 0)
      conversation.push({ role: 'assistant', content: content as string, toolCalls })
      continue
    }
    if (typeof message?.content !== 'string') return 'Each message needs text content.'
    characters += message.content.length
    if (message.role === 'system') system.push(message.content)
    else if (message.role === 'user' || message.role === 'assistant') conversation.push({ role: message.role, content: message.content })
    else return 'Unknown message role.'
  }
  if (characters > config.maxInputChars) return 'This request is too long.'
  if (conversation[0]?.role !== 'user' || conversation.at(-1)?.role !== 'user') return 'The conversation must start and end with a user message.'

  const requested = typeof maxTokens === 'number' && maxTokens > 0 ? Math.floor(maxTokens) : config.maxOutputTokens
  return { system: system.join('\n\n'), messages: conversation, maxTokens: Math.min(requested, config.maxOutputTokens), ...(tools?.length ? { tools } : {}) }
}

async function readBody(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function streamReply(chat: ChatBody, upstream: Upstream, finish: (tokens: number) => void): Response {
  const encoder = new TextEncoder()
  const controller = new AbortController()
  const base = { id: crypto.randomUUID(), object: 'chat.completion.chunk', model: PUBLIC_MODEL }

  const body = new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (data: unknown) => out.enqueue(encoder.encode(chunk(data)))
      // If the reply is cut short there's no usage report, so charge an estimate:
      // otherwise cancelling every reply would dodge the daily limits.
      const inputChars = chat.system.length + chat.messages.reduce((sum, m) => sum + m.content.length + (m.toolResults ?? []).reduce((n, r) => n + r.content.length, 0), 0)
      let outputChars = 0
      let toolIndex = 0
      let tokens: number | null = null
      try {
        for await (const event of upstream.stream(chat, controller.signal)) {
          if (event.type === 'text') {
            outputChars += event.text.length
            send({ ...base, choices: [{ index: 0, delta: { content: event.text } }] })
          } else if (event.type === 'tool') {
            outputChars += event.call.arguments.length
            send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndex++, id: event.call.id, type: 'function', function: { name: event.call.name, arguments: event.call.arguments } }] } }] })
          } else {
            tokens = event.inputTokens + event.outputTokens
            send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: event.stopReason }] })
            send({ ...base, choices: [], usage: { prompt_tokens: event.inputTokens, completion_tokens: event.outputTokens } })
          }
        }
        out.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch {
        if (!controller.signal.aborted) send({ ...base, error: { message: 'The AI service had a problem.' } })
      } finally {
        finish(tokens ?? Math.ceil((inputChars + outputChars) / CHARS_PER_TOKEN))
        try {
          out.close()
        } catch {
          // The client already went away.
        }
      }
    },
    cancel: () => controller.abort()
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

const MAX_REPORT_BYTES = 4096
const REPORTS_PER_HOUR = 30
const HOUR_MS = 3_600_000

const shortText = (value: unknown, max: number) => typeof value === 'string' && value.length <= max

/** Reports from people who opted in. Only these fields are kept, and never the sender's address. */
function parseReport(text: string): Record<string, unknown> | null {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const { type, version, electron, platform, arch, kind, reason, stack } = body ?? {}
  if (type !== 'crash' && type !== 'usage') return null
  if (![version, electron, platform, arch].every((field) => shortText(field, 32))) return null
  if (type === 'usage') return { type, version, electron, platform, arch }
  if (!shortText(kind, 16) || !shortText(reason, 64) || !(stack === undefined || shortText(stack, 2000))) return null
  return { type, version, electron, platform, arch, kind, reason, stack }
}

export interface Dependencies {
  config: Config
  /** A `Limiter`, or on Workers a stand-in that calls the shared one in a Durable Object. */
  limiter: Pick<Limiter, 'admit' | 'finish'>
  upstream: Upstream
}

/** Keeps work going after the response, such as charging tokens (Workers' `ctx.waitUntil`). */
export type WaitUntil = (work: Promise<unknown>) => void

/** Request contents are never logged or stored; only per-address counters are kept. */
export function createHandler({ config, limiter, upstream }: Dependencies, record: (report: unknown) => void = (report) => console.log(JSON.stringify(report)), now = Date.now) {
  const reportCounts = new Map<string, { count: number; start: number }>()
  const reportAllowed = (ip: string) => {
    const entry = reportCounts.get(ip)
    if (!entry || now() - entry.start > HOUR_MS) {
      if (reportCounts.size > 10_000) reportCounts.clear()
      reportCounts.set(ip, { count: 1, start: now() })
      return true
    }
    return ++entry.count <= REPORTS_PER_HOUR
  }

  return async (request: Request, remoteAddress: string, waitUntil?: WaitUntil): Promise<Response> => {
    const { pathname } = new URL(request.url)
    if (request.method === 'POST' && pathname === '/v1/reports') {
      const text = await readBody(request, MAX_REPORT_BYTES)
      if (text === null) return failure(413, 'too_large', 'This request is too large.')
      const report = parseReport(text)
      if (!report) return failure(400, 'bad_request', 'Not a valid report.')
      if (!reportAllowed(clientAddress(request, remoteAddress, config.trustedProxyHops))) return failure(429, 'rate_limited', 'Too many reports.')
      record(report)
      return json({ ok: true })
    }
    if (request.method === 'GET' && pathname === '/health') return json({ ok: true })
    if (request.method === 'GET' && pathname === '/v1/models') return json({ object: 'list', data: [{ id: PUBLIC_MODEL, object: 'model' }] })
    if (pathname !== '/v1/chat/completions') return failure(404, 'not_found', 'Not found.')
    if (request.method !== 'POST') return failure(405, 'method_not_allowed', 'Use POST.')

    const text = await readBody(request, config.maxBodyBytes)
    if (text === null) return failure(413, 'too_large', 'This request is too large.')
    const chat = parseChat(text, config)
    if (typeof chat === 'string') return failure(400, 'bad_request', chat)

    const ip = clientAddress(request, remoteAddress, config.trustedProxyHops)
    const decision = await limiter.admit(ip)
    if (!decision.allowed) {
      const headers = { 'retry-after': String(decision.retryAfterSeconds) }
      const status = decision.code === 'busy' ? 503 : 429
      return failure(status, decision.code, 'The free AI limit has been reached.', headers)
    }
    return streamReply(chat, upstream, (tokens) => {
      const charged = limiter.finish(ip, tokens).catch((error) => console.error('Could not record usage', error))
      waitUntil?.(charged)
    })
  }
}
