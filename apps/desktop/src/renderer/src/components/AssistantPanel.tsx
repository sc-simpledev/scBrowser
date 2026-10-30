import { ArrowUp, FileText, History, Plus, Quote, Square, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { isHttpUrl, SUMMARISE_PROMPT } from '@scbrowser/shared'
import { useAssistant, type Turn } from '../state/assistant'
import { useActiveTab } from '../state/tabs'
import { AssistantMarkdown } from './AssistantMarkdown'

function contextLabel({ truncated, source }: Turn) {
  const what = source === 'transcript' ? 'the transcript of ' : source === 'pdf' ? 'the PDF ' : ''
  return `Read ${truncated ? `the start of ${what || ''}` : what}`
}

function ChatList() {
  const chats = useAssistant((s) => s.chats) ?? []
  const { openChat, deleteChat } = useAssistant.getState()
  if (chats.length === 0) return <p className="flex-1 px-3 py-2 text-text-muted">No saved chats yet.</p>
  return (
    <ul aria-label="Saved chats" className="min-h-0 flex-1 overflow-y-auto px-1.5">
      {chats.map((chat) => (
        <li key={chat.id} className="group flex h-9 items-center gap-1 rounded-md pr-1 hover:bg-surface-hover">
          <button type="button" onClick={() => openChat(chat.id)} className="h-full min-w-0 flex-1 truncate px-1.5 text-left">
            {chat.title}
          </button>
          <IconButton
            size="sm"
            label="Delete chat"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => deleteChat(chat.id)}
          >
            <Trash2 size={12} strokeWidth={1.75} />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}

function Message({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  if (turn.role === 'user') {
    return <div className="ml-6 self-end rounded-lg bg-surface-hover px-3 py-2 whitespace-pre-wrap select-text">{turn.content}</div>
  }
  return (
    <div className="flex flex-col gap-1 select-text">
      {turn.pageTitle && (
        <div className="flex items-center gap-1 text-xs text-text-faint">
          <FileText aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">
            {contextLabel(turn)}
            {turn.pageTitle}
          </span>
        </div>
      )}
      {turn.content && <AssistantMarkdown text={turn.content} />}
      {streaming && !turn.content && <span className="text-text-faint">Thinking…</span>}
      {turn.note && <p className="text-xs text-text-muted">{turn.note}</p>}
      {turn.error && (
        <p role="alert" className="text-danger">
          {turn.error}
        </p>
      )}
    </div>
  )
}

export function AssistantPanel() {
  const { open, status, turns, streamId, includePage, selection, focusRequest, chats } = useAssistant()
  const { close, reset, send, stop, setIncludePage, clearSelection, toggleChats } = useAssistant.getState()
  const tab = useActiveTab()
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const host = tab && isHttpUrl(tab.url) ? new URL(tab.url).host : null
  const canRead = !!tab && /^(https?|file):/.test(tab.url)
  const siteOff = !!host && status.disabledHosts.includes(host)
  const sharing = includePage && canRead && !siteOff

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, focusRequest])

  // Follow the reply as it streams, unless the person has scrolled up to read.
  useLayoutEffect(() => {
    const log = logRef.current
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight
  }, [turns])

  if (!open) return null

  const submit = () => {
    if (!draft.trim() || streamId) return
    send(draft)
    setDraft('')
  }

  return (
    <aside aria-label="Assistant" className="relative flex w-90 shrink-0 flex-col pr-1.5 pb-1.5">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface shadow-1">
        {streamId && <div aria-hidden className="sc-generating absolute inset-x-0 top-0 h-0.5" />}
        <header className="flex h-10 shrink-0 items-center gap-1 pr-1 pl-3">
          <div className="min-w-0 flex-1 truncate text-xs text-text-muted">{status.model ?? 'Assistant'}</div>
          <IconButton size="sm" label="Saved chats" aria-pressed={!!chats} onClick={toggleChats}>
            <History size={14} strokeWidth={1.75} />
          </IconButton>
          <IconButton size="sm" label="New chat" disabled={turns.length === 0} onClick={reset}>
            <Plus size={14} strokeWidth={1.75} />
          </IconButton>
          <IconButton size="sm" label="Close assistant" shortcut="Ctrl Shift A" onClick={close}>
            <X size={14} strokeWidth={1.75} />
          </IconButton>
        </header>

        {!status.ready ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-text-muted">Connect an AI provider with your own API key, or a local model.</p>
            <Button variant="primary" onClick={() => void window.scb.invoke('ai:open-settings')}>
              Set up AI
            </Button>
          </div>
        ) : chats ? (
          <ChatList />
        ) : (
          <>
            <div ref={logRef} role="log" aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
              {turns.length === 0 && canRead && !siteOff && (
                <div className="flex flex-1 items-center justify-center">
                  <Button
                    onClick={() => {
                      setIncludePage(true)
                      send(SUMMARISE_PROMPT)
                    }}
                  >
                    Summarise this page
                  </Button>
                </div>
              )}
              {turns.map((turn, index) => (
                <Message key={index} turn={turn} streaming={!!streamId && index === turns.length - 1} />
              ))}
            </div>

            <div className="flex shrink-0 flex-col gap-2 p-2">
              {selection && (
                <div className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-muted">
                  <Quote aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{selection}</span>
                  <IconButton size="sm" label="Remove selection" onClick={clearSelection}>
                    <X size={12} strokeWidth={2} />
                  </IconButton>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-xs">
                {canRead && !siteOff && (
                  <button
                    type="button"
                    aria-pressed={sharing}
                    title={sharing ? `Page text is sent to ${status.providerName}` : 'Page text is not sent'}
                    onClick={() => setIncludePage(!includePage)}
                    className={cx(
                      'flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 transition-colors hover:bg-surface-hover',
                      sharing ? 'text-text-muted' : 'text-text-faint line-through'
                    )}
                  >
                    <FileText aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0', sharing && 'text-accent')} />
                    <span className="truncate">{tab?.title || 'This page'}</span>
                  </button>
                )}
                {host && (
                  <button
                    type="button"
                    onClick={() => void window.scb.invoke('ai:set-site', host, !siteOff)}
                    className="ml-auto h-6 shrink-0 rounded-sm px-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    {siteOff ? 'Allow AI on this site' : 'Off for this site'}
                  </button>
                )}
              </div>
              <div className="flex items-end gap-1 rounded-md bg-field p-1 focus-within:shadow-[0_0_0_2px_var(--sc-focus-ring)]">
                <textarea
                  ref={inputRef}
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
                  className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-text outline-none select-text placeholder:text-text-faint"
                />
                {streamId ? (
                  <IconButton size="sm" label="Stop" onClick={stop}>
                    <Square size={12} strokeWidth={2} />
                  </IconButton>
                ) : (
                  <IconButton size="sm" label="Send" disabled={!draft.trim()} onClick={submit}>
                    <ArrowUp size={14} strokeWidth={2} />
                  </IconButton>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
