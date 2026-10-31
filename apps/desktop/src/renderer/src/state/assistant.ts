import { create } from 'zustand'
import { MAX_MENTIONED_TABS, type AiStatus, type AssistantEvent, type AssistantPrompt, type ChatSummary, type SavedTurn } from '@scbrowser/shared'
import { useTabs } from './tabs'

export interface Turn extends SavedTurn {
  error?: string
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
  streamId: string | null
  includePage: boolean
  selection: string | null
  /** Other tabs @-mentioned for the next message. */
  mentions: number[]
  /** Messages become goals for the agent to carry out in this tab. */
  agentMode: boolean
  approval: { id: string; text: string; reason: string } | null
  /** Bumped to pull focus into the composer. */
  focusRequest: number
  toggle: () => void
  close: () => void
  setIncludePage: (includePage: boolean) => void
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
  stop: () => void
  applyPrompt: (prompt: AssistantPrompt) => void
}

const STOP_NOTES: Record<string, string> = {
  max_tokens: 'The reply hit its length limit.',
  length: 'The reply hit its length limit.',
  refusal: 'The model declined to answer this.',
  content_filter: 'The provider filtered this reply.'
}

export const useAssistant = create<AssistantStore>((set, get) => ({
  open: false,
  status: { ready: false, model: null, providerName: null, disabledHosts: [], hostedAvailable: false, skills: [] },
  turns: [],
  chatId: null,
  chats: null,
  streamId: null,
  includePage: true,
  selection: null,
  mentions: [],
  agentMode: false,
  approval: null,
  focusRequest: 0,

  toggle: () => set((s) => ({ open: !s.open, focusRequest: s.focusRequest + 1 })),
  close: () => set({ open: false }),
  setIncludePage: (includePage) => set({ includePage }),
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
    set({ turns: [], chatId: null, chats: null, selection: null, includePage: true, streamId: null })
  },

  toggleChats: () => {
    if (get().chats) set({ chats: null })
    else void window.scb.invoke('chats:list').then((chats) => set({ chats }))
  },

  openChat: (id) => {
    get().stop()
    void window.scb.invoke('chats:get', id).then((chat) => {
      if (chat) set({ turns: chat.turns, chatId: chat.id, chats: null, streamId: null, selection: null })
    })
  },

  deleteChat: (id) => {
    void window.scb.invoke('chats:delete', id)
    set((s) => ({
      chats: s.chats?.filter((chat) => chat.id !== id) ?? null,
      ...(s.chatId === id ? { chatId: null, turns: [] } : {})
    }))
  },

  send: (text) => {
    const { streamId, status, includePage, selection, turns, chatId, mentions, agentMode } = get()
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
      extraTabIds: mentions,
      selection
    })
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
    .map(({ role, content, pageTitle, source, truncated }) => ({
      role,
      content,
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
    useAssistant.setState({ turns: update({ pageTitle: event.title, truncated: event.truncated, source: event.source }) })
  } else if (event.type === 'error') {
    useAssistant.setState({ turns: update({ error: event.message }), streamId: null, approval: null })
  } else if (event.type === 'step') {
    useAssistant.setState({ turns: update({ steps: [...(last.steps ?? []), event.text] }) })
  } else if (event.type === 'approval') {
    useAssistant.setState({ approval: { id: event.approvalId, text: event.text, reason: event.reason } })
  } else {
    const note = event.stopReason ? STOP_NOTES[event.stopReason] : undefined
    useAssistant.setState({ turns: update(note ? { note } : {}), streamId: null, approval: null })
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
