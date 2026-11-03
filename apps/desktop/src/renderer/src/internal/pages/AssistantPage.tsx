import { ArrowUp, PanelLeft, Plus, Settings, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { reportVersions, reviseReportPrompt, shownMessage, type AiStatus, type AssistantEvent, type ChatSummary, type Report, type SavedTurn } from '@scbrowser/shared'
import { CopyReply, latestReport, ReplyContent, Thinking } from '../../shared/ReplyContent'
import { ReportPane, type SaveReport } from '../../shared/ReportPane'
import { api } from '../api'

interface Turn extends SavedTurn {
  error?: string
}

const openLink = (href: string) => void api().invoke('browser:open', href)

const saveReport: SaveReport = (title, format, content) => api().invoke('report:save', title, format, content)

/** Below this, a report and the chat list don't both leave room for the conversation. */
const ROOM_FOR_ALL = 1180
/** There's more room here than beside a page, so a report starts out wider. */
const REPORT_START_WIDTH = 640

const dayLabel = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Saved conversations, newest first. */
function ChatList({ chats, current, onDelete }: { chats: ChatSummary[]; current: string | null; onDelete: (id: string) => void }) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-2 border-r border-border p-3">
    <nav aria-label="Saved chats" className="flex min-h-0 flex-1 flex-col gap-2">
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
      <a href="sc://settings/" className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
        <Settings aria-hidden size={14} strokeWidth={1.75} />
        Settings
      </a>
    </div>
  )
}

/** A whole page for longer conversations and reports. */
export function AssistantPage() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [streamId, setStreamId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [listOpen, setListOpen] = useState(true)
  const [reportWidth, setReportWidth] = useState(REPORT_START_WIDTH)
  useEffect(() => {
    void api().invoke('settings:get').then((settings) => setReportWidth(Math.max(REPORT_START_WIDTH, settings.reportWidth)))
  }, [])
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

  const showReport = useCallback((next: Report | null) => {
    setReport(next)
    if (next && innerWidth < ROOM_FOR_ALL) setListOpen(false)
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
          const written = latestReport(current.slice(-1))
          if (written) showReport(written)
          return current
        })
      }
    }
    return api().onAssistantEvent(onEvent)
  }, [refreshChats, showReport])

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
          if (chat && !cancelled) {
            setTurns(chat.turns)
            showReport(latestReport(chat.turns))
          }
          return
        }
        const prompt = await api().invoke('ai:take-prompt')
        if (prompt && next.ready && !cancelled) send(prompt)
      })
    return () => {
      cancelled = true
    }
  }, [send, showReport])

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

  const empty = turns.length === 0
  const composer = (
    <div className="mx-auto w-full max-w-180 shrink-0 px-8 pb-6" hidden={!status?.ready}>
      <div className="flex flex-col rounded-lg border border-border bg-field transition-colors focus-within:border-border-strong focus-within:shadow-[0_0_0_2px_var(--sc-focus-ring)]">
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
          className="max-h-60 min-h-14 w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-text outline-none [field-sizing:content] placeholder:text-text-faint"
        />
        <div className="flex items-center justify-between gap-2 p-2">
          <span className="min-w-0 truncate text-xs text-text-faint">{status?.model}</span>
          {streamId ? (
            <IconButton size="sm" label="Stop" onClick={() => void api().invoke('ai:cancel', streamId)}>
              <Square size={12} strokeWidth={2} />
            </IconButton>
          ) : (
            <IconButton size="sm" label="Send" disabled={!draft.trim()} className={draft.trim() ? 'bg-text! text-surface! hover:opacity-85' : ''} onClick={submit}>
              <ArrowUp size={14} strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      {listOpen && <ChatList chats={chats} current={chatId.current} onDelete={deleteChat} />}
      <div className="relative flex min-w-72 flex-1 flex-col">
        <IconButton label={listOpen ? 'Hide chats' : 'Show chats'} side="right" className="absolute top-2 left-2 z-10" aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}>
          <PanelLeft size={15} strokeWidth={1.75} />
        </IconButton>
        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center pb-16">
            <h1 className="mx-auto w-full max-w-180 px-8 pb-5 text-xl font-semibold tracking-[-0.03em]">What can I help with?</h1>
            {composer}
          </div>
        ) : (
          <>
            <div ref={logRef} role="log" aria-label="Conversation" className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-180 flex-col gap-7 px-8 py-10">
                {turns.map((turn, index) => {
                  const streaming = streamId !== null && index === turns.length - 1
                  return turn.role === 'user' ? (
                    <div key={index} className="ml-16 self-end rounded-lg bg-surface-hover px-3.5 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {shownMessage(turn.content)}
                    </div>
                  ) : (
                    <div key={index} className="group/reply flex flex-col gap-1.5">
                      {turn.content && <ReplyContent text={turn.content} onOpenLink={openLink} onOpenReport={showReport} openReport={report} streaming={streaming} />}
                      {!turn.content && !turn.error && <Thinking />}
                      {turn.error && (
                        <p role="alert" className="text-danger">
                          {turn.error}
                        </p>
                      )}
                      {!streaming && turn.content && (
                        <div className="-ml-1 flex h-6 opacity-0 transition-opacity group-focus-within/reply:opacity-100 group-hover/reply:opacity-100">
                          <CopyReply text={turn.content} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            {composer}
          </>
        )}
      </div>
      {report && (
        <ReportPane
          report={report}
          versions={reportVersions(turns, report.title)}
          onSelect={setReport}
          onRevise={status?.ready ? (change) => send(reviseReportPrompt(report.title, change)) : undefined}
          busy={streamId !== null}
          save={saveReport}
          onClose={() => setReport(null)}
          width={reportWidth}
          onWidth={setReportWidth}
          onWidthCommit={(next) => void api().invoke('settings:set', { reportWidth: next })}
        />
      )}
    </div>
  )
}
