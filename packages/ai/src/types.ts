import type { AssistantMessage, ProviderConfig } from '@scbrowser/shared'

export type FetchLike = typeof fetch

export interface ChatRequest {
  model: string
  system: string
  messages: AssistantMessage[]
  maxTokens: number
  signal?: AbortSignal
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'stop'; reason: string | null }

export interface Provider {
  listModels(): Promise<string[]>
  chat(request: ChatRequest): AsyncIterable<ChatEvent>
}

export interface ProviderSecret {
  apiKey: string
  /** Extra request headers for proxies and gateways. */
  headers: Record<string, string>
}

export interface ProviderOptions {
  config: ProviderConfig
  secret: ProviderSecret
  fetch: FetchLike
}

export type AiErrorKind = 'auth' | 'rate-limit' | 'not-found' | 'bad-request' | 'server' | 'network'

/** A failure worded for people; provider responses are never shown verbatim as UI. */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export function errorForStatus(status: number, name: string, hosted = false): AiError {
  if (hosted && status === 429) return new AiError('rate-limit', `You've reached the free ${name} limit for now. Add your own API key in AI settings to keep going.`)
  if (hosted && status === 503) return new AiError('server', `${name} has reached its limit for today. Add your own API key in AI settings to keep going.`)
  if (status === 401 || status === 403) return new AiError('auth', `${name} rejected the API key. Check it in AI settings.`)
  if (status === 404) return new AiError('not-found', `${name} couldn't find that model or address. Check AI settings.`)
  if (status === 429) return new AiError('rate-limit', `${name} is rate limiting requests, or the account is out of credit.`)
  if (status >= 500) return new AiError('server', `${name} had a problem. Try again in a moment.`)
  return new AiError('bad-request', `${name} rejected the request (error ${status}).`)
}
