import { session, type WebContents } from 'electron'
import { Agent } from './agent'
import { AiError, type ChatMessage, createProvider, historyQueryPrompt, MAX_PAGE_CHARS, parseHistoryQuery, REPORT_TOOL, REPORT_TOOL_PROMPT, SYSTEM_PROMPT, trimPage, withContext, WORKSPACE_PROMPT, type FetchLike, type HistoryQuery, type PageContext, type Provider, type ToolUse } from '@scbrowser/ai'
import { memoryPrompt, effectiveUrl, MAX_MENTIONED_TABS, type AssistantEvent, type AssistantMessage, type AssistantRequest, type CoderStatus, type ModelRef } from '@scbrowser/shared'
import { extractContext, UnreadablePdfError } from './pageText'
import { webContext } from './webSearch'
import { Coder } from './coder'
import { reportCallText } from './reportCall'
import { CoderCheckpoints, CoderSnapshots } from './coderStorage'
import { join } from 'node:path'
import type { AiStore } from './store'

/**
 * Whether the hosted server takes real tool calls. Turn on in a release after the Worker with tool
 * support (server/src/app.ts) is deployed: the older one ignores `tools`, and the model would be
 * told to use tools it hasn't got.
 */
const HOSTED_NATIVE_TOOLS = false

const MAX_OUTPUT_TOKENS = 16_000
const TASK_OUTPUT_TOKENS = 4_000

/** AI traffic gets an in-memory session, so browsing cookies are never attached. */
export const AI_PARTITION = 'scb-ai'

const aiFetch: FetchLike = (input, init) => session.fromPartition(AI_PARTITION).fetch(input as string, init)

