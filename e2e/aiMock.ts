import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  url: string
  headers: IncomingHttpHeaders
  body: { messages?: { role: string; content: string }[]; tools?: { function?: { name?: string } }[] }
}

export interface AiMock {
  url: string
  requests: RecordedRequest[]
  /** Hits on any path that isn't part of the API, e.g. an image a reply tried to load. */
  strayHits: string[]
  reply: string[]
  /** Replies to use first, one per request. */
  queue: string[]
  status: number
  /** Reports to write as a tool call, one per request that offers tools: the call's arguments, in pieces. */
  toolQueue: string[][]
  /** Turn down any request that offers tools, as a model without tool support does. */
  rejectTools: boolean
  /** Why each reply ends, one per request, for replies that hit their length limit. */
  finish: string[]
  /** Stop after the first chunk and hold the connection open. */
  hang: boolean
  server: Server
}

const sse = (...events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')

const anthropicEvent = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

/** Speaks both the OpenAI and Anthropic streaming formats. */
export async function startAiMock(): Promise<AiMock> {
  const mock: AiMock = { url: '', requests: [], strayHits: [], reply: ['Hello ', 'there'], queue: [], toolQueue: [], rejectTools: false, finish: [], status: 200, hang: false, server: null! }

  mock.server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = req.url ?? ''
      const path = url.split('?')[0] ?? ''
      if (path.endsWith('/models')) {
        res.writeHead(mock.status === 200 ? 200 : mock.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-model', type: 'model', display_name: 'Mock', created_at: '2026-01-01T00:00:00Z' }], has_more: false }))
        return
      }
      if (path !== '/v1/chat/completions' && path !== '/v1/messages') {
        mock.strayHits.push(url)
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as RecordedRequest['body']
      mock.requests.push({ url, headers: req.headers, body })
      if (mock.rejectTools && body.tools?.length) {
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"this model does not support tools"}}')
        return
      }
      if (mock.status !== 200) {
        res.writeHead(mock.status, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"x","message":"nope"}}')
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (path === '/v1/chat/completions') {
        const call = body.tools?.length ? mock.toolQueue.shift() : undefined
        if (call) {
          res.write(sse({ choices: [{ delta: { content: 'Here is your report.' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: body.tools![0]!.function?.name, arguments: '' } }] } }] }))
          res.write(sse(...call.map((piece) => ({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] } }] }))))
          res.end(`${sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}data: [DONE]\n\n`)
          return
        }
        const queued = mock.queue.shift()
        const parts = queued !== undefined ? [queued] : mock.hang ? mock.reply.slice(0, 1) : mock.reply
        res.write(sse(...parts.map((content) => ({ choices: [{ delta: { content } }] }))))
        if (mock.hang) return
        res.end(`${sse({ choices: [{ delta: {}, finish_reason: mock.finish.shift() ?? 'stop' }] }, { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}data: [DONE]\n\n`)
        return
      }
      res.end(
        anthropicEvent('message_start', {
          message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'mock-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 1 } }
        }) +
          anthropicEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
          mock.reply.map((text) => anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })).join('') +
          anthropicEvent('content_block_stop', { index: 0 }) +
          anthropicEvent('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } }) +
          anthropicEvent('message_stop', {})
      )
    })
  })
  await new Promise<void>((r) => mock.server.listen(0, '127.0.0.1', r))
  mock.url = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`
  return mock
}
