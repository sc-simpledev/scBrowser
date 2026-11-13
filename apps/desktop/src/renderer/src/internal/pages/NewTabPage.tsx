import { ArrowDown, ArrowUp, Check, Pause, Play, Columns2, Command, Globe, History, LayoutGrid, MessageCircle, Newspaper, Plus, Search, Settings2, Square, Star, Volume2, X, type LucideIcon } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Select, Switch } from '@scbrowser/ui'
import {
  DEFAULT_NEW_TAB,
  isDarkColor,
  MAX_NEW_TAB_LINKS,
  MAX_NOTES_LENGTH,
  NEW_TAB_WIDGETS,
  type AiStatus,
  type AssistantEvent,
  type Bookmark,
  briefPreview,
  speechText,
  stopwatch,
  WIDGET_TIME_LABELS,
  WIDGET_TIMES,
  widgetShownAt,
  type WidgetTime,
  type StudyState,
  GETTING_STARTED,
  type GettingStartedId,
  type OnboardingState,
  type BriefIssue,
  type PrivacyWeek,
  type DownloadInfo,
  type PageWatch,
  type ReadingItem,
  type NewTabConfig,
  type NewTabLink,
  type NewTabWidgetId,
  type Settings,
  type Suggestion,
  type SuggestionKind
} from '@scbrowser/shared'
import { ReplyContent } from '../../shared/ReplyContent'
import { useSpeak } from '../../shared/speak'
import { api, applyPerformance, applyTint } from '../api'
import { ColorPicker } from '../ColorPicker'

const NOTES_SAVE_DELAY_MS = 500
const MAX_SHORTCUTS = 8

const openHere = (input: string) => void api().invoke('newtab:go', input)
const openNewTab = (url: string) => void api().invoke('browser:open', url)

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)

type Update = (patch: Partial<NewTabConfig>) => void

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="sc-glass flex flex-col gap-2 rounded-lg p-3.5 text-text shadow-1">
      {title && <h2 className="text-xs font-medium text-text-muted">{title}</h2>}
      {children}
    </section>
  )
}

function useNow(everySecond: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everySecond ? 1000 : 10_000)
    return () => clearInterval(timer)
  }, [everySecond])
  return now
}

function ClockWidget({ config }: { config: NewTabConfig }) {
  const now = useNow(config.clockSeconds)
  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: config.clockSeconds ? '2-digit' : undefined,
    hour12: !config.clock24
  })
  return (
    <div role="timer" aria-label="Clock" className="sc-newtab-text flex flex-col items-center gap-1 text-center">
      <div className="font-medium tabular-nums" style={{ fontSize: 'calc(var(--sc-text-xl) * 1.75)', lineHeight: 1.1, letterSpacing: '-0.035em' }}>
        {time}
      </div>
      <div className="opacity-75">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  )
}

function GreetingWidget({ name }: { name: string }) {
  const hour = useNow(false).getHours()
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return <h1 className="sc-newtab-text text-center text-lg font-medium tracking-[-0.02em]">{name ? `${greeting}, ${name}` : greeting}</h1>
}

const SUGGEST_DELAY_MS = 120
const SUGGESTION_ICONS: Partial<Record<SuggestionKind, LucideIcon>> = { bookmark: Star, history: History, navigate: Globe }

