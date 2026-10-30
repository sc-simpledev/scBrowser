import { session, type WebContents } from 'electron'
import { AiError, createProvider, SYSTEM_PROMPT, trimPage, withContext, type FetchLike, type Provider } from '@scbrowser/ai'
import type { AssistantEvent, AssistantRequest } from '@scbrowser/shared'
import { extractContext, UnreadablePdfError } from './pageText'
import type { AiStore } from './store'

const MAX_OUTPUT_TOKENS = 16_000

/** AI traffic gets an in-memory session, so browsing cookies are never attached. */
const aiFetch: FetchLike = (input, init) => session.fromPartition('scb-ai').fetch(input as string, init)

export class AiService {
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly store: AiStore,
    private readonly contentsFor: (tabId: number) => WebContents | undefined
  ) {}

  private provider(id: string): Provider {
    const config = this.store.provider(id)
    if (!config) throw new AiError('not-found', 'That provider no longer exists.')
    return createProvider({ config, secret: this.store.secret(id), fetch: aiFetch })
  }

  async models(id: string): Promise<{ models: string[]; error: string | null }> {
    const manual = this.store.provider(id)?.models ?? []
    try {
      const listed = await this.provider(id).listModels()
      return { models: [...new Set([...manual, ...listed])], error: null }
    } catch (error) {
      return { models: manual, error: error instanceof AiError ? error.message : "Couldn't list models." }
    }
  }

  cancel(streamId: string): void {
    this.running.get(streamId)?.abort()
  }

  async send(streamId: string, request: AssistantRequest, emit: (event: AssistantEvent) => void): Promise<void> {
    const controller = new AbortController()
    this.running.set(streamId, controller)
    try {
      const chat = this.store.roles().chat
      if (!chat) throw new AiError('not-found', 'Choose a model in AI settings first.')
      const provider = this.provider(chat.providerId)
      const page = await this.readPage(request, streamId, emit).catch((error: unknown) => {
        if (error instanceof UnreadablePdfError) throw new AiError('bad-request', error.message)
        throw error
      })
      if (controller.signal.aborted) return

      let stopReason: string | null = null
      const stream = provider.chat({
        model: chat.model,
        system: SYSTEM_PROMPT,
        messages: withContext(request.messages, page, request.selection),
        maxTokens: MAX_OUTPUT_TOKENS,
        signal: controller.signal
      })
      for await (const event of stream) {
        if (event.type === 'text') emit({ streamId, type: 'text', text: event.text })
        if (event.type === 'usage') this.store.addUsage(chat.providerId, chat.model, event.inputTokens, event.outputTokens)
        if (event.type === 'stop') stopReason = event.reason
      }
      emit({ streamId, type: 'done', stopReason })
    } catch (error) {
      if (controller.signal.aborted) emit({ streamId, type: 'done', stopReason: 'cancelled' })
      else emit({ streamId, type: 'error', message: error instanceof AiError ? error.message : 'Something went wrong with that request.' })
    } finally {
      this.running.delete(streamId)
    }
  }

  private async readPage(request: AssistantRequest, streamId: string, emit: (event: AssistantEvent) => void) {
    if (!request.includePage || request.tabId === null) return null
    const contents = this.contentsFor(request.tabId)
    if (!contents) return null
    const url = URL.canParse(contents.getURL()) ? new URL(contents.getURL()) : null
    if (url && this.store.disabledHosts().includes(url.host)) return null
    const page = await extractContext(contents)
    if (!page) return null
    const { text, truncated } = trimPage(page.text)
    emit({ streamId, type: 'context', title: page.title, truncated, source: page.source })
    return { ...page, text }
  }
}
