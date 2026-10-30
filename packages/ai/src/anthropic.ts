import Anthropic from '@anthropic-ai/sdk'
import { AiError, errorForStatus, type ChatEvent, type ChatRequest, type Provider, type ProviderOptions } from './types'

/** Current models, which accept `output_config.effort` and refusal fallbacks. */
const SUPPORTS_FALLBACKS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/
const SUPPORTS_EFFORT = /^claude-(opus-5|sonnet-5|haiku-5-5|fable-5)/
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

function toAiError(error: unknown, name: string): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('network', `Couldn't reach ${name}. Check the address and your connection.`)
  }
  if (error instanceof Anthropic.APIError && error.status !== undefined) return errorForStatus(error.status, name)
  return error
}

export function createAnthropicProvider({ config, secret, fetch }: ProviderOptions): Provider {
  const client = new Anthropic({
    apiKey: secret.apiKey,
    baseURL: config.baseUrl,
    defaultHeaders: secret.headers,
    fetch,
    maxRetries: 1
  })

  return {
    async listModels() {
      try {
        const models: string[] = []
        for await (const model of client.models.list()) models.push(model.id)
        return models
      } catch (error) {
        throw toAiError(error, config.name)
      }
    },

    async *chat({ model, system, messages, maxTokens, signal }: ChatRequest): AsyncGenerator<ChatEvent> {
      // Gateways that imitate this API won't know Anthropic-only options, so they're limited to the real one.
      const fallbacks = config.firstParty && SUPPORTS_FALLBACKS.test(model)
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(SUPPORTS_EFFORT.test(model) ? { output_config: { effort: 'low' as const } } : {}),
          ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {})
        },
        { signal }
      )
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          }
        }
        const message = await stream.finalMessage()
        yield { type: 'usage', inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
        yield { type: 'stop', reason: message.stop_reason }
      } catch (error) {
        throw toAiError(error, config.name)
      }
    }
  }
}