/** Failures where nothing got through at all, which is what a VPN can help with. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof AiError) return error.kind === 'network'
  return error instanceof Error && /net::ERR_|fetch failed|Failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(error.message)
}

export function errorDetails(error: unknown): { message: string; network?: true } {
  const network = isNetworkError(error)
  const message = error instanceof AiError ? error.message : network ? "Couldn't reach the AI service." : 'Something went wrong with that request.'
  return network ? { message, network: true } : { message }
}

export class AiService {
  private readonly running = new Map<string, AbortController>()
  /** Models that turned down a request carrying tools, which then go without for the session. */
  private readonly noReportTool = new Set<string>()
  private readonly agent = new Agent({
    chat: (messages, system, signal) => this.collect(this.chatRef(), system, messages, signal),
    isSiteOff: (url) => URL.canParse(url) && this.store.disabledHosts().includes(new URL(url).host)
  })

  constructor(
    private readonly store: AiStore,
    private readonly contentsFor: (tabId: number) => WebContents | undefined,
    private readonly tabIdOf: (contents: WebContents) => number | null = () => null,
    /** Where Terra Code keeps checkpoints, and whether it may. Absent for background work. */
    coderHome?: { dir: string; keep: () => boolean },
    private readonly memoryOn: () => boolean = () => false
  ) {
    const checkpoints = coderHome && new CoderCheckpoints(join(coderHome.dir, 'checkpoints'))
    const snapshots = coderHome && new CoderSnapshots(join(coderHome.dir, 'snapshots'))
    void checkpoints?.prune()
    void snapshots?.prune()
    this.coder = new Coder({
      chat: (messages, system, signal, onText) => this.collect(this.chatRef(), system, messages, signal, MAX_OUTPUT_TOKENS, onText),
      native: {
        available: () => {
          const chat = this.store.roles().chat
          const provider = chat && this.store.provider(chat.providerId)
          return !!provider && (!provider.hosted || HOSTED_NATIVE_TOOLS)
        },
        chat: async (messages, system, tools, signal, onText) => {
          const ref = this.chatRef()
          const stream = (await this.provider(ref.providerId)).chat({ model: ref.model, system, messages, maxTokens: MAX_OUTPUT_TOKENS, signal, tools })
          let text = ''
          const uses: ToolUse[] = []
          for await (const event of stream) {
            if (event.type === 'text') {
              text += event.text
              onText?.(text)
            } else if (event.type === 'tool') uses.push(event.use)
            else if (event.type === 'usage') this.store.addUsage(ref.providerId, ref.model, event.inputTokens, event.outputTokens)
          }
          return { text, uses }
        }
      },
      webSearch: async (query) => {
        const isSiteOff = (url: string) => URL.canParse(url) && this.store.disabledHosts().includes(new URL(url).host)
        const pages = await webContext(query, isSiteOff)
        if (pages.length === 0) return 'No results.'
        return pages.map((page, index) => `[${index + 1}] ${page.title}\n${page.url}\n${page.text.slice(0, 5000)}`).join('\n\n')
      },
      ...(checkpoints && snapshots ? { checkpoints, snapshots, keepOnDisk: coderHome.keep } : {})
    })
  }

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

  /** Agentic coding (beta), on the chat model. Long replies, as it writes whole files. */
  readonly coder: Coder

  coderStatus(folder: string): CoderStatus {
    const chat = this.store.roles().chat
    const provider = chat && this.store.provider(chat.providerId)
    const status = this.store.status()
    return { folder: folder || null, ready: status.ready, model: status.model, providerName: status.providerName, hosted: !!provider?.hosted, running: this.coder.running }
  }

  private async collect(ref: ModelRef, system: string, messages: ChatMessage[], signal?: AbortSignal, maxTokens = TASK_OUTPUT_TOKENS, onText?: (text: string) => void): Promise<string> {
    let text = ''
    const stream = (await this.provider(ref.providerId)).chat({ model: ref.model, system, messages, maxTokens, signal })
    for await (const event of stream) {
      if (event.type === 'text') {
        text += event.text
        onText?.(text)
      }
      if (event.type === 'usage') this.store.addUsage(ref.providerId, ref.model, event.inputTokens, event.outputTokens)
    }
    return text
  }

  /** A single request for a background job, on the quick model if one is set. */
  complete(system: string, user: string): Promise<string> {
    return this.collect(this.store.roles().fast ?? this.chatRef(), system, [{ role: 'user', content: user }])
  }

  /** Whether the chat model is scTerra AI, or null when none is chosen. */
  chatIsHosted(): boolean | null {
    const chat = this.store.roles().chat
    const provider = chat && this.store.provider(chat.providerId)
    return provider ? !!provider.hosted : null
  }

  /** A longer single request on the chat model, for briefs. */
  write(system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
    return this.collect(this.chatRef(), system, [{ role: 'user', content: user }], signal, maxTokens)
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
      else emit({ streamId, type: 'error', ...errorDetails(error) })
    } finally {
      this.running.delete(streamId)
    }
  }

  cancel(streamId: string): void {
    this.running.get(streamId)?.abort()
  }

  /** `files` is set by the main process, for sc://assistant only, never by what the page sends. */
  async send(streamId: string, request: AssistantRequest, emit: (event: AssistantEvent) => void, { files = false }: { files?: boolean } = {}): Promise<void> {
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
      const system = (files ? WORKSPACE_PROMPT : SYSTEM_PROMPT) + (this.memoryOn() ? memoryPrompt(this.store.memory()) : '')
      const messages = withContext(request.messages, pages, request.selection)
      const key = `${chat.providerId}\n${chat.model}`
      // The hosted server takes tools only once its Worker with tool support is deployed.
      const hosted = !!this.store.provider(chat.providerId)?.hosted
      for (;;) {
        const withTool = (!hosted || HOSTED_NATIVE_TOOLS) && !this.noReportTool.has(key)
        const call = reportCallText()
        let sent = false
        const text = (piece: string) => {
          if (!piece) return
          sent = true
          emit({ streamId, type: 'text', text: piece })
        }
        try {
          const stream = provider.chat({
            model: chat.model,
            system: withTool ? `${system}\n\n${REPORT_TOOL_PROMPT}` : system,
            messages,
            maxTokens: MAX_OUTPUT_TOKENS,
            signal: controller.signal,
            ...(withTool ? { tools: [REPORT_TOOL] } : {})
          })
          for await (const event of stream) {
            if (event.type === 'text') text(event.text)
            if (event.type === 'tool-delta' && event.name === REPORT_TOOL.name) text(call.delta(event.index, event.text))
            if (event.type === 'tool' && event.use.name === REPORT_TOOL.name) text(call.whole(event.use.input))
            if (event.type === 'usage') this.store.addUsage(chat.providerId, chat.model, event.inputTokens, event.outputTokens)
            if (event.type === 'stop') stopReason = event.reason
          }
          text(call.end())
          break
        } catch (error) {
          // A provider or model that doesn't take tools says so at once. The report is then written as text.
          if (withTool && !sent && !controller.signal.aborted && error instanceof AiError && error.kind === 'bad-request') {
            this.noReportTool.add(key)
            continue
          }
          throw error
        }
      }
      // Ending on the tool call is an ordinary ending here, as the report is the reply.
      emit({ streamId, type: 'done', stopReason: stopReason === 'tool_use' || stopReason === 'tool_calls' ? null : stopReason })
    } catch (error) {
      if (controller.signal.aborted) emit({ streamId, type: 'done', stopReason: 'cancelled' })
      else emit({ streamId, type: 'error', ...errorDetails(error) })
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
    const question = request.webSearch ? [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '' : ''
    const isSiteOff = (url: string) => URL.canParse(url) && this.store.disabledHosts().includes(new URL(url).host)
    const [read, web] = await Promise.all([
      Promise.all(allowed.map(async (contents) => ({ page: await extractContext(contents), tabId: this.tabIdOf(contents) }))),
      // A failed search shouldn't stop the question being answered from what else there is.
      question ? webContext(question, isSiteOff).catch(() => []) : Promise.resolve([])
    ])
    const found = [
      ...read.filter((entry): entry is { page: NonNullable<typeof entry.page>; tabId: number | null } => entry.page !== null),
      ...web.map((page) => ({ page: { ...page, source: 'page' as const }, tabId: null }))
    ]
    if (found.length === 0) return []

    const limit = Math.floor(MAX_PAGE_CHARS / found.length)
    // Numbered in the order sent, which is how the model is told to cite them.
    const trimmed = found.map(({ page }, index) => ({ ...page, ...trimPage(page.text, limit), id: index + 1 }))
    emit({
      streamId,
      type: 'context',
      title: trimmed.map((page) => page.title).join(', '),
      truncated: trimmed.some((page) => page.truncated),
      source: trimmed.length === 1 ? trimmed[0]!.source : 'page',
      sources: trimmed.map((page, index) => ({ n: page.id, tabId: found[index]!.tabId, title: page.title, url: page.url, kind: page.source }))
    })
    return trimmed
  }
}
