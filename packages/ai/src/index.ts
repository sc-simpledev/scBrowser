import { createAnthropicProvider } from './anthropic'
import { createOpenAiProvider } from './openai'
import type { Provider, ProviderOptions } from './types'

export * from './context'
export * from './tasks'
export * from './types'

export function createProvider(options: ProviderOptions): Provider {
  return options.config.protocol === 'anthropic' ? createAnthropicProvider(options) : createOpenAiProvider(options)
}
