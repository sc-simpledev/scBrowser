export type ProviderProtocol = 'anthropic' | 'openai'

/** A configured AI provider. Secrets live separately and never leave the main process. */
export interface ProviderConfig {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  /** Models typed in by hand, for endpoints that can't list them. */
  models: string[]
  /** Set on Anthropic's own API, where its first-party-only request options are safe. */
  firstParty: boolean
  /** Our own service, which needs no key and has shared free limits. */
  hosted?: boolean
}

export interface ProviderPreset {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  needsKey: boolean
  firstParty?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, firstParty: true },
  { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { id: 'gemini', name: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { id: 'ollama', name: 'Ollama (local)', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', needsKey: false },
  { id: 'lmstudio', name: 'LM Studio (local)', protocol: 'openai', baseUrl: 'http://localhost:1234/v1', needsKey: false }
]

/** Address of the hosted AI service. Empty until it's deployed; SCDELTA_AI_URL overrides it. */
export const HOSTED_AI_URL = ''
export const HOSTED_PROVIDER_ID = 'scdelta'
export const HOSTED_MODEL = 'scdelta-chat'
export const HOSTED_NAME = 'scDelta AI'

/** A saved prompt, run from the assistant by typing `/`. */
export interface Skill {
  id: string
  name: string
  prompt: string
}

export const DEFAULT_SKILLS: Skill[] = [
  { id: 'simple', name: 'Explain simply', prompt: 'Explain this page in plain language, as if to someone new to the topic.' },
  { id: 'points', name: 'Key points', prompt: 'List the key points of this page as short bullets.' },
  { id: 'questions', name: 'What should I ask?', prompt: 'What are the most useful questions to ask about this page?' }
]

/** Which model does which job. */
export type ModelRole = 'chat' | 'fast'

export interface ModelRef {
  providerId: string
  model: string
}

export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
  /** Estimated spend in US dollars; null when any usage came from a model with no known price. */
  estimatedUsd: number | null
}

/** Published US dollar prices per million tokens, for Anthropic's own API. */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 }
}

/** Claude Haiku 5.5 charges more once a prompt passes this size. */
const HAIKU_LONG_PROMPT_TOKENS = 100_000
const HAIKU_LONG_PROMPT_PRICE = { input: 0.5, output: 2.5 }

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const base = MODEL_PRICES[model]
  if (!base) return null
  const price = model === 'claude-haiku-5-5' && inputTokens > HAIKU_LONG_PROMPT_TOKENS ? HAIKU_LONG_PROMPT_PRICE : base
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

/** What the settings page sees; holds no secrets. */
export interface AiState {
  providers: (ProviderConfig & { hasKey: boolean })[]
  roles: Partial<Record<ModelRole, ModelRef>>
  usage: Record<string, ProviderUsage>
  disabledHosts: string[]
  /** False when the OS has no keyring, so keys are only obfuscated on disk. */
  keysProtected: boolean
  /** Whether this build has a hosted service to offer. */
  hostedAvailable: boolean
  skills: Skill[]
}

export interface AiStatus {
  ready: boolean
  model: string | null
  providerName: string | null
  /** Sites whose pages are never sent to AI. */
  disabledHosts: string[]
  hostedAvailable: boolean
  skills: Skill[]
}

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantRequest {
  messages: AssistantMessage[]
  tabId: number | null
  /** Send the tab's readable text with this message. */
  includePage: boolean
  /** Other tabs @-mentioned in this message. */
  extraTabIds: number[]
  /** Text the person highlighted, quoted with their message. */
  selection: string | null
}

export const MAX_MENTIONED_TABS = 5

/** Where the text sent with a message came from. */
export type ContextSource = 'page' | 'transcript' | 'pdf'

export type AssistantEvent =
  | { streamId: string; type: 'context'; title: string; truncated: boolean; source: ContextSource }
  | { streamId: string; type: 'text'; text: string }
  | { streamId: string; type: 'done'; stopReason: string | null }
  | { streamId: string; type: 'error'; message: string }

export interface SavedTurn extends AssistantMessage {
  pageTitle?: string
  source?: ContextSource
  truncated?: boolean
}

export interface ChatSummary {
  id: string
  title: string
  updatedAt: number
}

export interface SavedChat extends ChatSummary {
  turns: SavedTurn[]
}

/** Hands a prompt to the assistant panel, e.g. from a menu or the omnibox. */
export interface AssistantPrompt {
  text: string
  selection: string | null
  includePage: boolean
}

export const SUMMARISE_PROMPT = 'Summarise this page.'

export const isHttpUrl = (url: string) => /^https?:\/\//i.test(url)

/** A key sent over plain HTTP is readable on the network unless it stays on this machine. */
export function isInsecureEndpoint(baseUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(baseUrl)
    return protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  } catch {
    return false
  }
}
