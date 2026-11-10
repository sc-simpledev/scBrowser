import { ArrowUp, Code2, Globe, Layers, LayoutTemplate, MessageSquare, PanelLeft, Plus, Settings, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { CONTINUE_PROMPT, REPAIR_PROMPT, settleReply, splitReply, stitchReply, presetById, reportMarkdown, templateFrom, replaceReport, repliesReports, type ReportThemeId, rememberCommand, MAX_MENTIONED_TABS, conversationFiles, isCodeChat, presetPrompt, REPORT_PRESETS, reportVersions, reviseFilePrompt, reviseReportPrompt, shownMessage, type AiStatus, type AssistantEvent, type ChatSummary, type FileVersion, type Report, type ReportPreset, type SavedTurn } from '@scbrowser/shared'
import { CopyReply, latestReport, ReplyContent, RetryReply, Thinking, type OpenSource } from '../../shared/ReplyContent'
import { CUT_OFF, STOP_NOTES } from '../../shared/stopNotes'
import { ReportPane, type QuizMemory, type SaveReport } from '../../shared/ReportPane'
import { CodePane, type PreviewFile, type SaveFile } from '../../shared/CodePane'
import { PresetChip, PresetGallery } from '../../shared/PresetGallery'
import { PickedTabs, TabPicker, type PickableTab } from '../../shared/TabPicker'
import { newestFile } from '../../state/files'
import { api } from '../api'
import { CodeWorkspace } from '../code/CodeWorkspace'
import { AiNetworkHelp } from '../../shared/AiNetworkHelp'
import { pasteCleanly } from '../../shared/pasteCleanly'

interface Turn extends SavedTurn {
  error?: string
  network?: boolean
  /** Why the reply ended early, in words. */
  note?: string
}

const toSave = (turns: Turn[]) => turns.filter((t) => t.content && !t.error).map(({ role, content, sources }) => ({ role, content, ...(sources ? { sources } : {}) }))

type View = 'chat' | 'code'

/** `/code fix the failing test` in the chat box hands the task to Terra Code. */
export function codeCommand(text: string): string | null {
  const match = /^\/code(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return match ? (match[1] ?? '').trim() : null
}

function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const option = (id: View, label: string, Icon: typeof MessageSquare) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => onChange(id)}
      className={cx('flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs transition-colors', view === id ? 'bg-surface text-text shadow-1' : 'text-text-muted hover:text-text')}
    >
      <Icon aria-hidden size={12} strokeWidth={1.75} />
      {label}
    </button>
  )
  return (
    <div role="tablist" aria-label="Assistant mode" className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg p-0.5">
      {option('chat', 'Chat', MessageSquare)}
      {option('code', 'Code', SquareTerminal)}
    </div>
  )
}

const openLink = (href: string) => void api().invoke('browser:open', href)
const loadTabs = () => api().invoke('tabs:research-list')
const openSource: OpenSource = (source, target) => void api().invoke('ai:open-source', { tabId: source.tabId, url: source.url }, target)

const saveReport: SaveReport = (title, format, content) => api().invoke('report:save', title, format, content)
const quizMemory: QuizMemory = {
  load: (keys) => api().invoke('quiz:progress', keys),
  record: (key, knew) => api().invoke('quiz:record', key, knew)
}
const loadHighlights = () => api().invoke('highlights:list').then((list) => list.map(({ text, title, url }) => ({ text, title, url })))
const loadNotes = (report: Report) => api().invoke('report:notes', JSON.stringify(report))
const askReport = (report: Report) => (question: string) => api().invoke('ai:ask-report', reportMarkdown(report), question)
const previewFile: PreviewFile = (name, content) => api().invoke('files:preview', name, content)
const saveFile: SaveFile = (name, content) => api().invoke('files:save', name, content)

/** Below this, a report and the chat list don't both leave room for the conversation. */
const ROOM_FOR_ALL = 1180
/** There's more room here than beside a page, so a report starts out wider. */
const REPORT_START_WIDTH = 640

