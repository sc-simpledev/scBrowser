import { readServerEvents } from './sse'
import { AiError, errorForStatus, type ChatEvent, type ChatMessage, type ChatRequest, type Provider, type ProviderOptions } from './types'

interface ChatChunk {
  choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  error?: { message?: string }
}

/** Tool results are messages of their own in this format, one per call. */
export function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.flatMap(({ role, content, toolUses, toolResults }): unknown[] => {
    if (toolUses?.length) {
      return [{ role, content: content || null, tool_calls: toolUses.map(({ id, name, input }) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input ?? {}) } })) }]
    }
    if (toolResults?.length) return [...toolResults.map(({ id, output }) => ({ role: 'tool', tool_call_id: id, content: output })), ...(content ? [{ role, content }] : [])]
    return [{ role, content }]
  })
}

function parsedArguments(text: string): unknown {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return null
  }
}

/** Speaks the OpenAI chat format, which OpenRouter, Gemini, Ollama and most gateways also accept. */
export function createOpenAiProvider({ config, secret, fetch }: ProviderOptions): Provider {
  const base = config.baseUrl.replace(/\/+$/, '')
  const headers = {
    ...(secret.apiKey ? { authorization: `Bearer ${secret.apiKey}` } : {}),
    ...secret.headers
  }

  const send = async (path: string, init: RequestInit) => {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } })
    } catch (error) {
      if (init.signal?.aborted) throw error
      throw new AiError('network', `Couldn't reach ${config.name}. Check the address and your connection.`)
    }
    // The hosted server never answers with a web page or refuses outright, so either means a network
    // filter (a school, workplace or country blocking Cloudflare Workers) got there first.
    const page = (response.headers.get('content-type') ?? '').includes('text/html')
    if (config.hosted && (page || response.status === 403 || response.status === 451)) {
      throw new AiError('network', `Your network seems to be blocking ${config.name}.`)
    }
    if (!response.ok) throw errorForStatus(response.status, config.name, config.hosted)
    return response
  }

  return {
    async listModels() {
      const response = await send('/models', {})
      const body = (await response.json()) as { data?: { id?: unknown }[] }
      return (body.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : []))
    },

    async *chat({ model, system, messages, maxTokens, signal, tools }: ChatRequest): AsyncGenerator<ChatEvent> {
      const response = await send('/chat/completions', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...toOpenAiMessages(messages)],
          ...(tools?.length ? { tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })) } : {})
        })
      })
      if (!response.body) throw new AiError('server', `${config.name} sent an empty response.`)

      let stopReason: string | null = null
      const calls = new Map<number, { id: string; name: string; args: string }>()
      for await (const event of readServerEvents(response.body)) {
        if (event === '[DONE]') break
        let chunk: ChatChunk
        try {
          chunk = JSON.parse(event) as ChatChunk
        } catch {
          continue
        }
        if (chunk.error) throw new AiError('server', `${config.name} stopped with an error.`)
        const choice = chunk.choices?.[0]
        if (choice?.delta?.content) yield { type: 'text', text: choice.delta.content }
        for (const part of choice?.delta?.tool_calls ?? []) {
          const index = part.index ?? calls.size
          const call = calls.get(index) ?? { id: '', name: '', args: '' }
          call.id ||= part.id ?? ''
          call.name ||= part.function?.name ?? ''
          call.args += part.function?.arguments ?? ''
          calls.set(index, call)
          if (call.name && part.function?.arguments) yield { type: 'tool-delta', index, name: call.name, text: part.function.arguments }
        }
        if (choice?.finish_reason) stopReason = choice.finish_reason
        if (chunk.usage) {
          yield {
            type: 'usage',
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0
          }
        }
      }
      // Some gateways leave the id out, and a result has to name the call it answers.
      for (const [index, call] of [...calls].sort(([a], [b]) => a - b)) if (call.name) yield { type: 'tool', use: { id: call.id || `call_${index}`, name: call.name, input: parsedArguments(call.args) } }
      yield { type: 'stop', reason: stopReason }
    }
  }
}