function SearchWidget() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected] = useState(-1)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const input = query.trim()
    if (!input) return setSuggestions([])
    let stale = false
    const timer = setTimeout(() => {
      void api()
        .invoke('newtab:suggest', input)
        .then((rows) => {
          if (stale) return
          setSuggestions(rows)
          setSelected(-1)
        })
    }, SUGGEST_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  const pick = (row: Suggestion) => {
    if (row.action.type === 'navigate') openHere(row.action.url)
  }
  const showing = open && suggestions.length > 0

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        const row = suggestions[selected]
        if (showing && row) pick(row)
        else if (query.trim()) openHere(query.trim())
      }}
    >
      <div className="flex h-11 items-center gap-2.5 rounded-lg bg-surface px-3.5 text-text shadow-1 focus-within:shadow-[0_0_0_1px_var(--sc-accent)]">
        <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <input
          role="combobox"
          aria-expanded={showing}
          aria-controls="newtab-suggestions"
          aria-autocomplete="list"
          aria-label="Search or enter an address"
          placeholder="Search or enter an address"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-faint"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (!showing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
            e.preventDefault()
            const count = suggestions.length
            setSelected((current) => (e.key === 'ArrowDown' ? (current + 1) % count : (current - 1 + count) % count))
          }}
        />
      </div>
      {showing && (
        <ul id="newtab-suggestions" role="listbox" aria-label="Suggestions" className="sc-glass-strong absolute inset-x-0 top-full z-20 mt-1 rounded-lg p-1 text-text shadow-3">
          {suggestions.map((row, index) => {
            const Icon = SUGGESTION_ICONS[row.kind] ?? Search
            return (
              <li
                key={row.id}
                role="option"
                aria-selected={index === selected}
                // On mouse down, because by click time the box has lost focus and closed the list.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(row)
                }}
                className={cx('flex h-9 items-center gap-3 rounded-md px-2.5', index === selected ? 'bg-accent-soft' : 'hover:bg-surface-hover')}
              >
                <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                <span className="min-w-0 shrink truncate">{row.title}</span>
                {row.detail && <span className="min-w-0 flex-1 truncate text-xs text-text-faint">{row.detail}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </form>
  )
}

function QuickAiWidget({ keepChats }: { keepChats: boolean }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [streamId, setStreamId] = useState<string | null>(null)
  const current = useRef<string | null>(null)

  useEffect(() => {
    void api().invoke('ai:status').then(setStatus)
    return window.scbInternal.onAssistantEvent((event: AssistantEvent) => {
      if (event.streamId !== current.current) return
      if (event.type === 'text') setAnswer((text) => text + event.text)
      if (event.type === 'error') setError(event.message)
      if (event.type === 'error' || event.type === 'done') {
        current.current = null
        setStreamId(null)
      }
    })
  }, [])

  const ask = () => {
    const text = question.trim()
    if (!text || streamId) return
    const id = crypto.randomUUID()
    current.current = id
    setStreamId(id)
    setAsked(text)
    setAnswer('')
    setError(null)
    setQuestion('')
    void api().invoke('ai:send', id, {
      messages: [{ role: 'user', content: text }],
      tabId: null,
      includePage: false,
      extraTabIds: [],
      selection: null
    })
  }

  const continueInAssistant = () => {
    const chat = crypto.randomUUID()
    const turns = [
      { role: 'user' as const, content: asked },
      { role: 'assistant' as const, content: answer }
    ]
    void api()
      .invoke('chats:save', chat, turns)
      .then(() => openHere(`sc://assistant/?chat=${chat}`))
  }

  if (status && !status.ready) {
    return (
      <Card title="Quick AI">
        <div className="flex items-center justify-between gap-3">
          <p className="text-text-muted">Choose an AI provider to ask questions here.</p>
          <Button onClick={() => openHere('sc://ai')}>Set up</Button>
        </div>
      </Card>
    )
  }

  return (
    <Card title="Quick AI">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask()
        }}
      >
        <Input
          aria-label="Ask a quick question"
          placeholder="Ask anything"
          className="min-w-0 flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {streamId ? (
          <IconButton
            label="Stop"
            onClick={() => {
              void api().invoke('ai:cancel', streamId)
              current.current = null
              setStreamId(null)
            }}
          >
            <Square size={14} strokeWidth={1.75} />
          </IconButton>
        ) : (
          <Button type="submit" disabled={!question.trim()}>
            Ask
          </Button>
        )}
      </form>
      {streamId && !answer && <p className="text-text-faint">Thinking…</p>}
      {answer && (
        <div className="max-h-80 overflow-y-auto">
          <ReplyContent text={answer} onOpenLink={openNewTab} streaming={streamId !== null} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {answer && !streamId && keepChats && (
        <div>
          <Button variant="ghost" onClick={continueInAssistant}>
            Continue in Assistant
          </Button>
        </div>
      )}
    </Card>
  )
}

function SiteTile({ link }: { link: NewTabLink }) {
  const label = link.title || hostOf(link.url)
  return (
    <a
      href={link.url}
      title={link.url}
      className="group/site flex min-w-0 flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-surface-hover"
      onClick={(e) => {
        e.preventDefault()
        openHere(link.url)
      }}
    >
      {/* A letter rather than a favicon, so that opening a new tab contacts no website. */}
      <span aria-hidden className="grid size-9 place-items-center rounded-md bg-surface-active font-medium text-text-muted uppercase">
        {hostOf(link.url).charAt(0)}
      </span>
      <span className="w-full truncate text-center text-xs text-text-muted">{label}</span>
    </a>
  )
}

function ShortcutsWidget({ config }: { config: NewTabConfig }) {
  const [frequent, setFrequent] = useState<NewTabLink[]>([])
  useEffect(() => {
    if (!config.topSites) return setFrequent([])
    void api()
      .invoke('newtab:top-sites', MAX_SHORTCUTS)
      .then((sites) => setFrequent(sites.map(({ title, url }) => ({ title, url }))))
  }, [config.topSites])

  const chosen = new Set(config.links.map((link) => link.url))
  const links = [...config.links, ...frequent.filter((link) => !chosen.has(link.url))].slice(0, Math.max(MAX_SHORTCUTS, config.links.length))
  // Nothing to show on a new profile, so no empty card either.
  if (links.length === 0) return null
  return (
    <Card title="Shortcuts">
      <div className="grid grid-cols-4 gap-1">
        {links.map((link) => (
          <SiteTile key={link.url} link={link} />
        ))}
      </div>
    </Card>
  )
}

function BookmarksWidget() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  useEffect(() => {
    void api().invoke('bookmarks:list').then(setBookmarks)
  }, [])
  return (
    <Card title="Bookmarks">
      {bookmarks.length === 0 && <p className="text-text-muted">Nothing bookmarked yet.</p>}
      <div className="flex max-h-60 flex-col overflow-y-auto">
        {bookmarks.slice(0, 50).map((bookmark) => (
          <a
            key={bookmark.id}
            href={bookmark.url}
            title={bookmark.url}
            className="truncate rounded-md px-2 py-1 transition-colors hover:bg-surface-hover"
            onClick={(e) => {
              e.preventDefault()
              openHere(bookmark.url)
            }}
          >
            {bookmark.title || hostOf(bookmark.url)}
          </a>
        ))}
      </div>
    </Card>
  )
}