const dayLabel = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Saved conversations and Terra Code sessions together, newest first. */
function ChatList({ chats, current, onDelete, newHref = 'sc://assistant/' }: { chats: ChatSummary[]; current: string | null; onDelete: (id: string) => void; newHref?: string }) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-2 border-r border-border p-3">
    <nav aria-label="Saved chats" className="flex min-h-0 flex-1 flex-col gap-2">
      <Button onClick={() => (location.href = newHref)}>
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
                title={isCodeChat(chat.id) ? `Terra Code: ${chat.title}` : chat.title}
                className={cx('flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 pr-8', chat.id === current ? 'font-medium text-text' : 'text-text-muted')}
              >
                {isCodeChat(chat.id) && <SquareTerminal aria-label="Terra Code" size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
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
  const [turns, setTurnsState] = useState<Turn[]>([])
  // Events arrive faster than renders, so the conversation is kept here and the state follows it.
  const turnsRef = useRef<Turn[]>([])
  const setTurns = useCallback((next: Turn[]) => {
    turnsRef.current = next
    setTurnsState(next)
  }, [])
  const [draft, setDraft] = useState('')
  const [streamId, setStreamId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [report, setReport] = useState<Report | null>(null)
  // A report being written shows beside the conversation as it arrives, unless it's been closed.
  const [draftHidden, setDraftHidden] = useState(false)
  const [file, setFile] = useState<FileVersion | null>(null)
  const [preset, setPreset] = useState<ReportPreset | null>(() => presetById(new URLSearchParams(location.search).get('preset') ?? '') ?? null)
  const [gallery, setGallery] = useState(false)
  const [listOpen, setListOpen] = useState(true)
  const [reportWidth, setReportWidth] = useState(REPORT_START_WIDTH)
  const [designs, setDesigns] = useState<Record<string, ReportThemeId>>({})
  const [customPresets, setCustomPresets] = useState<ReportPreset[]>([])
  useEffect(() => {
    void api()
      .invoke('presets:list')
      .then((list) => {
        setCustomPresets(list)
        // A saved template can be asked for in the address too.
        const wanted = new URLSearchParams(location.search).get('preset')
        const found = list.find((preset) => preset.id === wanted)
        if (found) setPreset(found)
      })
  }, [])
  useEffect(() => {
    void api().invoke('settings:get').then((settings) => setReportWidth(Math.max(REPORT_START_WIDTH, settings.reportWidth)))
  }, [])
  const opened = new URLSearchParams(location.search).get('chat')
  const openedCode = opened !== null && isCodeChat(opened) ? opened : null
  const chatId = useRef<string | null>(openedCode ? null : opened)
  const [codeChat] = useState(openedCode)
  const [codeId, setCodeId] = useState(openedCode)
  const codeIdRef = useRef(openedCode)
  const [view, setViewState] = useState<View>(openedCode || new URLSearchParams(location.search).get('mode') === 'code' ? 'code' : 'chat')
  // Only made once it's first shown, then kept, so going to Chat and back doesn't lose a run in progress.
  const [codeOpened, setCodeOpened] = useState(view === 'code')
  const [codeTask, setCodeTask] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const takeCodeTask = useCallback(() => setCodeTask(null), [])
  const setView = useCallback((next: View) => {
    setViewState(next)
    if (next === 'code') setCodeOpened(true)
    const url = new URL(location.href)
    if (next === 'code') url.searchParams.set('mode', 'code')
    else url.searchParams.delete('mode')
    const shown = next === 'code' ? codeIdRef.current : chatId.current
    if (shown) url.searchParams.set('chat', shown)
    else url.searchParams.delete('chat')
    history.replaceState(null, '', url)
    document.title = next === 'code' ? 'Terra Code' : 'Assistant'
  }, [])
  // Tabs picked for research stay picked for follow-up questions, until they're taken off.
  // The tab menu's "Make a report from these tabs" opens this page with them already picked.
  const [research, setResearch] = useState<number[]>(() =>
    (new URLSearchParams(location.search).get('tabs') ?? '').split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_MENTIONED_TABS)
  )
  const [researchTabs, setResearchTabs] = useState<PickableTab[]>([])
  const [picking, setPicking] = useState(false)
  const researchRef = useRef<number[]>([])
  const [webSearch, setWebSearchState] = useState(false)
  const webSearchRef = useRef(false)
  const setWebSearch = (on: boolean) => {
    webSearchRef.current = on
    setWebSearchState(on)
  }
  useEffect(() => {
    researchRef.current = research
    void loadTabs().then((open) => {
      setResearchTabs(research.flatMap((id) => open.filter((tab) => tab.id === id)))
      // A tab closed since it was picked can't be read any more.
      if (open.filter((tab) => research.includes(tab.id)).length !== research.length) setResearch(research.filter((id) => open.some((tab) => tab.id === id)))
    })
  }, [research])
  const logRef = useRef<HTMLDivElement>(null)

  const send = useCallback((text: string) => {
    const question = text.trim()
    if (!question) return
    const id = crypto.randomUUID()
    chatId.current ??= crypto.randomUUID()
    setStreamId(id)
    setDraftHidden(false)
    const history = [...turnsRef.current.filter((t) => t.content && !t.error), { role: 'user' as const, content: question }]
    setTurns([...history, { role: 'assistant', content: '' }])
    void api().invoke('ai:send', id, {
      messages: history.map(({ role, content }) => ({ role, content })),
      tabId: null,
      includePage: false,
      extraTabIds: researchRef.current,
      selection: null,
      webSearch: webSearchRef.current
    })
  }, [setTurns])

  const showReport = useCallback((next: Report | null) => {
    setReport(next)
    if (next) setFile(null)
    if (next && innerWidth < ROOM_FOR_ALL) setListOpen(false)
  }, [])
  const showFile = useCallback((next: FileVersion | null) => {
    setFile(next)
    if (next) setReport(null)
    if (next && innerWidth < ROOM_FOR_ALL) setListOpen(false)
  }, [])
  // While a cut-off reply is being continued, the two halves already read as one.
  const thread = useMemo(() => {
    const [earlier, asked, last] = turns.slice(-3)
    if (!streamId || !earlier || !last || earlier.role !== 'assistant' || asked?.content !== CONTINUE_PROMPT) return turns
    return [...turns.slice(0, -3), { ...earlier, note: undefined, content: stitchReply(earlier.content, last.content) }]
  }, [turns, streamId])
  const reportDraft = useMemo(() => (streamId && thread.at(-1)?.role === 'assistant' ? (splitReply(thread.at(-1)!.content, false).draft ?? null) : null), [thread, streamId])
  const drafting = reportDraft !== null && !draftHidden
  useEffect(() => {
    if (drafting && innerWidth < ROOM_FOR_ALL) setListOpen(false)
  }, [drafting])
  // Files only count once their reply has finished.
  const { files, changes } = useMemo(() => conversationFiles(streamId ? thread.slice(0, -1) : thread), [thread, streamId])

  const refreshChats = useCallback(() => void api().invoke('chats:list').then(setChats), [])
  useEffect(refreshChats, [refreshChats])

  // The chat Terra Code is showing, kept in the address so a reload comes back to it.
  const onCodeChat = useCallback((id: string | null) => {
    codeIdRef.current = id
    setCodeId(id)
    if (new URLSearchParams(location.search).get('mode') === 'code' || id === null) {
      const url = new URL(location.href)
      if (id) url.searchParams.set('chat', id)
      else url.searchParams.delete('chat')
      history.replaceState(null, '', url)
    }
    if (id) refreshChats()
  }, [refreshChats])

  const deleteChat = (id: string) => {
    if (isCodeChat(id)) void api().invoke('coder:reset', id)
    void api().invoke('chats:delete', id).then(refreshChats)
    if (id === chatId.current) location.href = 'sc://assistant/'
    if (id === codeIdRef.current) location.href = 'sc://assistant/?mode=code'
  }

  useEffect(() => {
    const onEvent = (event: AssistantEvent) => {
      const update = (patch: (last: Turn) => Turn) => {
        const last = turnsRef.current.at(-1)
        if (last) setTurns([...turnsRef.current.slice(0, -1), patch(last)])
      }
      if (event.type === 'text') update((last) => ({ ...last, content: last.content + event.text }))
      if (event.type === 'context') update((last) => ({ ...last, pageTitle: event.title, truncated: event.truncated, source: event.source, ...(event.sources ? { sources: event.sources } : {}) }))
      if (event.type === 'error') {
        update((last) => ({ ...last, error: event.message, network: !!event.network }))
        setStreamId(null)
      }
      if (event.type === 'done') {
        setStreamId(null)
        // A continued reply joins the one it carried on, and a report asked for again replaces the unreadable one.
        const settled = settleReply(turnsRef.current)
        const note = event.stopReason ? STOP_NOTES[event.stopReason] : undefined
        setTurns(settled.turns.map((turn, index) => (index === settled.turns.length - 1 ? { ...turn, note } : turn)))
        const current = turnsRef.current
        // One more try, by itself, for a report that came back unreadable.
        if (settled.repair && !note) {
          send(REPAIR_PROMPT)
          return
        }
        const saved = toSave(current)
        if (chatId.current && saved.length > 0) void api().invoke('chats:save', chatId.current, saved).then(refreshChats)
        const written = latestReport(current.slice(-1))
        const made = newestFile(current)
        if (made.file) showFile(made.file)
        else if (written) showReport(written)
      }
    }
    return api().onAssistantEvent(onEvent)
  }, [refreshChats, showReport, showFile, setTurns, send])

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
          void api().invoke('chats:designs', chatId.current).then((saved) => !cancelled && setDesigns(saved))
          if (chat && !cancelled) {
            setTurns(chat.turns)
            const newest = conversationFiles(chat.turns).files
            const lastFile = [...newest.values()].map((versions) => versions.at(-1)!).sort((a, b) => a.turn - b.turn).at(-1)
            const lastReport = latestReport(chat.turns)
            if (lastFile && !lastReport) showFile(lastFile)
            else showReport(lastReport)
          }
          return
        }
        const prompt = await api().invoke('ai:take-prompt')
        if (prompt && next.ready && !cancelled) send(prompt)
      })
    return () => {
      cancelled = true
    }
  }, [send, showReport, showFile, setTurns])

  useLayoutEffect(() => {
    const log = logRef.current
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight
  }, [turns])

  // The reply that wrote the open report: its sources are the report's, and edits are made in it.
  const reportTurn = report ? thread.findIndex((turn) => turn.role === 'assistant' && repliesReports(turn.content).some((found) => JSON.stringify(found) === JSON.stringify(report))) : -1
  const editReport = (next: Report) => {
    if (!report || reportTurn === -1 || streamId) return
    const content = replaceReport(turns[reportTurn]!.content, report, next)
    if (content === null) return
    const updated = turns.map((turn, index) => (index === reportTurn ? { ...turn, content } : turn))
    setTurns(updated)
    setReport(next)
    if (next.title !== report.title && designs[report.title]) setDesigns({ ...designs, [next.title]: designs[report.title]! })
    if (chatId.current) void api().invoke('chats:save', chatId.current, toSave(updated)).then(refreshChats)
  }
  const pickDesign = (theme: ReportThemeId) => {
    if (!report) return
    setDesigns({ ...designs, [report.title]: theme })
    chatId.current ??= crypto.randomUUID()
    void api().invoke('chats:set-design', chatId.current, report.title, theme)
  }

  const retry = () => {
    if (streamId) return
    const lastUser = turns.findLastIndex((turn) => turn.role === 'user')
    if (lastUser === -1) return
    const text = turns[lastUser]!.content
    setTurns(turns.slice(0, lastUser))
    send(text)
  }

  const submit = () => {
    if (streamId || !draft.trim()) return
    setNotice(null)
    const note = rememberCommand(draft)
    if (note !== null) {
      setDraft('')
      void api().invoke('memory:add', note).then((saved) => setNotice(saved ? 'Remembered. You can see and edit notes in AI settings.' : 'Your notes are full. Remove some in AI settings.'))
      return
    }
    const task = codeCommand(draft)
    if (task !== null) {
      setDraft('')
      setCodeTask(task || null)
      setView('code')
      return
    }
    send(preset ? presetPrompt(preset, draft, false) : draft)
    setPreset(null)
    setDraft('')
  }

  const empty = turns.length === 0
  // Saved chats can still be read with no AI set up.
  if (view === 'chat' && !codeOpened && status && !status.ready && turns.length === 0) {
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

  const composer = (
    <div className="relative mx-auto flex w-full max-w-180 shrink-0 flex-col gap-2 px-8 pb-6" hidden={!status?.ready}>
      {gallery && (
        // Over the conversation rather than taking its room, once there is one.
        <div className={empty ? '' : 'absolute inset-x-8 bottom-full z-20 pb-2'}>
        <PresetGallery
          wide
          custom={customPresets}
          onDelete={(id) => void api().invoke('presets:delete', id).then(setCustomPresets)}
          onClose={() => setGallery(false)}
          onPick={(picked) => {
            setPreset(picked)
            setGallery(false)
          }}
        />
        </div>
      )}
      {picking && <TabPicker load={loadTabs} picked={research} onChange={setResearch} onClose={() => setPicking(false)} />}
      {notice && <p role="status" className="px-1 pb-1 text-xs text-text-muted">{notice}</p>}
      {preset && <PresetChip preset={preset} onRemove={() => setPreset(null)} />}
      <PickedTabs tabs={researchTabs} onRemove={(id) => setResearch(research.filter((other) => other !== id))} />
      <div className="flex flex-col rounded-lg border border-border bg-field transition-colors focus-within:border-border-strong focus-within:shadow-[0_0_0_2px_var(--sc-focus-ring)]">
        <textarea
          autoFocus
          rows={2}
          value={draft}
          aria-label="Message the assistant"
          placeholder={preset ? `What should the ${preset.name.toLowerCase()} be about?` : 'Ask anything, or type /code to work on a project folder'}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={pasteCleanly}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-60 min-h-14 w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-text outline-none [field-sizing:content] placeholder:text-text-faint"
        />
        <div className="flex items-center justify-between gap-2 p-2">
          <button
            type="button"
            aria-pressed={gallery || !!preset}
            onClick={() => setGallery(!gallery)}
            className={cx('flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors hover:bg-surface-hover', gallery || preset ? 'bg-accent-soft text-accent' : 'text-text-faint hover:text-text')}
          >
            <LayoutTemplate aria-hidden size={12} strokeWidth={1.75} />
            Report
          </button>
          <button
            type="button"
            aria-pressed={picking || research.length > 0}
            onClick={() => {
              setPicking(!picking)
              setGallery(false)
            }}
            className={cx('flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors hover:bg-surface-hover', picking || research.length > 0 ? 'bg-accent-soft text-accent' : 'text-text-faint hover:text-text')}
          >
            <Layers aria-hidden size={12} strokeWidth={1.75} />
            {research.length > 0 ? `${research.length} ${research.length === 1 ? 'tab' : 'tabs'}` : 'Tabs'}
          </button>
          <button
            type="button"
            aria-pressed={webSearch}
            title={webSearch ? 'Searches DuckDuckGo for each message and sends the top results to the model' : 'Search the web for each message'}
            onClick={() => setWebSearch(!webSearch)}
            className={cx('flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors hover:bg-surface-hover', webSearch ? 'bg-accent-soft text-accent' : 'text-text-faint hover:text-text')}
          >
            <Globe aria-hidden size={12} strokeWidth={1.75} />
            Web
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-text-faint">{status?.model}</span>
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
      {listOpen && <ChatList chats={chats} current={view === 'code' ? codeId : chatId.current} onDelete={deleteChat} newHref={view === 'code' ? 'sc://assistant/?mode=code' : 'sc://assistant/'} />}
      {codeOpened && (
        <div className={cx('min-w-72 flex-1 flex-col', view === 'code' ? 'flex' : 'hidden')}>
          <CodeWorkspace
            chat={codeChat}
            onChat={onCodeChat}
            initialTask={codeTask}
            onInitialTaskTaken={takeCodeTask}
            leading={
              <>
                <IconButton size="sm" label={listOpen ? 'Hide chats' : 'Show chats'} aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}>
                  <PanelLeft size={15} strokeWidth={1.75} />
                </IconButton>
                <ViewSwitch view={view} onChange={setView} />
              </>
            }
          />
        </div>
      )}
      {view === 'chat' && <>
      <div className="relative flex min-w-72 flex-1 flex-col">
        {/* A bar of its own, so the conversation scrolls under nothing. */}
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <IconButton size="sm" label={listOpen ? 'Hide chats' : 'Show chats'} side="right" aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}>
            <PanelLeft size={15} strokeWidth={1.75} />
          </IconButton>
          <ViewSwitch view={view} onChange={setView} />
        </div>
        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center pb-28">
            <h1 className="mx-auto w-full max-w-180 px-8 pb-5 text-xl font-semibold tracking-[-0.03em]">What can I help with?</h1>
            {composer}
            {status?.ready && !gallery && (
              <div className="mx-auto flex w-full max-w-180 flex-wrap gap-2 px-8 [&>button]:whitespace-nowrap">
                <Button onClick={() => setGallery(true)}>
                  <LayoutTemplate aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
                  Make a report
                </Button>
                <Button
                  onClick={() => {
                    setPreset(REPORT_PRESETS.find((candidate) => candidate.id === 'brief') ?? null)
                    setPicking(true)
                  }}
                >
                  <Layers aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
                  Research my tabs
                </Button>
                <Button onClick={() => setDraft('Make a web page that ')}>
                  <Code2 aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
                  Build something
                </Button>
                <Button onClick={() => setView('code')}>
                  <SquareTerminal aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
                  Code in a folder
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div ref={logRef} role="log" aria-label="Conversation" className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-180 flex-col gap-7 px-8 pt-4 pb-10">
                {thread.map((turn, index) => {
                  const newest = index === thread.length - 1
                  const streaming = streamId !== null && newest
                  return turn.role === 'user' ? (
                    <div key={index} className="ml-16 self-end rounded-lg bg-surface-hover px-3.5 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {shownMessage(turn.content)}
                    </div>
                  ) : (
                    <div key={index} className="group/reply flex flex-col gap-1.5">
                      {turn.content && (
                        <ReplyContent
                          text={turn.content}
                          onOpenLink={openLink}
                          onOpenReport={showReport}
                          openReport={report}
                          streaming={streaming}
                          fileChanges={changes.get(index)}
                          onOpenFile={(change) => change.version && showFile(change.version)}
                          openFile={file}
                          sources={turn.sources}
                          onOpenSource={openSource}
                          onRetry={newest && status?.ready ? retry : undefined}
                        />
                      )}
                      {!turn.content && !turn.error && (streaming ? <Thinking /> : <p className="text-text-faint">{turn.note ?? 'No reply came back.'}</p>)}
                      {turn.error &&
                        (turn.network ? (
                          <AiNetworkHelp
                            message={turn.error}
                            loadHasVpn={loadHasVpn}
                            useVpn={() => api().invoke('vpn:use-default')}
                            onRetry={retry}
                            onOpenVpn={() => void api().invoke('browser:open', 'sc://vpn/')}
                          />
                        ) : (
                          <p role="alert" className="text-danger">
                            {turn.error}
                          </p>
                        ))}
                      {turn.content && turn.note && (
                        <p className="flex items-center gap-2 text-xs text-text-muted">
                          {turn.note}
                          {turn.note === CUT_OFF && newest && !streaming && status?.ready && (
                            <Button className="h-6 px-2 text-xs" onClick={() => send(CONTINUE_PROMPT)}>
                              Continue
                            </Button>
                          )}
                        </p>
                      )}
                      {!streaming && turn.content && (
                        <div className="-ml-1 flex h-6 opacity-0 transition-opacity group-focus-within/reply:opacity-100 group-hover/reply:opacity-100">
                          <CopyReply text={turn.content} />
                          {newest && status?.ready && !turn.error && <RetryReply onRetry={retry} />}
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
      {drafting && reportDraft && (
        <ReportPane report={reportDraft} versions={[]} onSelect={() => undefined} busy save={saveReport} onClose={() => setDraftHidden(true)} width={reportWidth} onWidth={setReportWidth} onWidthCommit={(next) => void api().invoke('settings:set', { reportWidth: next })} />
      )}
      {report && !drafting && (
        <ReportPane
          report={report}
          versions={reportVersions(thread, report.title)}
          onSelect={setReport}
          onRevise={status?.ready ? (change) => send(reviseReportPrompt(report.title, change)) : undefined}
          busy={streamId !== null}
          save={saveReport}
          onClose={() => setReport(null)}
          sources={reportTurn === -1 ? undefined : thread[reportTurn]!.sources}
          onOpenSource={openSource}
          onEdit={reportTurn === -1 ? undefined : editReport}
          design={designs[report.title] ?? null}
          onDesign={pickDesign}
          onAsk={status?.ready ? askReport(report) : undefined}
          quizMemory={quizMemory}
          loadHighlights={loadHighlights}
          speakerNotes={!!status?.ready}
          loadNotes={status?.ready ? loadNotes : undefined}
          onSaveTemplate={(name) =>
            api()
              .invoke('presets:save', templateFrom(report, name))
              .then((list) => {
                setCustomPresets(list)
                return `Saved “${name}” to Make a report`
              })
          }
          width={reportWidth}
          onWidth={setReportWidth}
          onWidthCommit={(next) => void api().invoke('settings:set', { reportWidth: next })}
        />
      )}
      {file && !drafting && (
        <CodePane
          files={files}
          file={file}
          onSelect={setFile}
          onRevise={status?.ready ? (change) => send(reviseFilePrompt(file.name, file.content, change)) : undefined}
          busy={streamId !== null}
          preview={previewFile}
          save={saveFile}
          keep={(name, content) => api().invoke('mini-apps:keep', name, content)}
          onClose={() => setFile(null)}
          width={reportWidth}
          onWidth={setReportWidth}
          onWidthCommit={(next) => void api().invoke('settings:set', { reportWidth: next })}
        />
      )}
      </>}
    </div>
  )
}

const loadHasVpn = () => api().invoke('vpn:state').then((state) => state.connections.length > 0)
