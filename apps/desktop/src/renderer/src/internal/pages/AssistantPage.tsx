import { ArrowUp, Square } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@scbrowser/ui'
import type { AiStatus, AssistantEvent, SavedTurn } from '@scbrowser/shared'
import { ReplyContent } from '../../shared/ReplyContent'
import { api } from '../api'

interface Turn extends SavedTurn {
  error?: string
}

const openLink = (href: string) => void api().invoke('browser:open', href)

/** A whole page for longer conversations and reports. */
export function AssistantPage() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [streamId, setStreamId] = useState<string | null>(null)
  const chatId = useRef<string | null>(new URLSearchParams(location.search).get('chat'))
  const logRef = useRef<HTMLDivElement>(null)

  const send = useCallback((text: string) => {
    const question = text.trim()
    if (!question) return
    const id = crypto.randomUUID()
    chatId.current ??= crypto.randomUUID()
    setStreamId(id)
    setTurns((current) => {
      const history = [...current.filter((t) => t.content && !t.error), { role: 'user' as const, content: question }]
      void api().invoke('ai:send', id, {
        messages: history.map(({ role, content }) => ({ role, content })),
        tabId: null,
        includePage: false,
        extraTabIds: [],
        selection: null
      })
      return [...history, { role: 'assistant', content: '' }]
    })
  }, [])

  useEffect(() => {
    const onEvent = (event: AssistantEvent) => {
      const update = (patch: (last: Turn) => Turn) =>
        setTurns((current) => {
          const last = current.at(-1)
          return last ? [...current.slice(0, -1), patch(last)] : current
        })
      if (event.type === 'text') update((last) => ({ ...last, content: last.content + event.text }))
      if (event.type === 'error') {
        update((last) => ({ ...last, error: event.message }))
        setStreamId(null)
      }
      if (event.type === 'done') {
        setStreamId(null)
        setTurns((current) => {
          const saved = current.filter((t) => t.content && !t.error).map(({ role, content }) => ({ role, content }))
          if (chatId.current && saved.length > 0) void api().invoke('chats:save', chatId.current, saved)
          return current
        })
      }
    }
    return api().onAssistantEvent(onEvent)
  }, [])

  // Loads what this page was opened for, once the status says whether AI is ready.
  useEffect(() => {
    let cancelled = false
    void api()
      .invoke('ai:status')
      .then(async (next) => {
        if (cancelled) return
        setStatus(next)
        if (chatId.current) {
          const chat = await api().invoke('chats:get', chatId.current)
          if (chat && !cancelled) setTurns(chat.turns)
          return
        }
        const prompt = await api().invoke('ai:take-prompt')
        if (prompt && next.ready && !cancelled) send(prompt)
      })
    return () => {
      cancelled = true
    }
  }, [send])

  useLayoutEffect(() => {
    const log = logRef.current
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight
  }, [turns])

  const submit = () => {
    if (streamId || !draft.trim()) return
    send(draft)
    setDraft('')
  }

  if (status && !status.ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-text-muted">Set up AI to use the assistant.</p>
        <Button variant="primary" onClick={() => void api().invoke('browser:open', 'sc://ai/')}>
          Set up AI
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={logRef} role="log" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-180 flex-col gap-6 px-8 py-8">
          {turns.length === 0 && <h1 className="text-lg font-semibold">What can I help with?</h1>}
          {turns.map((turn, index) =>
            turn.role === 'user' ? (
              <div key={index} className="ml-12 self-end rounded-lg bg-surface-hover px-3 py-2 whitespace-pre-wrap">
                {turn.content}
              </div>
            ) : (
              <div key={index}>
                {turn.content && <ReplyContent text={turn.content} onOpenLink={openLink} />}
                {!turn.content && !turn.error && <span className="text-text-faint">Thinking…</span>}
                {turn.error && (
                  <p role="alert" className="text-danger">
                    {turn.error}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-180 shrink-0 px-8 pb-6">
        <div className="flex items-end gap-1 rounded-md bg-field p-1 focus-within:shadow-[0_0_0_2px_var(--sc-focus-ring)]">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            aria-label="Message the assistant"
            placeholder="Ask anything"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-text outline-none placeholder:text-text-faint"
          />
          {streamId ? (
            <IconButton size="sm" label="Stop" onClick={() => void api().invoke('ai:cancel', streamId)}>
              <Square size={12} strokeWidth={2} />
            </IconButton>
          ) : (
            <IconButton size="sm" label="Send" disabled={!draft.trim()} onClick={submit}>
              <ArrowUp size={14} strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
