import { session, type WebContents } from 'electron'
import { Agent } from './agent'
import { AiError, createProvider, historyQueryPrompt, MAX_PAGE_CHARS, parseHistoryQuery, SYSTEM_PROMPT, trimPage, withContext, type FetchLike, type HistoryQuery, type PageContext, type Provider } from '@scbrowser/ai'
import { effectiveUrl, MAX_MENTIONED_TABS, type AssistantEvent, type AssistantMessage, type AssistantRequest, type ModelRef } from '@scbrowser/shared'
import { extractContext, UnreadablePdfError } from './pageText'
import type { AiStore } from './store'

const MAX_OUTPUT_TOKENS = 16_000
const TASK_OUTPUT_TOKENS = 4_000

/** AI traffic gets an in-memory session, so browsing cookies are never attached. */
export const AI_PARTITION = 'scb-ai'

const aiFetch: FetchLike = (input, init) => session.fromPartition(AI_PARTITION).fetch(input as string, init)

export class AiService {
  private readonly running = new Map<string, AbortController>()
  private readonly agent = new Agent({
    chat: (messages, system, signal) => this.collect(this.chatRef(), system, messages, signal),
    isSiteOff: (url) => URL.canParse(url) && this.store.disabledHosts().includes(new URL(url).host)
  })

  constructor(
    private readonly store: AiStore,
    private readonly contentsFor: (tabId: number) => WebContents | undefined
  ) {}

  private async provider(id: string): Promise<Provider> {
    const config = this.store.provider(id)
    if (!config) throw new AiError('not-found', 'That provider no longer exists.')
    return createProvider({ config, secret: await this.store.secret(id), fetch: aiFetch })
  }

  async models(id: string): Promise<{ models: string[]; error: string | null }> {
    const manual = this.store.provider(id)?.models ?? []
    try {
      const listed = await (await this.provider(id)).listModels()
      return { models: [...new Set([...manual, ...listed])], error: null }
    } catch (error) {
      return { models: manual, error: error instanceof AiError ? error.message : "Couldn't list models." }
    }
  }

  /** A question from the address bar, waiting for the assistant page to load. */
  private pendingPrompt: string | null = null

  setPendingPrompt(text: string): void {
    this.pendingPrompt = text
  }

  takePendingPrompt(): string | null {
    const text = this.pendingPrompt
    this.pendingPrompt = null
    return text
  }

  private chatRef(): ModelRef {
    const chat = this.store.roles().chat
    if (!chat) throw new AiError('not-found', 'Choose a model in AI settings first.')
    return chat
  }

  private async collect(ref: ModelRef, system: string, messages: AssistantMessage[], signal?: AbortSignal): Promise<string> {
    let text = ''
    const stream = (await this.provider(ref.providerId)).chat({ model: ref.model, system, messages, maxTokens: TASK_OUTPUT_TOKENS, signal })
    for await (const event of stream) {
      if (event.type === 'text') text += event.text
      if (event.type === 'usage') this.store.addUsage(ref.providerId, ref.model, event.inputTokens, event.outputTokens)
    }
    return text
  }

  /** A single request for a background job, on the quick model if one is set. */
  complete(system: string, user: string): Promise<string> {
    return this.collect(this.store.roles().fast ?? this.chatRef(), system, [{ role: 'user', content: user }])
  }

  /** Only the search itself goes to the AI, never the person's history. */
  async parseHistorySearch(query: string): Promise<HistoryQuery | null> {
    return parseHistoryQuery(await this.complete(historyQueryPrompt(new Date().toISOString().slice(0, 10)), query))
  }

  answerApproval(approvalId: string, allow: boolean): void {
    this.agent.answer(approvalId, allow)
  }

  async runAgent(streamId: string, goal: string, tabId: number, emit: (event: AssistantEvent) => void): Promise<void> {
    const controller = new AbortController()
    this.running.set(streamId, controller)
    try {
      const contents = this.contentsFor(tabId)
      if (!contents) throw new AiError('not-found', 'That tab has closed.')
      await this.agent.run(streamId, goal, contents, emit, controller.signal)
      emit({ streamId, type: 'done', stopReason: controller.signal.aborted ? 'cancelled' : null })
    } catch (error) {
      if (controller.signal.aborted) emit({ streamId, type: 'done', stopReason: 'cancelled' })
      else emit({ streamId, type: 'error', message: error instanceof AiError ? error.message : 'Something went wrong with that request.' })
    } finally {
      this.running.delete(streamId)
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
      const provider = await this.provider(chat.providerId)
      const pages = await this.readPages(request, streamId, emit).catch((error: unknown) => {
        if (error instanceof UnreadablePdfError) throw new AiError('bad-request', error.message)
        throw error
      })
      if (controller.signal.aborted) return

      let stopReason: string | null = null
      const stream = provider.chat({
        model: chat.model,
        system: SYSTEM_PROMPT,
        messages: withContext(request.messages, pages, request.selection),
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

  private async readPages(request: AssistantRequest, streamId: string, emit: (event: AssistantEvent) => void): Promise<PageContext[]> {
    const ids = [...new Set([...(request.includePage && request.tabId !== null ? [request.tabId] : []), ...request.extraTabIds])]
    const allowed = ids.slice(0, MAX_MENTIONED_TABS + 1).flatMap((id) => {
      const contents = this.contentsFor(id)
      if (!contents || !URL.canParse(contents.getURL())) return []
      return this.store.disabledHosts().includes(new URL(effectiveUrl(contents.getURL())).host) ? [] : [contents]
    })
    const found = (await Promise.all(allowed.map(extractContext))).filter((page) => page !== null)
    if (found.length === 0) return []

    const limit = Math.floor(MAX_PAGE_CHARS / found.length)
    const trimmed = found.map((page) => ({ ...page, ...trimPage(page.text, limit) }))
    emit({
      streamId,
      type: 'context',
      title: trimmed.map((page) => page.title).join(', '),
      truncated: trimmed.some((page) => page.truncated),
      source: trimmed.length === 1 ? trimmed[0]!.source : 'page'
    })
    return trimmed
  }
}
