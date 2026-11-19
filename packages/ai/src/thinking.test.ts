import { describe, expect, it } from 'vitest'
import { isCoderEffort } from '@scbrowser/shared'
import { createAnthropicProvider, replayBlocks, toAnthropicMessages } from './anthropic'
import { createOpenAiProvider, openAiEffort } from './openai'
import type { ChatEvent } from './types'

const collect = async <T>(items: AsyncIterable<T>) => {
  const out: T[] = []
  for await (const item of items) out.push(item)
  return out
}

const sse = (events: object[]) => new Response(events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })

describe('thinking and effort', () => {
  it('keeps a reply that thought as blocks to send back, and leaves others alone', () => {
    const blocks = replayBlocks([
      { type: 'thinking', thinking: 'Look first.', signature: 'sig' },
      { type: 'text', text: 'Reading.', citations: null },
      { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.txt' } }
    ] as never)
    expect(blocks).toEqual([
      { type: 'thinking', thinking: 'Look first.', signature: 'sig' },
      { type: 'text', text: 'Reading.' },
      { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.txt' } }
    ])
    expect(replayBlocks([{ type: 'text', text: 'Plain.', citations: null }] as never)).toBeNull()
    // Something it can't copy faithfully means nothing is kept, as before.
    expect(replayBlocks([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'fallback' }] as never)).toBeNull()
  })

  it('sends an assistant turn back exactly as Claude wrote it', () => {
    const blocks = [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'tool_use', id: 't1', name: 'read', input: {} }]
    const [, assistant] = toAnthropicMessages([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolUses: [{ id: 't1', name: 'read', input: {} }], blocks }
    ])
    expect(assistant).toEqual({ role: 'assistant', content: blocks })
  })

  it('asks the OpenAI format for at most high', () => {
    expect(openAiEffort('max')).toBe('high')
    expect(openAiEffort('xhigh')).toBe('high')
    expect(openAiEffort('low')).toBe('low')
    expect(isCoderEffort('xhigh')).toBe(true)
    expect(isCoderEffort('extreme')).toBe(false)
  })


  it('streams Claude’s summarised thinking, asks for it, and keeps the blocks', async () => {
    let body: Record<string, unknown> = {}
    const provider = createAnthropicProvider({
      config: { id: 'a', name: 'Claude', protocol: 'anthropic', baseUrl: 'https://claude.test', models: [], firstParty: false },
      secret: { apiKey: 'k', headers: {} },
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>
        return sse([
          { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check the ' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'file.' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } },
          { type: 'message_stop' }
        ])
      }) as typeof fetch
    })
    const events = await collect(provider.chat({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, effort: 'xhigh', reasoning: true }))
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(body.output_config).toEqual({ effort: 'xhigh' })
    expect(events.filter((event): event is Extract<ChatEvent, { type: 'reasoning' }> => event.type === 'reasoning').map((event) => event.text).join('')).toBe('Check the file.')
    expect(events).toContainEqual({ type: 'blocks', blocks: [{ type: 'thinking', thinking: 'Check the file.', signature: 'sig' }, { type: 'text', text: 'Done.' }] })
  })

  it('reads reasoning from OpenAI-style gateways under either name', async () => {
    const chunk = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
    const provider = createOpenAiProvider({
      config: { id: 'o', name: 'Gateway', protocol: 'openai', baseUrl: 'https://ai.test/v1', models: [], firstParty: false },
      secret: { apiKey: 'k', headers: {} },
      fetch: (async () => new Response(chunk({ reasoning_content: 'Hmm, ' }) + chunk({ reasoning: 'yes.' }) + chunk({ content: 'Answer.' }) + 'data: [DONE]\n\n')) as typeof fetch
    })
    const events = await collect(provider.chat({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }))
    expect(events.slice(0, 3)).toEqual([
      { type: 'reasoning', text: 'Hmm, ' },
      { type: 'reasoning', text: 'yes.' },
      { type: 'text', text: 'Answer.' }
    ])
  })
})
