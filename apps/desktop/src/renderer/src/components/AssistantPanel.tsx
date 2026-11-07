import { ArrowUp, AtSign, Check, FileText, Globe, Hand, History, Plus, Quote, Square, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { isHttpUrl, reportVersions, shownMessage, SUMMARISE_PROMPT, effectiveUrl, PDF_PAGE_URL, summarisePromptFor, VIDEO_SUMMARY_PROMPT } from '@scbrowser/shared'
import { useAssistant, type Turn } from '../state/assistant'
import { useActiveTab, useTabs } from '../state/tabs'
import { CopyReply, ReplyContent, Thinking, type OpenSource } from '../shared/ReplyContent'
import { ReportPane } from '../shared/ReportPane'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useApp } from '../state/app'

const openSource: OpenSource = (source, target) => void window.scb.invoke('ai:open-source', { tabId: source.tabId, url: source.url }, target)

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

const PAGE_STARTERS = [
  { label: 'Summarise this page', prompt: SUMMARISE_PROMPT },
  { label: 'Pull out the key points', prompt: 'List the key points of this page as short bullets.' },
  { label: 'Explain it simply', prompt: 'Explain this page simply, as if I know nothing about the topic.' }
]

const MENTION = /(^|\s)@([^\s]*)$/

interface PickerItem {
  id: string
  label: string
  run: () => void
}

