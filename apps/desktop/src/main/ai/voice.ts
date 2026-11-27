import type { ProviderConfig } from '@scbrowser/shared'
import type { AiStore } from './store'

/**
 * Speech to text for the assistant's microphone button, through a provider the person already set
 * up: never a service they haven't picked. OpenAI, Groq and local Whisper servers (whisper.cpp,
 * faster-whisper, LocalAI, speaches) take audio at /audio/transcriptions; Gemini's OpenAI-style
 * endpoint takes it as audio in a chat message. Anthropic's API and scTerra's hosted model take no
 * audio, so they're skipped.
 */

export const MAX_VOICE_BYTES = 12 * 1024 * 1024

export interface VoiceRoute {
  provider: ProviderConfig
  kind: 'transcriptions' | 'chat-audio'
  model: string
  /** Who hears the recording, for the button's tooltip. */
  label: string
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname : '')
const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)

/** How a provider could transcribe, or null if it can't take audio. */
export function voiceRouteFor(provider: ProviderConfig, chatModel: string | null): VoiceRoute | null {
  if (provider.hosted || provider.protocol !== 'openai') return null
  const host = hostOf(provider.baseUrl)
  if (host === 'api.openai.com') return { provider, kind: 'transcriptions', model: 'gpt-4o-mini-transcribe', label: `${provider.name} (OpenAI)` }
  if (host === 'api.groq.com') return { provider, kind: 'transcriptions', model: 'whisper-large-v3-turbo', label: `${provider.name} (Groq)` }
  if (host === 'generativelanguage.googleapis.com') return { provider, kind: 'chat-audio', model: chatModel && /gemini/i.test(chatModel) ? chatModel : 'gemini-2.5-flash', label: `${provider.name} (Gemini)` }
  // A Whisper server on this computer or network, or a model list that names one.
  if (isLocal(host) || provider.models.some((model) => /whisper|transcribe/i.test(model))) {
    const named = provider.models.find((model) => /whisper|transcribe/i.test(model))
    return { provider, kind: 'transcriptions', model: named ?? 'whisper-1', label: `${provider.name} (${isLocal(host) ? 'on your network' : host})` }
  }
  return null
}

/** The chat model's provider when it can, otherwise another set-up provider that can. */
export function voiceRoute(store: Pick<AiStore, 'providers' | 'roles'>): VoiceRoute | null {
  const chat = store.roles().chat ?? null
  const providers = store.providers()
  const first = chat ? providers.find((provider) => provider.id === chat.providerId) : undefined
  const ordered = [...(first ? [first] : []), ...providers.filter((provider) => provider !== first)]
  for (const provider of ordered) {
    const route = voiceRouteFor(provider, provider === first ? chat!.model : null)
    if (route) return route
  }
  return null
}

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/** Turns a WAV recording (base64) into text with the route's provider. */
export async function transcribe(route: VoiceRoute, wavBase64: string, secret: { apiKey: string; headers: Record<string, string> }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const audio = Buffer.from(wavBase64, 'base64')
  if (audio.length < 1000) return ''
  if (audio.length > MAX_VOICE_BYTES) throw new Error('That recording is too long. Keep it under about three minutes.')
  const headers: Record<string, string> = { ...secret.headers, ...(secret.apiKey ? { Authorization: `Bearer ${secret.apiKey}` } : {}) }
  const base = trimSlash(route.provider.baseUrl)
  let response: Response
  if (route.kind === 'transcriptions') {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav')
    form.append('model', route.model)
    form.append('response_format', 'json')
    response = await fetchImpl(`${base}/audio/transcriptions`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(90_000) })
  } else {
    response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: route.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this recording word for word, in the language spoken. Reply with the words only: no quotes, notes or timestamps. If nothing is said, reply with nothing.' },
              { type: 'input_audio', input_audio: { data: wavBase64, format: 'wav' } }
            ]
          }
        ]
      })
    })
  }
  const body = await response.text()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(`${route.provider.name} didn’t accept the key for speech.`)
    if (response.status === 404) throw new Error(`${route.provider.name} has no speech to text at that address.`)
    throw new Error(`${route.provider.name} couldn’t turn that into text (${response.status}).`)
  }
  try {
    const data = JSON.parse(body) as { text?: unknown; choices?: { message?: { content?: unknown } }[] }
    const text = typeof data.text === 'string' ? data.text : typeof data.choices?.[0]?.message?.content === 'string' ? data.choices[0]!.message!.content : ''
    return (text as string).trim()
  } catch {
    return body.trim().slice(0, 10_000)
  }
}
