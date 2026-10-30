import { create } from 'zustand'
import type { AiStatus, AssistantEvent, AssistantMessage, AssistantPrompt } from '@scbrowser/shared'
import { useTabs } from './tabs'

export interface Turn extends AssistantMessage {
  /** Page title sent along with this turn. */
  pageTitle?: string
  truncated?: boolean
  error?: string
  /** Why the reply ended early, in words. */
  note?: string
}

interface AssistantStore {
  open: boolean
  status: AiStatus
  turns: Turn[]
  streamId: string | null
  includePage: boolean
  selection: string | null
  /** Bumped to pull focus into the composer. */
  focusRequest: number
  toggle: () => void
  close: () => void
  setIncludePage: (includePage: boolean) => void
  clearSelection: () => void
  reset: () => void
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
  status: { ready: false, model: null, providerName: null, disabledHosts: [] },
  turns: [],
  streamId: null,
  includePage: true,
  selection: null,
  focusRequest: 0,

  toggle: () => set((s) => ({ open: !s.open, focusRequest: s.focusRequest + 1 })),
  close: () => set({ open: false }),
  setIncludePage: (includePage) => set({ includePage }),
  clearSelection: () => set({ selection: null }),
  reset: () => {
    get().stop()
    set({ turns: [], selection: null, includePage: true, streamId: null })
  },

  send: (text) => {
    const { streamId, status, includePage, selection, turns } = get()
    if (streamId || !status.ready || !text.trim()) return
    const id = crypto.randomUUID()
    const sent: Turn[] = [...turns.filter((t) => t.content && !t.error), { role: 'user', content: text.trim() }]
    set({ turns: [...sent, { role: 'assistant', content: '' }], streamId: id, selection: null })
    void window.scb.invoke('ai:send', id, {
      messages: sent.map(({ role, content }) => ({ role, content })),
      tabId: useTabs.getState().activeId,
      includePage,
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

function onEvent(event: AssistantEvent) {
  const { streamId, turns } = useAssistant.getState()
  if (event.streamId !== streamId) return
  const last = turns.at(-1)
  if (!last) return
  const update = (patch: Partial<Turn>) => turns.slice(0, -1).concat({ ...last, ...patch })

  if (event.type === 'text') {
    useAssistant.setState({ turns: update({ content: last.content + event.text }) })
  } else if (event.type === 'context') {
    useAssistant.setState({ turns: update({ pageTitle: event.title, truncated: event.truncated }) })
  } else if (event.type === 'error') {
    useAssistant.setState({ turns: update({ error: event.message }), streamId: null })
  } else {
    const note = event.stopReason ? STOP_NOTES[event.stopReason] : undefined
    useAssistant.setState({ turns: update(note ? { note } : {}), streamId: null })
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