function ComposerPicker({ items, selected }: { items: PickerItem[]; selected: number }) {
  return (
    <ul role="listbox" aria-label="Suggestions" className="flex max-h-48 flex-col overflow-y-auto rounded-md bg-surface p-1 shadow-2">
      {items.map((item, index) => (
        <li key={item.id} role="option" aria-selected={index === selected}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              item.run()
            }}
            className={cx('h-8 w-full truncate rounded-sm px-2 text-left', index === selected ? 'bg-accent-soft' : 'hover:bg-surface-hover')}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

const openLink = (href: string) => void window.scb.invoke('tabs:open-in-background', href)

const setResizing = (resizing: boolean) => void window.scb.invoke('layout:resizing', resizing)
const MIN_PANEL = 300
const MAX_PANEL = 720

/** The report beside the panel. It takes its room from the page, as the panel itself does. */
export function AssistantReport() {
  const report = useAssistant((s) => s.report)
  const turns = useAssistant((s) => s.turns)
  const streaming = useAssistant((s) => !!s.streamId)
  const ready = useAssistant((s) => s.status.ready)
  const chatId = useAssistant((s) => s.chatId)
  const saved = useApp((s) => s.settings.reportWidth)
  const [width, setWidth] = useState<number | null>(null)
  const { close, showReport, reviseReport } = useAssistant.getState()
  if (!report) return null
  return (
    <ReportPane
      report={report}
      versions={reportVersions(turns, report.title)}
      onSelect={showReport}
      onRevise={ready ? reviseReport : undefined}
      busy={streaming}
      width={width ?? saved}
      onWidth={setWidth}
      onWidthCommit={(reportWidth) => void window.scb.invoke('settings:set', { reportWidth })}
      onDragging={setResizing}
      save={(title, format, content) => window.scb.invoke('report:save', title, format, content)}
      onClose={() => showReport(null)}
      onExpand={
        chatId
          ? () => {
              // The new tab gets the whole window, rather than what's left beside these.
              close()
              void window.scb.invoke('ai:open-chat', chatId)
            }
          : undefined
      }
    />
  )
}

function Message({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  const report = useAssistant((s) => s.report)
  const { showReport } = useAssistant.getState()
  if (turn.role === 'user') {
    return <div className="ml-8 self-end rounded-lg bg-surface-hover px-3 py-2 whitespace-pre-wrap select-text [overflow-wrap:anywhere]">{shownMessage(turn.content)}</div>
  }
  return (
    <div className="group/reply flex flex-col gap-1.5 select-text">
      {turn.pageTitle && (
        <div className="flex items-center gap-1 text-xs text-text-faint">
          <FileText aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">
            {contextLabel(turn)}
            {turn.pageTitle}
          </span>
        </div>
      )}
      {turn.steps?.map((step, index) => (
        <div key={index} className="flex items-center gap-1 text-xs text-text-muted">
          <Check aria-hidden size={12} strokeWidth={2} className="shrink-0 text-accent" />
          <span className="truncate">{step}</span>
        </div>
      ))}
      {turn.content && (
        <ReplyContent
          text={turn.content}
          onOpenLink={openLink}
          onOpenReport={showReport}
          openReport={report}
          streaming={streaming}
          sources={turn.sources}
          onOpenSource={openSource}
        />
      )}
      {streaming && !turn.content && <Thinking />}
      {!streaming && turn.content && (
        <div className="-ml-1 flex h-6 opacity-0 transition-opacity group-focus-within/reply:opacity-100 group-hover/reply:opacity-100">
          <CopyReply text={turn.content} />
        </div>
      )}
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
  const { open, status, turns, streamId, includePage, selection, focusRequest, chats, mentions, agentMode, approval, webSearch } = useAssistant()
  const { close, reset, send, stop, setIncludePage, clearSelection, toggleChats, mention, unmention, setAgentMode, answerApproval, setWebSearch } = useAssistant.getState()
  const allTabs = useTabs((s) => s.tabs)
  const [pickerIndex, setPickerIndex] = useState(0)
  const tab = useActiveTab()
  const [draft, setDraft] = useState('')
  const savedWidth = useApp((s) => s.settings.assistantWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? savedWidth
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // The PDF viewer stands in for the document it's showing.
  const pageUrl = tab ? (tab.url.startsWith(PDF_PAGE_URL) ? effectiveUrl(tab.url) : tab.url) : ''
  const host = isHttpUrl(pageUrl) ? new URL(pageUrl).host : null
  const canRead = /^(https?|file):/.test(pageUrl)
  const siteOff = !!host && status.disabledHosts.includes(host)
  const sharing = includePage && canRead && !siteOff

  // Typing / lists skills; @ lists other open tabs to bring into the message.
  const pickerItems = useMemo((): PickerItem[] => {
    if (draft.startsWith('/')) {
      const query = draft.slice(1).toLowerCase()
      return status.skills
        .filter((skill) => skill.name.toLowerCase().includes(query))
        .map((skill) => ({
          id: skill.id,
          label: skill.name,
          run: () => {
            setDraft('')
            send(skill.prompt)
          }
        }))
    }
    const match = MENTION.exec(draft)
    if (!match) return []
    const query = (match[2] ?? '').toLowerCase()
    return allTabs
      .filter((t) => t.id !== tab?.id && !t.isSleeping && !mentions.includes(t.id) && /^(https?|file):/.test(t.url))
      .filter((t) => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
      .map((t) => ({
        id: String(t.id),
        label: t.title || t.url,
        run: () => {
          mention(t.id)
          setDraft(draft.replace(MENTION, '$1'))
        }
      }))
  }, [draft, status.skills, allTabs, tab?.id, mentions, send, mention])
  const pickerSelected = Math.min(pickerIndex, Math.max(0, pickerItems.length - 1))

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
    <aside aria-label="Assistant" className="relative flex shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
      <ResizeHandle
        label="Assistant width"
        edge="left"
        width={width}
        min={MIN_PANEL}
        max={MAX_PANEL}
        onWidth={setDragWidth}
        onCommit={(assistantWidth) => void window.scb.invoke('settings:set', { assistantWidth })}
        onDragging={setResizing}
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {streamId && <div aria-hidden className="sc-generating absolute inset-x-0 top-0 h-0.5" />}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium">Assistant</span>
            {status.model && <span className="ml-2 text-xs text-text-faint">{status.model}</span>}
          </div>
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
            <p className="text-text-muted">
              {status.hostedAvailable
                ? 'Use scTerra AI for free, with daily limits, or connect your own API key or local model.'
                : 'Connect an AI provider with your own API key, or a local model.'}
            </p>
            {status.hostedAvailable && (
              <>
                <Button variant="primary" onClick={() => void window.scb.invoke('ai:enable-hosted')}>
                  Use scTerra AI
                </Button>
                <p className="text-xs text-text-faint">Your messages, and pages you share, go to our server and its AI provider.</p>
              </>
            )}
            <Button
              variant={status.hostedAvailable ? 'secondary' : 'primary'}
              onClick={() => void window.scb.invoke('ai:open-settings')}
            >
              {status.hostedAvailable ? 'Use my own key' : 'Set up AI'}
            </Button>
          </div>
        ) : chats ? (
          <ChatList />
        ) : (
          <>
            <div ref={logRef} role="log" aria-label="Conversation" className="sc-scroll-quiet flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3.5 py-3">
              {turns.length === 0 && (
                <div className="flex flex-1 flex-col justify-end gap-3 pb-2">
                  <h2 className="text-md font-medium">{canRead && !siteOff ? 'What do you want to know about this page?' : 'What can I help with?'}</h2>
                  {canRead && !siteOff && (
                    <div className="flex flex-col items-start gap-1.5">
                      {(tab && summarisePromptFor(tab.url) === VIDEO_SUMMARY_PROMPT ? [{ label: 'Summarise with key moments', prompt: VIDEO_SUMMARY_PROMPT }, ...PAGE_STARTERS.slice(1)] : PAGE_STARTERS).map(({ label, prompt }) => (
                        <Button
                          key={label}
                          onClick={() => {
                            setIncludePage(true)
                            send(prompt)
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {turns.map((turn, index) => (
                <Message key={index} turn={turn} streaming={!!streamId && index === turns.length - 1} />
              ))}
            </div>

            <div className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-2">
              {pickerItems.length > 0 && <ComposerPicker items={pickerItems} selected={pickerSelected} />}
              {mentions.map((id) => {
                const mentioned = allTabs.find((t) => t.id === id)
                if (!mentioned) return null
                return (
                  <div key={id} className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-muted">
                    <AtSign aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{mentioned.title || mentioned.url}</span>
                    <IconButton size="sm" label={`Remove ${mentioned.title}`} onClick={() => unmention(id)}>
                      <X size={12} strokeWidth={2} />
                    </IconButton>
                  </div>
                )
              })}
              {approval && (
                <div role="alertdialog" aria-label="Approve this step" className="flex flex-col gap-2 rounded-md bg-surface-hover p-2.5">
                  <div className="font-medium [overflow-wrap:anywhere]">{approval.text}</div>
                  {approval.reason && <div className="text-xs text-text-muted">{approval.reason}</div>}
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => answerApproval(false)}>Decline</Button>
                    <Button variant="primary" onClick={() => answerApproval(true)}>
                      Allow
                    </Button>
                  </div>
                </div>
              )}
              {selection && (
                <div className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-muted">
                  <Quote aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{selection}</span>
                  <IconButton size="sm" label="Remove selection" onClick={clearSelection}>
                    <X size={12} strokeWidth={2} />
                  </IconButton>
                </div>
              )}
              <div className="flex flex-col rounded-lg border border-border bg-field transition-colors focus-within:border-border-strong focus-within:shadow-[0_0_0_2px_var(--sc-focus-ring)]">
                <textarea
                  ref={inputRef}
                  rows={2}
                  value={draft}
                  aria-label="Message the assistant"
                  placeholder={agentMode ? 'What should it do on this page?' : 'Ask anything, / for skills, @ for tabs'}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setPickerIndex(0)
                  }}
                  onKeyDown={(e) => {
                    if (pickerItems.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                      e.preventDefault()
                      const step = e.key === 'ArrowDown' ? 1 : -1
                      setPickerIndex((pickerSelected + step + pickerItems.length) % pickerItems.length)
                    } else if (pickerItems.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
                      e.preventDefault()
                      pickerItems[pickerSelected]?.run()
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                  className="max-h-40 min-h-13 w-full resize-none bg-transparent px-2.5 pt-2 text-sm text-text outline-none select-text [field-sizing:content] placeholder:text-text-faint"
                />
                <div className="flex items-center gap-1 p-1.5 text-xs">
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
                  {canRead && !siteOff && /^https?:/.test(pageUrl) && (
                    <button
                      type="button"
                      aria-pressed={agentMode}
                      title="Lets the assistant act on this page. You approve every step."
                      onClick={() => setAgentMode(!agentMode)}
                      className={cx(
                        'flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-surface-hover',
                        agentMode ? 'bg-accent-soft text-accent' : 'text-text-faint hover:text-text'
                      )}
                    >
                      <Hand aria-hidden size={12} strokeWidth={1.75} />
                      Act on page
                    </button>
                  )}
                  {!agentMode && (
                    <button
                      type="button"
                      aria-pressed={webSearch}
                      title={webSearch ? 'Searches DuckDuckGo for each message and sends the top results to the model' : 'Search the web for each message'}
                      onClick={() => setWebSearch(!webSearch)}
                      className={cx(
                        'flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-surface-hover',
                        webSearch ? 'bg-accent-soft text-accent' : 'text-text-faint hover:text-text'
                      )}
                    >
                      <Globe aria-hidden size={12} strokeWidth={1.75} />
                      Web
                    </button>
                  )}
                  <div className="ml-auto shrink-0 pl-1">
                    {streamId ? (
                      <IconButton size="sm" label="Stop" onClick={stop}>
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
              {host && (
                <button
                  type="button"
                  onClick={() => void window.scb.invoke('ai:set-site', host, !siteOff)}
                  className="self-end rounded-sm px-1 text-2xs text-text-faint transition-colors hover:text-text"
                >
                  {siteOff ? 'Allow AI on this site' : 'Off for this site'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