/** A short list in a card, the same for every list widget: a line of text, a quieter line under it, and what to do when it's empty. */
function ListCard({ title, empty, more, children }: { title: string; empty: string | null; more: { label: string; page: string }; children: ReactNode }) {
  return (
    <Card title={title}>
      {empty ? <p className="text-text-muted">{empty}</p> : <div className="-mx-2 flex flex-col">{children}</div>}
      <button type="button" className="self-start text-xs text-text-muted transition-colors hover:text-text" onClick={() => openNewTab(more.page)}>
        {more.label}
      </button>
    </Card>
  )
}

function ListItem({ title, detail, onOpen }: { title: string; detail: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-col rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-hover">
      <span className="truncate">{title}</span>
      <span className="truncate text-xs text-text-faint">{detail}</span>
    </button>
  )
}

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function DownloadsWidget() {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  useEffect(() => void api().invoke('downloads:list').then((all) => setDownloads(all.toSorted((a, b) => b.startedAt - a.startedAt).slice(0, 4))), [])
  return (
    <ListCard title="Recent downloads" empty={downloads.length === 0 ? 'Nothing downloaded yet.' : null} more={{ label: 'All downloads', page: 'sc://downloads' }}>
      {downloads.map((download) => (
        <ListItem
          key={download.id}
          title={download.filename}
          detail={download.state === 'completed' ? `${hostOf(download.url)} · ${ago(download.startedAt)}` : ({ progressing: 'Downloading…', paused: 'Paused', cancelled: 'Cancelled', interrupted: "Didn't finish" } as const)[download.state]}
          onOpen={() => void api().invoke('downloads:action', download.id, download.state === 'completed' ? 'open' : 'show')}
        />
      ))}
    </ListCard>
  )
}

function ReadingWidget() {
  const [items, setItems] = useState<ReadingItem[]>([])
  useEffect(() => void api().invoke('reading:list').then((all) => setItems(all.filter((item) => item.readAt === null).toSorted((a, b) => b.addedAt - a.addedAt))), [])
  return (
    <ListCard title={items.length > 0 ? `Reading list · ${items.length} unread` : 'Reading list'} empty={items.length === 0 ? 'Nothing waiting. Right-click a page to save it for later.' : null} more={{ label: 'Open reading list', page: 'sc://reading' }}>
      {items.slice(0, 4).map((item) => (
        <ListItem key={item.id} title={item.title || hostOf(item.url)} detail={`${hostOf(item.url)} · saved ${ago(item.addedAt)}`} onOpen={() => void api().invoke('reading:open', item.id)} />
      ))}
    </ListCard>
  )
}

function WatchingWidget() {
  const [watches, setWatches] = useState<Omit<PageWatch, 'lastText'>[]>([])
  useEffect(() => void api().invoke('watch:list').then(setWatches), [])
  const changed = watches.filter((watch) => watch.unseen).toSorted((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0))
  const empty = watches.length === 0 ? 'Not watching any pages. Right-click a page to watch it for changes.' : changed.length === 0 ? `No changes on the ${watches.length === 1 ? 'page' : `${watches.length} pages`} you watch.` : null
  return (
    <ListCard title={changed.length > 0 ? `Watched pages · ${changed.length} changed` : 'Watched pages'} empty={empty} more={{ label: changed.length > 0 ? 'See what changed' : 'Open watched pages', page: 'sc://watching' }}>
      {changed.slice(0, 4).map((watch) => (
        <ListItem key={watch.id} title={watch.title || hostOf(watch.url)} detail={`Changed ${ago(watch.changedAt ?? Date.now())}${watch.added[0] ? ` · ${watch.added[0]}` : ''}`} onOpen={() => openHere(watch.url)} />
      ))}
    </ListCard>
  )
}

/** What tracker blocking did this week, with a small chart of each day. Nothing leaves the computer for it. */
function PrivacyWidget() {
  const [week, setWeek] = useState<PrivacyWeek | null>(null)
  useEffect(() => void api().invoke('privacy:week').then(setWeek), [])
  if (!week) return null
  const most = Math.max(1, ...week.daily.map((day) => day.blocked))
  const dayName = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
  return (
    <Card title="Privacy this week">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums">{week.blocked.toLocaleString()}</span>
          <span className="text-xs text-text-muted">
            {week.blocked === 1 ? 'tracker or ad blocked' : 'trackers and ads blocked'}
            {week.banners > 0 && ` · ${week.banners.toLocaleString()} cookie ${week.banners === 1 ? 'banner' : 'banners'} turned down`}
          </span>
        </div>
        <div role="img" aria-label={`Blocked each day: ${week.daily.map((day) => `${dayName(day.day)} ${day.blocked}`).join(', ')}`} className="flex h-10 items-end gap-1">
          {week.daily.map((day) => (
            <span key={day.day} title={`${dayName(day.day)}: ${day.blocked.toLocaleString()}`} className="w-2 rounded-sm bg-accent" style={{ height: `${Math.max(6, Math.round((day.blocked / most) * 100))}%`, opacity: day.blocked === 0 ? 0.25 : 1 }} />
          ))}
        </div>
      </div>
      {week.topHosts.length > 0 ? (
        <p className="truncate text-xs text-text-faint">Stopped most: {week.topHosts.slice(0, 3).map((host) => host.host).join(', ')}</p>
      ) : (
        <p className="text-xs text-text-faint">Nothing blocked yet this week.</p>
      )}
    </Card>
  )
}

