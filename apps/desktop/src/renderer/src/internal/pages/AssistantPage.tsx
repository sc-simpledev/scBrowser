import { ArrowUp, Plus, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import contentCss from '@scbrowser/ui/content.css?raw'
import tokensCss from '@scbrowser/ui/tokens.css?raw'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { reportHtml, type AiStatus, type AssistantEvent, type ChatSummary, type Report, type SavedTurn } from '@scbrowser/shared'
import { ReplyContent } from '../../shared/ReplyContent'
import { api } from '../api'

interface Turn extends SavedTurn {
  error?: string
}

const openLink = (href: string) => void api().invoke('browser:open', href)

// A saved report stands alone, so it takes the tokens but not the fonts they import.
const REPORT_CSS = `${tokensCss.replace(/^@import .*$/gm, '')}\n${contentCss}`
const saveReport = (report: Report) => void api().invoke('report:save', report.title, reportHtml(report, REPORT_CSS))

const dayLabel = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Saved conversations, newest first. */
function ChatList({ chats, current, onDelete }: { chats: ChatSummary[]; current: string | null; onDelete: (id: string) => void }) {
  return (
    <nav aria-label="Saved chats" className="flex w-60 shrink-0 flex-col gap-2 border-r border-border p-3">
      <Button onClick={() => (location.href = 'sc://assistant/')}>
        <Plus aria-hidden size={14} strokeWidth={1.75} />
        New chat
      </Button>
      <ul className="sc-scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {chats.length === 0 && <li className="px-2 py-1.5 text-xs text-text-faint">Your chats will appear here.</li>}
        {chats.map((chat, index) => (
          <li key={chat.id}>
            {dayLabel(chat.updatedAt) !== (chats[index - 1] && dayLabel(chats[index - 1]!.updatedAt)) && (
              <div className="px-2 pt-2 pb-1 text-2xs font-medium text-text-faint">{dayLabel(chat.updatedAt)}</div>
            )}
            <div className={cx('group relative flex items-center rounded-md transition-colors', chat.id === current ? 'bg-surface-active' : 'hover:bg-surface-hover')}>
              <a
                href={`sc://assistant/?chat=${encodeURIComponent(chat.id)}`}
                aria-current={chat.id === current ? 'page' : undefined}
                className={cx('min-w-0 flex-1 truncate px-2 py-1.5 pr-8', chat.id === current ? 'font-medium text-text' : 'text-text-muted')}
              >
                {chat.title}
              </a>
              <IconButton size="sm" label="Delete chat" className="absolute right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => onDelete(chat.id)}>
                <Trash2 size={12} strokeWidth={1.75} />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** A whole page for longer conversations and reports. */
export function AssistantPage() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [streamId, setStreamId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
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

  const refreshChats = useCallback(() => void api().invoke('chats:list').then(setChats), [])
  useEffect(refreshChats, [refreshChats])

  const deleteChat = (id: string) => {
    void api().invoke('chats:delete', id).then(refreshChats)
    if (id === chatId.current) location.href = 'sc://assistant/'
  }

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
          if (chatId.current && saved.length > 0) void api().invoke('chats:save', chatId.current, saved).then(refreshChats)
          return current
        })
      }
    }
    return api().onAssistantEvent(onEvent)
  }, [refreshChats])

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

  // Saved chats can still be read with no AI set up.
  if (status && !status.ready && turns.length === 0) {
    return (
      <div className="flex h-full">
        <ChatList chats={chats} current={chatId.current} onDelete={deleteChat} />
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-text-muted">Set up AI to use the assistant.</p>
          <Button variant="primary" onClick={() => void api().invoke('browser:open', 'sc://ai/')}>
            Set up AI
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
    <ChatList chats={chats} current={chatId.current} onDelete={deleteChat} />
    <div className="flex min-w-0 flex-1 flex-col">
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
                {turn.content && <ReplyContent text={turn.content} onOpenLink={openLink} onSaveReport={saveReport} streaming={streamId !== null && index === turns.length - 1} />}
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
      <div className="mx-auto w-full max-w-180 shrink-0 px-8 pb-6" hidden={!status?.ready}>
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
    </div>
  )
}
