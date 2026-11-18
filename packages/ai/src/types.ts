import type { AssistantMessage, ProviderConfig } from '@scbrowser/shared'

export type FetchLike = typeof fetch

/** A tool offered to the model through the provider's own tool calling. `parameters` is JSON Schema. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolUse {
  id: string
  name: string
  /** What the model sent. Null when its arguments couldn't be read, such as a reply cut off by its length limit. */
  input: unknown
}

export interface ToolOutput {
  id: string
  tool: string
  output: string
  /** Pictures the tool returned, such as a screenshot, as data addresses. */
  images?: string[]
}

/** A conversation turn, which may carry pictures (data addresses) and the provider-native tool calls and their results. */
export type ChatMessage = AssistantMessage & { images?: string[]; toolUses?: ToolUse[]; toolResults?: ToolOutput[] }

/** How hard a model that can think should think. Only sent where the model takes it. */
export type ChatEffort = 'low' | 'medium' | 'high'

/** A data address split into what the APIs want, or null if it isn't a base64 picture. */
export function imageParts(url: string): { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  return match ? { mediaType: match[1] as 'image/png', data: match[2]! } : null
}

export interface ChatRequest {
  model: string
  system: string
  messages: ChatMessage[]
  maxTokens: number
  signal?: AbortSignal
  tools?: ToolSpec[]
  effort?: ChatEffort
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; use: ToolUse }
  /** A piece of a tool call's arguments as they arrive, for calls worth showing while they're written. */
  | { type: 'tool-delta'; index: number; name: string; text: string }
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