const STEP_ICONS: Record<GettingStartedId, LucideIcon> = { assistant: MessageCircle, brief: Newspaper, split: Columns2, palette: Command, customise: LayoutGrid }

/**
 * For someone new: a few things worth trying, each with a button that shows it by doing it.
 * Steps tick themselves off when used from anywhere, and the list goes once it's closed.
 */
function GetStarted({ onCustomise }: { onCustomise: () => void }) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const load = useCallback(() => void api().invoke('onboarding:state').then(setState), [])
  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])
  if (!state?.show) return null
  const count = state.done.length
  const all = count === GETTING_STARTED.length
  const hide = () => void api().invoke('onboarding:set-shown', false).then(load)
  return (
    <section aria-label="Get started" className="sc-glass col-span-2 flex flex-col gap-3 rounded-lg p-4 text-text shadow-1">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-semibold">{all ? 'You’re all set' : 'Get started with scTerra'}</h2>
          <p className="text-xs text-text-muted">{all ? 'You’ve tried everything here. The command palette (Ctrl K) finds the rest.' : 'A few things worth a try. Each takes a moment.'}</p>
        </div>
        <span className="mt-0.5 shrink-0 text-xs text-text-faint tabular-nums">
          {count} of {GETTING_STARTED.length}
        </span>
        <IconButton size="sm" label={all ? 'Close' : 'Hide Get started'} onClick={hide}>
          <X size={12} strokeWidth={2} />
        </IconButton>
      </div>
      <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent transition-[width] duration-(--sc-duration-slow)" style={{ width: `${(count / GETTING_STARTED.length) * 100}%` }} />
      </div>
      <ul className="grid grid-cols-2 gap-1 max-[640px]:grid-cols-1">
        {GETTING_STARTED.map((step) => {
          const done = state.done.includes(step.id)
          const Icon = STEP_ICONS[step.id]
          const run = () => {
            if (step.id === 'customise') {
              onCustomise()
              void api().invoke('onboarding:mark', 'customise').then(load)
            } else void api().invoke('onboarding:try', step.id).then(load)
          }
          return (
            <li key={step.id} className="min-w-0">
              <button type="button" onClick={run} className="group flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-surface-hover">
                <span className={cx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-md', done ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent')}>
                  {done ? <Check aria-hidden size={14} strokeWidth={2.25} /> : <Icon aria-hidden size={14} strokeWidth={1.75} />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={cx('font-medium', done && 'text-text-muted line-through decoration-text-faint')}>{step.title}</span>
                  <span className="text-xs text-text-muted">{step.detail}</span>
                  {!done && (
                    <span className="mt-0.5 text-xs font-medium text-accent group-hover:text-accent-hover">
                      {step.action}
                      {step.shortcut && <span className="font-normal text-text-faint"> · {step.shortcut}</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The newest briefs for the new tab. Private windows have none. */
function useBriefs(): BriefIssue[] {
  const [issues, setIssues] = useState<BriefIssue[]>([])
  useEffect(() => {
    const load = () =>
      void api()
        .invoke('briefs:recent')
        .then(setIssues, () => setIssues([]))
    load()
    // A brief can be written while this tab sits open.
    const timer = setInterval(load, 60_000)
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return issues
}

const openBrief = (id: string | null) => openHere(id ? `sc://briefs/#${id}` : 'sc://briefs')
function BriefsWidget() {
  const issues = useBriefs()
  const unseen = issues.filter((issue) => issue.unseen).length
  return (
    <ListCard
      title={unseen > 0 ? `AI Briefs · ${unseen} new` : 'AI Briefs'}
      empty={issues.length === 0 ? 'No briefs yet. Set one up and scAI researches it for you every day.' : null}
      more={{ label: issues.length === 0 ? 'Set up a brief' : 'All briefs', page: 'sc://briefs' }}
    >
      {issues.slice(0, 4).map((issue) => (
        <ListItem key={issue.id} title={issue.title} detail={`${issue.unseen ? 'New · ' : ''}${ago(issue.createdAt)} · ${briefPreview(issue.text)}`} onOpen={() => openBrief(issue.id)} />
      ))}
    </ListCard>
  )
}

/** Shown on every new tab while a brief is waiting to be read, whatever widgets are on. */
function BriefBanner({ issues }: { issues: BriefIssue[] }) {
  const [hidden, setHidden] = useState(false)
  const speech = useSpeak('brief-banner')
  const waiting = issues.filter((issue) => issue.unseen)
  const latest = waiting[0]
  if (!latest || hidden) return null
  return (
    <section aria-label="New brief" className="sc-glass col-span-2 flex items-center gap-3 rounded-lg p-3 text-text shadow-1">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Newspaper size={15} strokeWidth={1.75} />
      </span>
      <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => openBrief(latest.id)}>
        <span className="truncate font-medium">
          {waiting.length > 1 ? `${waiting.length} new briefs · ` : 'New brief · '}
          {latest.title}
        </span>
        <span className="truncate text-xs text-text-muted">{briefPreview(latest.text)}</span>
      </button>
      <IconButton
        size="sm"
        label={speech.speaking ? 'Stop reading aloud' : (speech.problem ?? 'Listen to this brief')}
        aria-pressed={speech.speaking}
        onClick={() => {
          if (speech.speaking) return speech.toggle('')
          // The new tab only holds the opening lines, so the whole brief is fetched to be read out.
          void api().invoke('briefs:issue', latest.id).then((issue) => issue && speech.toggle(`${issue.title}. ${speechText(issue.text)}`))
        }}
      >
        {speech.speaking ? <Square size={11} strokeWidth={2} /> : <Volume2 size={13} strokeWidth={1.75} />}
      </IconButton>
      <Button variant="primary" className="shrink-0" onClick={() => openBrief(latest.id)}>
        Read
      </Button>
      <IconButton
        size="sm"
        label="Dismiss"
        onClick={() => {
          setHidden(true)
          void api().invoke('briefs:seen', null)
        }}
      >
        <X size={12} strokeWidth={2} />
      </IconButton>
    </section>
  )
}

/** The briefs menu in the corner of the new tab: the newest few, and the way to set one up. */
function BriefsMenu({ issues }: { issues: BriefIssue[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const unseen = issues.filter((issue) => issue.unseen).length
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 items-center gap-1.5 rounded-md bg-surface px-2.5 text-text-muted shadow-1 transition-colors hover:text-text"
        onClick={() => setOpen(!open)}
      >
        <Newspaper aria-hidden size={14} strokeWidth={1.75} />
        Briefs
        {unseen > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-2xs font-medium text-on-accent tabular-nums">{unseen}</span>}
      </button>
      {open && (
        <div role="menu" aria-label="AI Briefs" className="sc-glass absolute right-0 bottom-10 flex w-80 flex-col gap-0.5 rounded-lg p-1.5 text-text shadow-2">
          <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-text-muted">AI Briefs</div>
          {issues.length === 0 && <p className="px-2 pb-2 text-xs text-text-muted">scAI can research a topic for you at a set time, like the latest AI news every morning.</p>}
          {issues.slice(0, 6).map((issue) => (
            <button key={issue.id} type="button" role="menuitem" className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover" onClick={() => openBrief(issue.id)}>
              <span aria-label={issue.unseen ? 'New' : undefined} className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', issue.unseen ? 'bg-accent' : 'bg-transparent')} />
              <span className="flex min-w-0 flex-col">
                <span className={cx('truncate', issue.unseen && 'font-medium')}>{issue.title}</span>
                <span className="truncate text-xs text-text-faint">
                  {ago(issue.createdAt)} · {briefPreview(issue.text)}
                </span>
              </span>
            </button>
          ))}
          <div className="mt-1 flex gap-1 border-t border-border pt-1.5">
            <button type="button" role="menuitem" className="h-7 flex-1 rounded-md px-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text" onClick={() => openBrief(null)}>
              All briefs
            </button>
            <button type="button" role="menuitem" className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text" onClick={() => openHere('sc://briefs/?new')}>
              <Plus aria-hidden size={12} strokeWidth={2} />
              New brief
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Today's focused time, and a button per activity to start or stop the timer from the new tab. */
function FocusWidget() {
  const [state, setState] = useState<StudyState | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => void api().invoke('study:state').then(setState).catch(() => undefined), [])
  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [load])
  const running = state?.running ?? null
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  if (!state) return null
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const live = running ? Math.max(0, now - Math.max(running.startedAt, midnight)) : 0
  const today = (state.days.at(-1)?.total ?? 0) + live
  const goal = state.prefs.goalMinutes * 60_000
  const act = (call: Promise<StudyState>) => void call.then(setState).catch(() => load())
  return (
    <Card title="Focus timer">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xl leading-none font-light tracking-[-0.03em] tabular-nums">{stopwatch(today)}</span>
          <span className="truncate text-xs text-text-muted">{goal > 0 ? `of ${state.prefs.goalMinutes / 60} h today` : 'today'}</span>
        </div>
        {goal > 0 && (
          <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-active">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (today / goal) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="-mx-1 flex flex-wrap gap-1">
        {state.subjects.slice(0, 6).map((subject) => {
          const on = running?.subjectId === subject.id
          return (
            <button
              key={subject.id}
              type="button"
              aria-pressed={on}
              aria-label={on ? `Stop ${subject.name}` : `Start ${subject.name}`}
              style={{ '--hue': subject.hue } as CSSProperties}
              className={cx('sc-hued flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors', on ? 'bg-[var(--hued-soft)] text-[var(--hued)]' : 'text-text-muted hover:bg-surface-hover hover:text-text')}
              onClick={() => act(on ? api().invoke('study:stop') : api().invoke('study:start', subject.id))}
            >
              {on ? <Pause aria-hidden size={11} strokeWidth={2.25} /> : <Play aria-hidden size={11} strokeWidth={2.25} className="text-[var(--hued)]" />}
              {subject.name}
            </button>
          )
        })}
      </div>
      <button type="button" className="self-start text-xs text-text-muted transition-colors hover:text-text" onClick={() => openNewTab('sc://focus')}>
        Open the timer
      </button>
    </Card>
  )
}

function NotesWidget({ notes, update }: { notes: string; update: Update }) {
  const [text, setText] = useState(notes)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (
    <Card title="Notes">
      <textarea
        aria-label="Notes"
        placeholder="Write something down"
        rows={5}
        maxLength={MAX_NOTES_LENGTH}
        className="w-full resize-none rounded-lg border border-border bg-transparent p-2 outline-none placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-focus-ring"
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => update({ notes: next }), NOTES_SAVE_DELAY_MS)
        }}
      />
    </Card>
  )
}

function CalendarWidget() {
  const now = useNow(false)
  const year = now.getFullYear()
  const month = now.getMonth()
  const blanks = (new Date(year, month, 1).getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  return (
    <Card title={now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs tabular-nums">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <span key={index} aria-hidden className="text-text-faint">
            {day}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => (
          <span key={index} className={cx('rounded-sm py-0.5', index + 1 === now.getDate() && 'bg-accent font-medium text-on-accent')}>
            {index + 1}
          </span>
        ))}
      </div>
    </Card>
  )
}

function Widget({ id, config, update, keepChats }: { id: NewTabWidgetId; config: NewTabConfig; update: Update; keepChats: boolean }) {
  switch (id) {
    case 'greeting':
      return <GreetingWidget name={config.name} />
    case 'clock':
      return <ClockWidget config={config} />
    case 'search':
      return <SearchWidget />
    case 'ai':
      return <QuickAiWidget keepChats={keepChats} />
    case 'shortcuts':
      return <ShortcutsWidget config={config} />
    case 'bookmarks':
      return <BookmarksWidget />
    case 'notes':
      return <NotesWidget notes={config.notes} update={update} />
    case 'calendar':
      return <CalendarWidget />
    case 'downloads':
      return <DownloadsWidget />
    case 'reading':
      return <ReadingWidget />
    case 'watching':
      return <WatchingWidget />
    case 'briefs':
      return <BriefsWidget />
    case 'privacy':
      return <PrivacyWidget />
    case 'focus':
      return <FocusWidget />
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="min-w-0 truncate">{label}</span>
      {children}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0">
      <h3 className="text-xs font-medium text-text-muted">{title}</h3>
      {children}
    </section>
  )
}

function WidgetList({ config, update }: { config: NewTabConfig; update: Update }) {
  const { widgets } = config
  const name = (id: NewTabWidgetId) => NEW_TAB_WIDGETS.find((widget) => widget.id === id)!.name
  const off = NEW_TAB_WIDGETS.filter(({ id }) => !widgets.some((widget) => widget.id === id))
  const move = (index: number, offset: number) => {
    const next = [...widgets]
    next.splice(index + offset, 0, ...next.splice(index, 1))
    update({ widgets: next })
  }
  return (
    <Group title="Widgets">
      {widgets.map(({ id, size, when }, index) => (
        <div key={id} className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate">{name(id)}</span>
          <Select
            aria-label={`When to show ${name(id)}`}
            title="Show it only at some times of day"
            value={when ?? 'always'}
            onChange={(e) => update({ widgets: widgets.map((w) => (w.id === id ? { ...w, when: e.target.value as WidgetTime } : w)) })}
          >
            {WIDGET_TIMES.map((time) => (
              <option key={time} value={time}>
                {WIDGET_TIME_LABELS[time]}
              </option>
            ))}
          </Select>
          <Select
            aria-label={`${name(id)} width`}
            value={size}
            onChange={(e) => update({ widgets: widgets.map((w) => (w.id === id ? { ...w, size: e.target.value as 'full' | 'half' } : w)) })}
          >
            <option value="full">Full</option>
            <option value="half">Half</option>
          </Select>
          <IconButton label={`Move ${name(id)} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            <ArrowUp size={14} strokeWidth={1.75} />
          </IconButton>
          <IconButton label={`Move ${name(id)} down`} disabled={index === widgets.length - 1} onClick={() => move(index, 1)}>
            <ArrowDown size={14} strokeWidth={1.75} />
          </IconButton>
          <IconButton label={`Remove ${name(id)}`} onClick={() => update({ widgets: widgets.filter((w) => w.id !== id) })}>
            <X size={14} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
      {off.map(({ id, name: label }) => (
        <div key={id} className="flex items-center justify-between gap-1">
          <span className="text-text-muted">{label}</span>
          <IconButton label={`Add ${label}`} onClick={() => update({ widgets: [...widgets, { id, size: 'full' }] })}>
            <Plus size={14} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
    </Group>
  )
}

function BackgroundOptions({ config, update }: { config: NewTabConfig; update: Update }) {
  const [error, setError] = useState<string | null>(null)
  const [pickingColour, setPickingColour] = useState(false)
  const pick = () => {
    setError(null)
    void api()
      .invoke('newtab:pick-background')
      .then((imageVersion) => imageVersion && update({ background: 'image', imageVersion }))
      .catch((failure: Error) => setError(failure.message.replace(/^.*Error: /, '')))
  }
  return (
    <Group title="Background">
      <Row label="Type">
        <Select
          aria-label="Background type"
          value={config.background}
          onChange={(e) => update({ background: e.target.value as NewTabConfig['background'] })}
        >
          <option value="none">Plain</option>
          <option value="color">Colour</option>
          <option value="image">Picture</option>
        </Select>
      </Row>
      {config.background === 'color' && (
        <>
          <Row label="Colour">
            <button type="button" aria-label="Background colour" aria-expanded={pickingColour} className="h-8 w-12 rounded-md shadow-1" style={{ background: config.color }} onClick={() => setPickingColour(!pickingColour)} />
          </Row>
          {pickingColour && <ColorPicker value={config.color} onChange={(color) => update({ color })} />}
        </>
      )}
      {config.background === 'image' && (
        <>
          <Row label="Picture">
            <div className="flex gap-1">
              <Button onClick={pick}>Choose</Button>
              {config.imageVersion > 0 && (
                <Button variant="ghost" onClick={() => update({ background: 'none', imageVersion: 0 })}>
                  Remove
                </Button>
              )}
            </div>
          </Row>
          <p className="text-xs text-text-faint">Stays on this device and is never uploaded or synced.</p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Row label="Darken">
            <input aria-label="Darken" type="range" min={0} max={80} value={config.dim} onChange={(e) => update({ dim: Number(e.target.value) })} />
          </Row>
          <Row label="Blur">
            <input aria-label="Blur" type="range" min={0} max={24} value={config.blur} onChange={(e) => update({ blur: Number(e.target.value) })} />
          </Row>
        </>
      )}
    </Group>
  )
}

function ShortcutOptions({ config, update }: { config: NewTabConfig; update: Update }) {
  const [address, setAddress] = useState('')
  const url = /^https?:\/\//i.test(address) ? address.trim() : `https://${address.trim()}`
  const valid = address.trim().includes('.') && URL.canParse(url)
  const add = () => {
    update({ links: [...config.links.filter((link) => link.url !== url), { title: hostOf(url), url }] })
    setAddress('')
  }
  return (
    <Group title="Shortcuts">
      <Row label="Include most visited sites">
        <Switch label="Include most visited sites" checked={config.topSites} onChange={(topSites) => update({ topSites })} />
      </Row>
      {config.links.map((link) => (
        <div key={link.url} className="flex items-center justify-between gap-1">
          <span className="min-w-0 truncate">{hostOf(link.url)}</span>
          <IconButton label={`Remove ${hostOf(link.url)}`} onClick={() => update({ links: config.links.filter((l) => l.url !== link.url) })}>
            <X size={14} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
      {config.links.length < MAX_NEW_TAB_LINKS && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) add()
          }}
        >
          <Input aria-label="Shortcut address" placeholder="example.com" className="min-w-0 flex-1" value={address} onChange={(e) => setAddress(e.target.value)} />
          <Button type="submit" disabled={!valid}>
            Add
          </Button>
        </form>
      )}
    </Group>
  )
}

function CustomisePanel({ config, update, onClose }: { config: NewTabConfig; update: Update; onClose: () => void }) {
  return (
    <aside aria-label="Customise new tab" className="fixed inset-y-0 right-0 z-10 flex w-80 max-w-full flex-col overflow-hidden border-l border-border bg-surface text-text">
      <header className="flex items-center justify-between p-3">
        <h2 className="font-medium">Customise</h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={15} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
        <WidgetList config={config} update={update} />
        <BackgroundOptions config={config} update={update} />
        <Group title="Clock and greeting">
          <Row label="24-hour clock">
            <Switch label="24-hour clock" checked={config.clock24} onChange={(clock24) => update({ clock24 })} />
          </Row>
          <Row label="Show seconds">
            <Switch label="Show seconds" checked={config.clockSeconds} onChange={(clockSeconds) => update({ clockSeconds })} />
          </Row>
          <Row label="Your name">
            <Input aria-label="Your name" maxLength={40} className="w-36" value={config.name} onChange={(e) => update({ name: e.target.value })} />
          </Row>
        </Group>
        <Group title="Layout">
          <Row label="Position">
            <Select aria-label="Position" value={config.align} onChange={(e) => update({ align: e.target.value as NewTabConfig['align'] })}>
              <option value="center">Centre</option>
              <option value="top">Top</option>
            </Select>
          </Row>
          <Row label="Width">
            <Select aria-label="Width" value={config.width} onChange={(e) => update({ width: e.target.value as NewTabConfig['width'] })}>
              <option value="narrow">Narrow</option>
              <option value="wide">Wide</option>
            </Select>
          </Row>
        </Group>
        <ShortcutOptions config={config} update={update} />
        <Button variant="ghost" onClick={() => update({ ...DEFAULT_NEW_TAB, notes: config.notes, links: config.links })}>
          Reset layout and background
        </Button>
      </div>
    </aside>
  )
}

function useBackgroundImage(version: number, wanted: boolean): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean }>({ url: null, missing: false })
  useEffect(() => {
    if (!wanted || version === 0) return
    let url: string | null = null
    let stale = false
    void api()
      .invoke('newtab:background')
      .then((image) => {
        if (stale) return
        url = image && URL.createObjectURL(new Blob([image.bytes.slice()], { type: image.type }))
        setState({ url, missing: !image })
      })
    return () => {
      stale = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [version, wanted])
  return state
}

/** Only drawn when their flags are on. */
const Weather = () => (
  <>
    <div aria-hidden className="sc-stars" />
    <div aria-hidden className="sc-snow" />
  </>
)

function Backdrop({ config, image }: { config: NewTabConfig; image: string | null }) {
  if (config.background === 'color')
    return (
      <>
        <div aria-hidden className="fixed inset-0 -z-10" style={{ background: config.color }} />
        <Weather />
      </>
    )
  if (config.background !== 'image' || !image)
    return (
      <>
        <div aria-hidden className="sc-aurora" />
        <Weather />
      </>
    )
  const blur = config.blur > 0 ? { filter: `blur(${config.blur}px)`, scale: '1.05' } : {}
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <img src={image} alt="" className="size-full object-cover" style={blur} />
      <div className="absolute inset-0" style={{ background: 'var(--sc-on-image-dark)', opacity: config.dim / 100 }} />
      <div aria-hidden className="sc-snow" />
    </div>
  )
}

export function NewTabPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customising, setCustomising] = useState(() => new URLSearchParams(location.search).has('customise'))
  const [isPrivate, setPrivate] = useState(false)
  const latest = useRef<NewTabConfig | null>(null)

  useEffect(() => {
    document.title = 'New tab'
    void api().invoke('browser:is-private').then(setPrivate)
    void api()
      .invoke('settings:get')
      .then((loaded) => {
        latest.current = { ...DEFAULT_NEW_TAB, ...loaded.newTab }
        document.documentElement.dataset.accent = loaded.accent
        applyTint(loaded.accentTint)
        applyPerformance(loaded.performanceMode)
        setSettings(loaded)
      })
  }, [])

  const config = useMemo(() => ({ ...DEFAULT_NEW_TAB, ...settings?.newTab }), [settings])
  const briefs = useBriefs()
  const picture = useBackgroundImage(config.imageVersion, config.background === 'image')

  const update = useCallback<Update>((patch) => {
    // Based on the latest saved value, so that the delayed notes save can't undo another change.
    const next = { ...latest.current!, ...patch }
    latest.current = next
    setSettings((current) => current && { ...current, newTab: next })
    void api().invoke('settings:set', { newTab: next })
  }, [])

  if (!settings) return null
  const getStarted = !isPrivate && !customising && <GetStarted onCustomise={() => setCustomising(true)} />

  // A picture that synced from elsewhere exists only on that device, so it falls back to plain.
  const shown = picture.missing && config.background === 'image' ? { ...config, background: 'none' as const } : config
  const tone = shown.background === 'image' ? 'light' : shown.background === 'color' ? (isDarkColor(shown.color) ? 'light' : 'dark') : undefined
  const layout: CSSProperties = { maxWidth: config.width === 'wide' ? 'calc(var(--sc-space) * 225)' : 'calc(var(--sc-space) * 150)' }

  return (
    <div className="sc-newtab relative isolate h-full overflow-y-auto" data-tone={tone}>
      <Backdrop config={shown} image={picture.url} />
      <main className={cx('flex min-h-full w-full flex-col p-8', config.align === 'center' ? 'justify-center' : 'justify-start', customising && 'pr-88')}>
        <div className="mx-auto grid w-full grid-cols-2 gap-4" style={layout}>
          {isPrivate && (
            <p className="sc-newtab-text col-span-2 text-center text-xs opacity-75">
              This window is private. When it closes, its history, cookies and site data are deleted. Downloads stay, and websites and your network can still see what you do.
            </p>
          )}
          {!isPrivate && <BriefBanner issues={briefs} />}
          {config.widgets.filter((widget) => widgetShownAt(widget.when, new Date())).map(({ id, size }, index, shown) => (
            <Fragment key={id}>
              {/* A widget with nothing to show leaves no gap. */}
              <div className={cx('min-w-0 empty:hidden', size === 'full' && 'col-span-2')}>
                <Widget id={id} config={config} update={update} keepChats={settings.saveChats} />
              </div>
              {/* Someone new sees it under the search box, or after the first widget without one. */}
              {index === Math.max(0, shown.findIndex((widget) => widget.id === 'search')) && getStarted}
            </Fragment>
          ))}
          {config.widgets.length === 0 && getStarted}
        </div>
      </main>
      {customising ? (
        <CustomisePanel config={config} update={update} onClose={() => setCustomising(false)} />
      ) : (
        <div className="fixed right-3 bottom-3 flex items-center gap-2">
          {!isPrivate && <BriefsMenu issues={briefs} />}
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md bg-surface px-2.5 text-text-muted shadow-1 transition-colors hover:text-text"
            onClick={() => setCustomising(true)}
          >
            <Settings2 aria-hidden size={14} strokeWidth={1.75} />
            Customise
          </button>
        </div>
      )}
    </div>
  )
}
