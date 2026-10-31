import Anthropic from '@anthropic-ai/sdk'
import { shuffleByWeight, type Route } from './routes.ts'

export interface UpstreamMessage {
  role: 'user' | 'assistant'
  content: string
}

export type UpstreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; inputTokens: number; outputTokens: number; stopReason: string | null }

export interface UpstreamRequest {
  system: string
  messages: UpstreamMessage[]
  maxTokens: number
}

export interface Upstream {
  stream(request: UpstreamRequest, signal: AbortSignal): AsyncIterable<UpstreamEvent>
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const SUPPORTS_FALLBACKS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/

function anthropicUpstream(route: Route): Upstream {
  const client = new Anthropic({ apiKey: route.apiKey, ...(route.baseUrl ? { baseURL: route.baseUrl } : {}) })
  const fallbacks = !route.baseUrl && SUPPORTS_FALLBACKS.test(route.model)
  return {
    async *stream({ system, messages, maxTokens }, signal) {
      const stream = client.beta.messages.stream(
        {
          model: route.model,
          max_tokens: maxTokens,
          system,
          messages,
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
      const { usage, stop_reason: stopReason } = await stream.finalMessage()
      yield { type: 'done', inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, stopReason }
    }
  }
}

interface OpenAiChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

/** For any provider that speaks the OpenAI chat format. */
function openAiUpstream(route: Route, fetchImpl: typeof fetch): Upstream {
  const base = (route.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  return {
    async *stream({ system, messages, maxTokens }, signal) {
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${route.apiKey}` },
        body: JSON.stringify({
          model: route.model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens,
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
          ...(route.reasoning ? { reasoning_effort: route.reasoning } : {})
        })
      })
      if (!response.ok || !response.body) throw new Error(`Route ${route.id} returned ${response.status}`)

      let inputTokens = 0
      let outputTokens = 0
      let stopReason: string | null = null
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
          if (choice?.finish_reason) stopReason = choice.finish_reason
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? 0
            outputTokens = chunk.usage.completion_tokens ?? 0
          }
        }
      }
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
