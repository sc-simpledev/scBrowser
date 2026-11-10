import { create } from 'zustand'
import { conversationReports, MAX_MENTIONED_TABS, reviseReportPrompt, type AiStatus, type AssistantEvent, type AssistantPrompt, type ChatSummary, type Report, type SavedTurn } from '@scbrowser/shared'
import { useTabs } from './tabs'

/** In split view the page being read is both halves, so the other one goes along with the active one. */
export function splitPartner(activeId: number | null, splitIds: number[]): number | null {
  if (activeId === null || splitIds.length !== 2 || !splitIds.includes(activeId)) return null
  return splitIds.find((id) => id !== activeId) ?? null
}

function withSplitPartner(mentions: number[], activeId: number | null): number[] {
  const partner = splitPartner(activeId, useTabs.getState().splitIds)
  if (partner === null || mentions.includes(partner)) return mentions
  return [partner, ...mentions].slice(0, MAX_MENTIONED_TABS)
}

export interface Turn extends SavedTurn {
  error?: string
  /** The error was the AI service being unreachable, which a VPN may fix. */
  network?: boolean
  /** Agent mode: what it has done so far. */
  steps?: string[]
  /** Why the reply ended early, in words. */
  note?: string
}

interface AssistantStore {
  open: boolean
  status: AiStatus
  turns: Turn[]
  /** Set once the conversation has been saved or reopened. */
  chatId: string | null
  chats: ChatSummary[] | null
  /** The report shown beside the panel. */
  report: Report | null
  streamId: string | null
  includePage: boolean
  /** Searches the web for each message first. Stays on until turned off. */
  webSearch: boolean
  selection: string | null
  /** Other tabs @-mentioned for the next message. */
  mentions: number[]
  /** Messages become goals for the agent to carry out in this tab. */
  agentMode: boolean
  approval: { id: string; text: string; reason: string } | null
  /** Bumped to pull focus into the composer. */
  focusRequest: number
  toggle: () => void
  showReport: (report: Report | null) => void
  /** Asks for a new draft of the open report. It only needs the conversation, not the page. */
  reviseReport: (change: string) => void
  close: () => void
  setIncludePage: (includePage: boolean) => void
  setWebSearch: (webSearch: boolean) => void
  clearSelection: () => void
  setAgentMode: (agentMode: boolean) => void
  answerApproval: (allow: boolean) => void
  mention: (id: number) => void
  unmention: (id: number) => void
  reset: () => void
  toggleChats: () => void
  openChat: (id: string) => void
  deleteChat: (id: string) => void
  send: (text: string) => void
  /** Sends the last message again, after a failure. */
  retry: () => void
  stop: () => void
  applyPrompt: (prompt: AssistantPrompt) => void
}

const STOP_NOTES: Record<string, string> = {
  max_tokens: 'The reply hit its length limit.',
  length: 'The reply hit its length limit.',
  refusal: 'The model declined to answer this.',
  content_filter: 'The provider filtered this reply.',
  cancelled: 'Stopped.'
}

