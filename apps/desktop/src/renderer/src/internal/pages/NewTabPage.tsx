import { ArrowDown, ArrowUp, Globe, History, Plus, Search, Settings2, Square, Star, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
  type NewTabConfig,
  type NewTabLink,
  type NewTabWidgetId,
  type Settings,
  type Suggestion,
  type SuggestionKind
} from '@scbrowser/shared'
import { ReplyContent } from '../../shared/ReplyContent'
import { api, applyTint } from '../api'

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
      <div className="font-medium tabular-nums" style={{ fontSize: 'calc(var(--sc-text-xl) * 2.25)', lineHeight: 1.1, letterSpacing: '-0.035em' }}>
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
  return (
    <Card title="Shortcuts">
      {links.length === 0 ? (
        <p className="text-text-muted">Sites you add or visit often will appear here.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1">
          {links.map((link) => (
            <SiteTile key={link.url} link={link} />
          ))}
        </div>
      )}
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
      {widgets.map(({ id, size }, index) => (
        <div key={id} className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate">{name(id)}</span>
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
        <Row label="Colour">
          <input
            type="color"
            aria-label="Background colour"
            className="h-8 w-12 rounded-md bg-field"
            value={config.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </Row>
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

function Backdrop({ config, image }: { config: NewTabConfig; image: string | null }) {
  if (config.background === 'color') return <div aria-hidden className="fixed inset-0 -z-10" style={{ background: config.color }} />
  if (config.background !== 'image' || !image) return null
  const blur = config.blur > 0 ? { filter: `blur(${config.blur}px)`, scale: '1.05' } : {}
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <img src={image} alt="" className="size-full object-cover" style={blur} />
      <div className="absolute inset-0" style={{ background: 'var(--sc-on-image-dark)', opacity: config.dim / 100 }} />
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
        setSettings(loaded)
      })
  }, [])

  const config = useMemo(() => ({ ...DEFAULT_NEW_TAB, ...settings?.newTab }), [settings])
  const picture = useBackgroundImage(config.imageVersion, config.background === 'image')

  const update = useCallback<Update>((patch) => {
    // Based on the latest saved value, so that the delayed notes save can't undo another change.
    const next = { ...latest.current!, ...patch }
    latest.current = next
    setSettings((current) => current && { ...current, newTab: next })
    void api().invoke('settings:set', { newTab: next })
  }, [])

  if (!settings) return null

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
          {config.widgets.map(({ id, size }) => (
            <div key={id} className={cx('min-w-0', size === 'full' && 'col-span-2')}>
              <Widget id={id} config={config} update={update} keepChats={settings.saveChats} />
            </div>
          ))}
        </div>
      </main>
      {customising ? (
        <CustomisePanel config={config} update={update} onClose={() => setCustomising(false)} />
      ) : (
        <div className="fixed right-3 bottom-3">
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
