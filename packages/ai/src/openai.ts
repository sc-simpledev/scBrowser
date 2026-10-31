import { readServerEvents } from './sse'
import { AiError, errorForStatus, type ChatEvent, type ChatRequest, type Provider, type ProviderOptions } from './types'

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  error?: { message?: string }
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
    if (!response.ok) throw errorForStatus(response.status, config.name, config.hosted)
    return response
  }

  return {
    async listModels() {
      const response = await send('/models', {})
      const body = (await response.json()) as { data?: { id?: unknown }[] }
      return (body.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : []))
    },

    async *chat({ model, system, messages, maxTokens, signal }: ChatRequest): AsyncGenerator<ChatEvent> {
      const response = await send('/chat/completions', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages]
        })
      })
      if (!response.body) throw new AiError('server', `${config.name} sent an empty response.`)

      let stopReason: string | null = null
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
        if (choice?.finish_reason) stopReason = choice.finish_reason
        if (chunk.usage) {
          yield {
            type: 'usage',
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0
          }
        }
      }
      yield { type: 'stop', reason: stopReason }
    }
  }
}