export const useAssistant = create<AssistantStore>((set, get) => ({
  open: false,
  status: { ready: false, model: null, providerName: null, disabledHosts: [], hostedAvailable: false, skills: [] },
  turns: [],
  chatId: null,
  chats: null,
  report: null,
  streamId: null,
  includePage: true,
  webSearch: false,
  selection: null,
  mentions: [],
  agentMode: false,
  approval: null,
  focusRequest: 0,

  toggle: () => set((s) => ({ open: !s.open, report: s.open ? null : s.report, focusRequest: s.focusRequest + 1 })),
  close: () => set({ open: false, report: null }),
  showReport: (report) => set({ report }),
  reviseReport: (change) => {
    const { report, includePage, agentMode, send } = get()
    if (!report) return
    set({ includePage: false, agentMode: false })
    send(reviseReportPrompt(report.title, change))
    set({ includePage, agentMode })
  },
  setIncludePage: (includePage) => set({ includePage }),
  setWebSearch: (webSearch) => set({ webSearch }),
  clearSelection: () => set({ selection: null }),
  setAgentMode: (agentMode) => set({ agentMode }),
  answerApproval: (allow) => {
    const { approval } = get()
    if (!approval) return
    set({ approval: null })
    void window.scb.invoke('ai:agent-answer', approval.id, allow)
  },
  mention: (id) => set((s) => (s.mentions.length < MAX_MENTIONED_TABS && !s.mentions.includes(id) ? { mentions: [...s.mentions, id] } : s)),
  unmention: (id) => set((s) => ({ mentions: s.mentions.filter((m) => m !== id) })),
  reset: () => {
    get().stop()
    set({ turns: [], chatId: null, chats: null, report: null, selection: null, includePage: true, streamId: null })
  },

  toggleChats: () => {
    if (get().chats) set({ chats: null })
    else void window.scb.invoke('chats:list').then((chats) => set({ chats }))
  },

  openChat: (id) => {
    get().stop()
    void window.scb.invoke('chats:get', id).then((chat) => {
      if (chat) set({ turns: chat.turns, chatId: chat.id, chats: null, report: null, streamId: null, selection: null })
    })
  },

  deleteChat: (id) => {
    void window.scb.invoke('chats:delete', id)
    set((s) => ({
      chats: s.chats?.filter((chat) => chat.id !== id) ?? null,
      ...(s.chatId === id ? { chatId: null, turns: [], report: null } : {})
    }))
  },

  send: (text) => {
    const { streamId, status, includePage, selection, turns, chatId, mentions, agentMode, webSearch } = get()
    if (streamId || !status.ready || !text.trim()) return
    const id = crypto.randomUUID()
    const sent: Turn[] = [...turns.filter((t) => t.content && !t.error), { role: 'user', content: text.trim() }]
    set({ turns: [...sent, { role: 'assistant', content: '' }], streamId: id, selection: null, chatId: chatId ?? crypto.randomUUID(), chats: null, mentions: [] })
    const tabId = useTabs.getState().activeId
    if (agentMode && tabId !== null) {
      void window.scb.invoke('ai:agent-start', id, text.trim(), tabId)
      return
    }
    void window.scb.invoke('ai:send', id, {
      messages: sent.map(({ role, content }) => ({ role, content })),
      tabId,
      includePage,
      extraTabIds: withSplitPartner(mentions, includePage ? tabId : null),
      selection,
      webSearch
    })
  },

  retry: () => {
    const { turns, streamId } = get()
    if (streamId) return
    const lastUser = turns.findLastIndex((turn) => turn.role === 'user')
    if (lastUser === -1) return
    const text = turns[lastUser]!.content
    set({ turns: turns.slice(0, lastUser) })
    get().send(text)
  },

  stop: () => {
    const { streamId } = get()
    if (streamId) void window.scb.invoke('ai:cancel', streamId)
  },

  applyPrompt: ({ text, selection, includePage }) => {
    set((s) => ({ open: true, selection, includePage, focusRequest: s.focusRequest + 1 }))
    if (text) get().send(text)
  }
}))

function saveChat() {
  const { chatId, turns } = useAssistant.getState()
  const saved = turns
    .filter((turn) => turn.content && !turn.error)
    .map(({ role, content, pageTitle, source, truncated, sources }) => ({
      role,
      content,
      ...(sources === undefined ? {} : { sources }),
      ...(pageTitle === undefined ? {} : { pageTitle }),
      ...(source === undefined ? {} : { source }),
      ...(truncated === undefined ? {} : { truncated })
    }))
  if (chatId && saved.length > 0) void window.scb.invoke('chats:save', chatId, saved)
}

function onEvent(event: AssistantEvent) {
  const { streamId, turns } = useAssistant.getState()
  if (event.streamId !== streamId) return
  const last = turns.at(-1)
  if (!last) return
  const update = (patch: Partial<Turn>) => turns.slice(0, -1).concat({ ...last, ...patch })

  if (event.type === 'text') {
    useAssistant.setState({ turns: update({ content: last.content + event.text }) })
  } else if (event.type === 'context') {
    useAssistant.setState({ turns: update({ pageTitle: event.title, truncated: event.truncated, source: event.source, ...(event.sources ? { sources: event.sources } : {}) }) })
  } else if (event.type === 'error') {
    useAssistant.setState({ turns: update({ error: event.message, network: !!event.network }), streamId: null, approval: null })
  } else if (event.type === 'step') {
    useAssistant.setState({ turns: update({ steps: [...(last.steps ?? []), event.text] }) })
  } else if (event.type === 'approval') {
    useAssistant.setState({ approval: { id: event.approvalId, text: event.text, reason: event.reason } })
  } else {
    const note = event.stopReason ? STOP_NOTES[event.stopReason] : undefined
    const finished = update(note ? { note } : {})
    // A new draft takes over from the one being read.
    const { report } = useAssistant.getState()
    const newest = report ? conversationReports(finished).at(-1) : undefined
    useAssistant.setState({ turns: finished, streamId: null, approval: null, ...(newest ? { report: newest } : {}) })
    saveChat()
  }
}

/** Subscribes the store to main-process events. Call once at startup. */
export function connectAssistant(): () => void {
  const { toggle, applyPrompt } = useAssistant.getState()
  const setStatus = (status: AiStatus) => useAssistant.setState({ status })
  void window.scb.invoke('ai:status').then(setStatus)
  const unsubscribers = [
    window.scb.on('ai:changed', setStatus),
    window.scb.on('ai:event', onEvent),
    window.scb.on('ui:assistant-toggle', toggle),
    window.scb.on('ui:assistant-prompt', applyPrompt)
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
