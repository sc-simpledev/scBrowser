import Anthropic from '@anthropic-ai/sdk'
import { shuffleByWeight, type Route } from './routes.ts'

export interface UpstreamToolCall {
  id: string
  name: string
  /** JSON text, as the OpenAI format carries it. */
  arguments: string
}

export interface UpstreamTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface UpstreamMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: UpstreamToolCall[]
  toolResults?: { id: string; content: string }[]
}

export type UpstreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; call: UpstreamToolCall }
  | { type: 'done'; inputTokens: number; outputTokens: number; stopReason: string | null }

export interface UpstreamRequest {
  system: string
  messages: UpstreamMessage[]
  maxTokens: number
  tools?: UpstreamTool[]
}

export interface Upstream {
  stream(request: UpstreamRequest, signal: AbortSignal): AsyncIterable<UpstreamEvent>
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const SUPPORTS_FALLBACKS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/

function parsedArguments(text: string): unknown {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return {}
  }
}

function anthropicMessages(messages: UpstreamMessage[]) {
  return messages.map(({ role, content, toolCalls, toolResults }) => {
    const said = content ? [{ type: 'text' as const, text: content }] : []
    if (toolCalls?.length) return { role, content: [...said, ...toolCalls.map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.name, input: parsedArguments(call.arguments) }))] }
    if (toolResults?.length) return { role, content: [...toolResults.map((result) => ({ type: 'tool_result' as const, tool_use_id: result.id, content: result.content })), ...said] }
    return { role, content }
  })
}

function openAiMessages(messages: UpstreamMessage[]): unknown[] {
  return messages.flatMap(({ role, content, toolCalls, toolResults }): unknown[] => {
    if (toolCalls?.length) return [{ role, content: content || null, tool_calls: toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }]
    if (toolResults?.length) return [...toolResults.map((result) => ({ role: 'tool', tool_call_id: result.id, content: result.content })), ...(content ? [{ role, content }] : [])]
    return [{ role, content }]
  })
}

function anthropicUpstream(route: Route): Upstream {
  const client = new Anthropic({ apiKey: route.apiKey, ...(route.baseUrl ? { baseURL: route.baseUrl } : {}) })
  const fallbacks = !route.baseUrl && SUPPORTS_FALLBACKS.test(route.model)
  return {
    async *stream({ system, messages, maxTokens, tools }, signal) {
      const stream = client.beta.messages.stream(
        {
          model: route.model,
          max_tokens: maxTokens,
          system,
          messages: anthropicMessages(messages),
          ...(tools?.length ? { tools: tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters as { type: 'object' } })) } : {}),
          ...(route.reasoning ? { output_config: { effort: route.reasoning as 'low' } } : {}),
          ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {})
        },
        { signal }
      )
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        }
      }
      const { usage, stop_reason: stopReason, content } = await stream.finalMessage()
      for (const block of content) if (block.type === 'tool_use') yield { type: 'tool', call: { id: block.id, name: block.name, arguments: JSON.stringify(block.input) } }
      yield { type: 'done', inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, stopReason }
    }
  }
}

interface OpenAiChunk {
  choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

/** For any provider that speaks the OpenAI chat format. */
function openAiUpstream(route: Route, fetchImpl: typeof fetch): Upstream {
  const base = (route.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  return {
    async *stream({ system, messages, maxTokens, tools }, signal) {
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${route.apiKey}` },
        body: JSON.stringify({
          model: route.model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens,
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...openAiMessages(messages)],
          ...(tools?.length ? { tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })) } : {}),
          ...(route.reasoning ? { reasoning_effort: route.reasoning } : {})
        })
      })
      if (!response.ok || !response.body) throw new Error(`Route ${route.id} returned ${response.status}`)

      let inputTokens = 0
      let outputTokens = 0
      let stopReason: string | null = null
      const calls = new Map<number, UpstreamToolCall>()
      let buffer = ''
      const decoder = new TextDecoder()
      for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, '')
          if (!line.startsWith('data:') || data === '[DONE]') continue
          const chunk = JSON.parse(data) as OpenAiChunk
          const choice = chunk.choices?.[0]
          if (choice?.delta?.content) yield { type: 'text', text: choice.delta.content }
          for (const part of choice?.delta?.tool_calls ?? []) {
            const index = part.index ?? calls.size
            const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
            call.id ||= part.id ?? ''
            call.name ||= part.function?.name ?? ''
            call.arguments += part.function?.arguments ?? ''
            calls.set(index, call)
          }
          if (choice?.finish_reason) stopReason = choice.finish_reason
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? 0
            outputTokens = chunk.usage.completion_tokens ?? 0
          }
        }
      }
      for (const [index, call] of calls) if (call.name) yield { type: 'tool', call: { ...call, id: call.id || `call_${index}` } }
      yield { type: 'done', inputTokens, outputTokens, stopReason }
    }
  }
}

export const createRouteUpstream = (route: Route, fetchImpl: typeof fetch = fetch): Upstream =>
  route.format === 'anthropic' ? anthropicUpstream(route) : openAiUpstream(route, fetchImpl)

/**
 * With one route, always uses it. With several, picks at random by weight, and moves to
 * the next if one fails before sending any text, so a rate-limited key doesn't fail the reply.
 */
export function createRouter(routes: Route[], make: (route: Route) => Upstream = createRouteUpstream, random?: () => number): Upstream {
  const upstreams = routes.map((route) => ({ weight: route.weight, upstream: make(route) }))
  return {
    async *stream(request, signal) {
      const order = upstreams.length > 1 ? shuffleByWeight(upstreams, random) : upstreams
      let failure: unknown
      for (const { upstream } of order) {
        let started = false
        try {
          for await (const event of upstream.stream(request, signal)) {
            started = true
            yield event
          }
          return
        } catch (error) {
          if (started || signal.aborted) throw error
          failure = error
        }
      }
      throw failure
    }
  }
}
