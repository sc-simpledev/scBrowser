import { session, type WebContents } from 'electron'
import { Agent } from './agent'
import { AiError, ASK_TOOL, ASK_TOOL_PROMPT, type ChatEffort, type ChatMessage, createProvider, type ToolOutput, historyQueryPrompt, MAX_PAGE_CHARS, parseHistoryQuery, REPORT_TOOL, REPORT_TOOL_PROMPT, SYSTEM_PROMPT, trimPage, withContext, WORKSPACE_PROMPT, type FetchLike, type HistoryQuery, type PageContext, type Provider, type ToolUse } from '@scbrowser/ai'
import { localDay, memoryPrompt, replyStylePrompt, effectiveUrl, QUESTION_FENCE, QUESTION_INSTRUCTIONS, MAX_MENTIONED_TABS, type AssistantEvent, type AssistantMessage, type AssistantRequest, type CoderCloudModel, type CoderModelChoice, type CoderStatus, type ModelRef, type ReplyStyle } from '@scbrowser/shared'
import { extractContext, UnreadablePdfError } from './pageText'
import { readResult, webContext } from './webSearch'
import { Coder, git, type CoderBrowserHost, type CoderGithubHost, type CoderMcpHost } from './coder'
import { parsePdf } from './pdfText'
import { devContainerAvailable, sandboxAvailable, type SandboxMode } from './coderTools'
import type { CoderTrust } from './coderTrust'
import { reportCallText } from './reportCall'
import { CHAT_TOOLS_PROMPT, ChatTools, MAX_CHAT_TOOL_ROUNDS } from './chatTools'
import { CoderLsp } from './coderLsp'
import { CoderCheckpoints, CoderSnapshots } from './coderStorage'
import { join } from 'node:path'
import { homedir } from 'node:os'
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
    coderHome?: CoderHome,
    private readonly memoryOn: () => boolean = () => false,
    /** How replies in Chat are written: see `REPLY_STYLES`. */
    private readonly replyStyle: () => ReplyStyle = () => 'normal'
  ) {
    const checkpoints = coderHome && new CoderCheckpoints(join(coderHome.dir, 'checkpoints'))
    const snapshots = coderHome && new CoderSnapshots(join(coderHome.dir, 'snapshots'))
    void checkpoints?.prune()
    void snapshots?.prune()
    const searchWeb = async (query: string) => {
      const pages = await webContext(query, (url) => this.siteOff(url))
      if (pages.length === 0) return 'No results.'
      return pages.map((page, index) => `[${index + 1}] ${page.title}\n${page.url}\n${page.text.slice(0, 5000)}`).join('\n\n')
    }
    const readUrl = async (url: string) => {
      if (this.siteOff(url)) return 'AI is turned off for that site, so it was not read.'
      const page = await readResult({ url, title: url })
      return page ? `${page.title}\n${page.url}\n\n${page.text}` : "That page couldn't be read as text."
    }
    this.chatTools = coderHome ? new ChatTools({ mcp: coderHome.mcp, folder: () => coderHome.folder?.() || homedir(), webSearch: searchWeb, readUrl, screenshot: (tabId) => this.screenshot(tabId) }) : null
    this.coder = new Coder({
      chat: (messages, system, signal, options) => this.collect(this.coderRef(options?.model), system, messages, signal, MAX_OUTPUT_TOKENS, options?.onText, undefined, options),
      native: {
        available: (model) => {
          const chat = model ?? this.store.roles().chat
          const provider = chat && this.store.provider(chat.providerId)
          return !!provider && (!provider.hosted || HOSTED_NATIVE_TOOLS)
        },
        chat: async (messages, system, tools, signal, options) => {
          const ref = this.coderRef(options?.model)
          const stream = (await this.provider(ref.providerId)).chat({ model: ref.model, system, messages, maxTokens: MAX_OUTPUT_TOKENS, signal, tools, ...(options?.effort ? { effort: options.effort } : {}), ...(options?.reasoning ? { reasoning: true } : {}) })
          let text = ''
          let thought = ''
          let blocks: unknown[] | undefined
          const uses: ToolUse[] = []
          for await (const event of stream) {
            if (event.type === 'text') {
              text += event.text
              options?.onText?.(text)
            } else if (event.type === 'reasoning') {
              thought += event.text
              options?.onReasoning?.(thought)
            } else if (event.type === 'blocks') blocks = event.blocks
            else if (event.type === 'tool') uses.push(event.use)
            else if (event.type === 'usage') {
              this.store.addUsage(ref.providerId, ref.model, event.inputTokens, event.outputTokens)
              options?.onUsage?.(event.inputTokens, event.outputTokens)
            }
          }
          return { text, uses, ...(blocks ? { blocks } : {}) }
        }
      },
      webFetch: async (url) => {
        if (URL.canParse(url) && this.store.disabledHosts().includes(new URL(url).host)) return 'AI is turned off for that site, so it was not read.'
        const page = await readResult({ url, title: url })
        return page ? `${page.title}\n${page.url}\n\n${page.text}` : "That page couldn't be read as text."
      },
      readPdf: async (bytes) => (await parsePdf(bytes))?.text ?? null,
      ...(coderHome ? { trust: coderHome.trust, home: coderHome.dir, sandbox: coderHome.sandbox, autoCompact: coderHome.autoCompact, autoCheck: coderHome.autoCheck, autoFormat: coderHome.autoFormat, mcp: coderHome.mcp, browser: coderHome.browser, showReasoning: coderHome.showReasoning, budget: coderHome.budget, lsp: new CoderLsp(), ...(coderHome.github ? { github: coderHome.github } : {}) } : {}),
      agentModel: () => (coderHome?.agentModel?.() === 'quick' ? (this.store.roles().fast ?? null) : null),
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

  /** A task from the command line (`scterra code …`), waiting for Terra Code to open. */
  private pendingCode: string | null = null

  setPendingCode(task: string): void {
    this.pendingCode = task
  }

  takePendingCode(): { task: string } | null {
    const task = this.pendingCode
    this.pendingCode = null
    return task === null ? null : { task }
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

  /** The session's own model if it still exists, else the assistant's. */
  private coderRef(model?: ModelRef | null): ModelRef {
    if (model && this.store.provider(model.providerId)) return model
    return this.chatRef()
  }

  /** Models Terra Code can be switched to: each provider's known models, listed once. */
  async coderModels(): Promise<CoderModelChoice[]> {
    const roles = Object.values(this.store.roles()).filter((ref): ref is ModelRef => !!ref)
    const choices: CoderModelChoice[] = []
    for (const provider of this.store.providers()) {
      const listed = await Promise.race([this.models(provider.id).then((found) => found.models), new Promise<string[]>((done) => setTimeout(() => done([]), 4000))])
      const names = [...new Set([...roles.filter((ref) => ref.providerId === provider.id).map((ref) => ref.model), ...provider.models, ...listed])].slice(0, 80)
      for (const model of names) choices.push({ providerId: provider.id, providerName: provider.name, model })
    }
    return choices
  }

  /**
   * Where a cloud run reaches the session's model, and the secret it needs there (the key and any
   * headers, as JSON), which goes to GitHub as a repository secret. Models on this computer can't
   * be reached from the cloud.
   */
  async cloudModel(model?: ModelRef | null): Promise<{ model: CoderCloudModel; secret: string | null }> {
    const ref = this.coderRef(model)
    const config = this.store.provider(ref.providerId)
    if (!config) throw new AiError('not-found', 'That provider no longer exists.')
    // Tests use a stand-in model on this computer, which a real cloud run couldn't reach.
    if (process.env.SCB_E2E !== '1' && /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0|192\.168\.|10\.)/i.test(config.baseUrl)) throw new AiError('bad-request', `${config.name} runs on this computer or its network, so the cloud can't reach it. Choose another model for this session.`)
    const secret = config.hosted ? null : await this.store.secret(ref.providerId)
    const needsKey = !!secret && (secret.apiKey !== '' || Object.keys(secret.headers).length > 0)
    return { model: { protocol: config.protocol, baseUrl: config.baseUrl, model: ref.model, needsKey, firstParty: config.firstParty }, secret: needsKey ? JSON.stringify(secret) : null }
  }

  private chatRef(): ModelRef {
    const chat = this.store.roles().chat
    if (!chat) throw new AiError('not-found', 'Choose a model in AI settings first.')
    return chat
  }

  /** Agentic coding (beta), on the chat model. Long replies, as it writes whole files. */
  readonly coder: Coder
  /** The web, a look at the shared tab, and MCP servers, for the chat. Absent for background work. */
  private readonly chatTools: ChatTools | null

  async coderStatus(folder: string): Promise<CoderStatus> {
    const chat = this.store.roles().chat
    const provider = chat && this.store.provider(chat.providerId)
    const status = this.store.status()
    const isGit = folder ? (await git(folder, ['rev-parse', '--is-inside-work-tree'])) === 'true' : false
    const branch = isGit ? await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']) : null
    return { folder: folder || null, ready: status.ready, model: status.model, providerName: status.providerName, hosted: !!provider?.hosted, running: this.coder.running, git: isGit, branch: branch && branch !== 'HEAD' ? branch : null, sandboxAvailable: sandboxAvailable(), devContainer: devContainerAvailable(folder || null) }
  }

  private async collect(ref: ModelRef, system: string, messages: ChatMessage[], signal?: AbortSignal, maxTokens = TASK_OUTPUT_TOKENS, onText?: (text: string) => void, onStop?: (reason: string | null) => void, extra: { onUsage?: (input: number, output: number) => void; effort?: ChatEffort | null; reasoning?: boolean; onReasoning?: (text: string) => void } = {}): Promise<string> {
    let text = ''
    let thought = ''
    const stream = (await this.provider(ref.providerId)).chat({ model: ref.model, system, messages, maxTokens, signal, ...(extra.effort ? { effort: extra.effort } : {}), ...(extra.reasoning ? { reasoning: true } : {}) })
    for await (const event of stream) {
      if (event.type === 'text') {
        text += event.text
        onText?.(text)
      }
      if (event.type === 'reasoning' && extra.onReasoning) {
        thought += event.text
        extra.onReasoning(thought)
      }
      if (event.type === 'usage') {
        this.store.addUsage(ref.providerId, ref.model, event.inputTokens, event.outputTokens)
        extra.onUsage?.(event.inputTokens, event.outputTokens)
      }
      if (event.type === 'stop') onStop?.(event.reason)
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
  async write(system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
    // A model that thinks first can spend its whole allowance before writing a word, and the reply
    // comes back empty. That gets one more go with the most room there is.
    let stop: string | null = null
    for (const budget of [...new Set([maxTokens, MAX_OUTPUT_TOKENS])]) {
      const text = await this.collect(this.chatRef(), system, [{ role: 'user', content: user }], signal, budget, undefined, (reason) => (stop = reason))
      if (text.trim()) return text
      if (signal?.aborted) break
    }
    throw new AiError('server', stop === 'length' || stop === 'max_tokens' ? 'The model ran out of room while thinking and wrote nothing. Try again, or choose another model in AI settings.' : 'The AI sent back nothing. Try again in a moment.')
  }

  /** Only the search itself goes to the AI, never the person's history. */
  async parseHistorySearch(query: string): Promise<HistoryQuery | null> {
    return parseHistoryQuery(await this.complete(historyQueryPrompt(localDay(Date.now())), query))
  }

  private siteOff(url: string): boolean {
    return URL.canParse(url) && this.store.disabledHosts().includes(new URL(effectiveUrl(url)).host)
  }

  /** The tab as the person sees it, as a JPEG no wider than 1280, for models that can look. */
  private async screenshot(tabId: number): Promise<string | null> {
    const contents = this.contentsFor(tabId)
    if (!contents || contents.isDestroyed() || this.siteOff(contents.getURL())) return null
    const image = await contents.capturePage().catch(() => null)
    if (!image || image.isEmpty()) return null
    const { width } = image.getSize()
    const shown = width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
    return `data:image/jpeg;base64,${shown.toJPEG(80).toString('base64')}`
  }

  answerApproval(approvalId: string, allow: boolean): void {
    if (!this.chatTools?.answer(approvalId, allow)) this.agent.answer(approvalId, allow)
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
      const system = (files ? WORKSPACE_PROMPT : SYSTEM_PROMPT) + (this.memoryOn() ? memoryPrompt(this.store.memory()) : '') + replyStylePrompt(this.replyStyle())
      const convo: ChatMessage[] = [...withContext(request.messages, pages, request.selection)]
      const key = `${chat.providerId}\n${chat.model}`
      // The hosted server takes tools only once its Worker with tool support is deployed.
      const hosted = !!this.store.provider(chat.providerId)?.hosted
      const sharedTab = request.includePage && request.tabId !== null && this.contentsFor(request.tabId) && !this.siteOff(this.contentsFor(request.tabId)!.getURL()) ? request.tabId : null
      const extra = this.chatTools && (!hosted || HOSTED_NATIVE_TOOLS) ? await this.chatTools.specs(sharedTab) : { specs: [], mcp: [] }
      const allowed = new Set<string>()
      let wrote = false
      for (let round = 0; ; round++) {
        // The last round answers with what it has.
        const offerExtra = round < MAX_CHAT_TOOL_ROUNDS
        const uses: ToolUse[] = []
        let blocks: unknown[] | undefined
        let said = ''
        let asked = false
        for (;;) {
          const withTool = (!hosted || HOSTED_NATIVE_TOOLS) && !this.noReportTool.has(key)
          const tools = withTool ? [REPORT_TOOL, ASK_TOOL, ...(offerExtra ? extra.specs : [])] : []
          const call = reportCallText()
          let sent = false
          const text = (piece: string) => {
            if (!piece) return
            // A new round's words start a new paragraph after the last one's.
            if (!sent && wrote && round > 0) emit({ streamId, type: 'text', text: '\n\n' })
            sent = true
            wrote = true
            said += piece
            emit({ streamId, type: 'text', text: piece })
          }
          try {
            const stream = provider.chat({
              model: chat.model,
              system: withTool ? `${system}\n\n${REPORT_TOOL_PROMPT}\n\n${ASK_TOOL_PROMPT}${tools.length > 2 ? `\n\n${CHAT_TOOLS_PROMPT}` : ''}` : `${system}\n\n${QUESTION_INSTRUCTIONS}`,
              messages: convo,
              maxTokens: MAX_OUTPUT_TOKENS,
              signal: controller.signal,
              ...(withTool ? { tools } : {})
            })
            for await (const event of stream) {
              if (event.type === 'text') text(event.text)
              if (event.type === 'tool-delta' && event.name === REPORT_TOOL.name) text(call.delta(event.index, event.text))
              if (event.type === 'tool' && event.use.name === REPORT_TOOL.name) text(call.whole(event.use.input))
              // Questions end the reply as a block the page shows as buttons; the answer is the next message.
              if (event.type === 'tool' && event.use.name === ASK_TOOL.name && event.use.input) {
                asked = true
                text(`${call.end()}\n\n\`\`\`${QUESTION_FENCE}\n${JSON.stringify(event.use.input)}\n\`\`\``)
              }
              if (event.type === 'tool') uses.push(event.use)
              if (event.type === 'blocks') blocks = event.blocks
              if (event.type === 'usage') this.store.addUsage(chat.providerId, chat.model, event.inputTokens, event.outputTokens)
              if (event.type === 'stop') stopReason = event.reason
            }
            text(call.end())
            break
          } catch (error) {
            const refused = withTool && !sent && !controller.signal.aborted && error instanceof AiError && error.kind === 'bad-request'
            // A picture of the person's the model can't take: it goes again without, and says so.
            const turnedDown = !sent && !controller.signal.aborted && error instanceof AiError && error.kind === 'bad-request'
            if (turnedDown && convo.some((message) => message.images?.length)) {
              for (const message of convo) if (message.images?.length) Object.assign(message, { images: undefined, content: `${message.content}\n\n(A picture was attached, but it couldn't be sent: this model may not take pictures. Say so if the question needs it.)` })
              continue
            }
            // A picture the model can't take: the round goes again with words in its place.
            const pictures = convo.at(-1)?.toolResults?.some((result) => result.images?.length)
            if (refused && pictures) {
              for (const result of convo.at(-1)!.toolResults!) if (result.images?.length) Object.assign(result, { images: undefined, output: `${result.output}\n(The picture couldn't be sent: this model may not take pictures.)` })
              continue
            }
            // A provider or model that doesn't take tools says so at once. The report is then written as text.
            if (refused && round === 0) {
              this.noReportTool.add(key)
              continue
            }
            throw error
          }
        }
        const work = uses.filter((use) => use.name !== REPORT_TOOL.name && use.name !== ASK_TOOL.name)
        if (work.length === 0 || asked || !this.chatTools || controller.signal.aborted) break
        convo.push({ role: 'assistant', content: said, toolUses: uses, ...(blocks ? { blocks } : {}) })
        const results: ToolOutput[] = []
        for (const use of uses) {
          if (use.name === REPORT_TOOL.name || use.name === ASK_TOOL.name) results.push({ id: use.id, tool: use.name, output: 'Shown to the person.' })
          else results.push(await this.chatTools.run(use, extra.mcp, { streamId, tabId: sharedTab, emit, signal: controller.signal }, allowed))
        }
        convo.push({ role: 'user', content: '', toolResults: results })
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

/** What Terra Code needs from the window it lives in. */
export interface CoderHome {
  dir: string
  keep: () => boolean
  trust?: CoderTrust
  sandbox?: () => SandboxMode
  autoCompact?: () => boolean
  autoCheck?: () => boolean
  autoFormat?: () => boolean
  showReasoning?: () => boolean
  /** Which model helpers use: the session's, or the quick model. */
  agentModel?: () => 'session' | 'quick'
  mcp?: CoderMcpHost
  browser?: CoderBrowserHost
  github?: CoderGithubHost
  budget?: () => number
  /** Terra Code's chosen folder, for project MCP servers the chat may use too. */
  folder?: () => string
}
