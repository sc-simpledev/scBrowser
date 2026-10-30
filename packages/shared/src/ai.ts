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

/** Which model does which job. */
export type ModelRole = 'chat' | 'fast'

export interface ModelRef {
  providerId: string
  model: string
}

export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
}

/** What the settings page sees; holds no secrets. */
export interface AiState {
  providers: (ProviderConfig & { hasKey: boolean })[]
  roles: Partial<Record<ModelRole, ModelRef>>
  usage: Record<string, ProviderUsage>
  disabledHosts: string[]
  /** False when the OS has no keyring, so keys are only obfuscated on disk. */
  keysProtected: boolean
}

export interface AiStatus {
  ready: boolean
  model: string | null
  providerName: string | null
  /** Sites whose pages are never sent to AI. */
  disabledHosts: string[]
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
  /** Text the person highlighted, quoted with their message. */
  selection: string | null
}

export type AssistantEvent =
  | { streamId: string; type: 'context'; title: string; truncated: boolean }
  | { streamId: string; type: 'text'; text: string }
  | { streamId: string; type: 'done'; stopReason: string | null }
  | { streamId: string; type: 'error'; message: string }

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
