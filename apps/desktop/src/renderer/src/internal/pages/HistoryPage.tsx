import { ChevronRight, History, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, cx, IconButton, Input } from '@scbrowser/ui'
import type { HistoryEntry } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState, NoMatches } from '../EmptyState'
import { ConfirmButton } from '../ConfirmButton'

const PAGE_SIZE = 200

const dayLabel = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeLabel = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** A site visited this many times in a day folds under one row, so a long day isn't a wall of rows. */
const FOLD_FROM = 3

type DayRow = { kind: 'page'; entry: HistoryEntry } | { kind: 'site'; host: string; entries: HistoryEntry[] }

/** A day's visits with repeated sites folded together, each at the place of its newest visit. */
export function foldBySite(visits: HistoryEntry[]): DayRow[] {
  const byHost = Map.groupBy(visits, (entry) => hostOf(entry.url))
  const placed = new Set<string>()
  const rows: DayRow[] = []
  for (const entry of visits) {
    const host = hostOf(entry.url)
    const same = byHost.get(host) ?? []
    if (host && same.length >= FOLD_FROM) {
      if (placed.has(host)) continue
      placed.add(host)
      rows.push({ kind: 'site', host, entries: same })
    } else rows.push({ kind: 'page', entry })
  }
  return rows
}

export function HistoryPage() {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    void api().invoke('history:list', query, PAGE_SIZE, 0).then(setEntries)
  }, [query])
  useEffect(load, [load])

  const days = Map.groupBy(entries, (entry) => dayLabel(entry.lastVisit))
  const [openSites, setOpenSites] = useState<Set<string>>(new Set())
  // A search shows every match on its own; folding is for browsing a day.
  const folding = !query.trim()
  const remove = (url: string) => void api().invoke('history:delete', url).then(load)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search history"
          placeholder="Search, or describe a page you remember"
          className="min-w-72 flex-[1_1_100%]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          disabled={query.trim().split(/\s+/).length < 2 || asking}
          onClick={() => {
            setAsking(true)
            setNote(null)
            void api()
              .invoke('history:ask', query)
              .then((found) => {
                setAsking(false)
                if (found) setEntries(found)
                else setNote("Couldn't search with AI. Check AI settings.")
              })
          }}
        >
          {asking ? 'Searching…' : 'Ask AI'}
        </Button>
        <Button
          title="A short recap of what you were doing yesterday, from page titles and addresses"
          onClick={() => {
            setNote(null)
            void api()
              .invoke('history:recap')
              .then((started) => !started && setNote("There's nothing from yesterday to recap, or no AI model is chosen yet."))
          }}
        >
          Recap yesterday
        </Button>
        <Button
          title="A recap of the past seven days, grouped by theme, from page titles and addresses"
          onClick={() => {
            setNote(null)
            void api()
              .invoke('history:recap', 'week')
              .then((started) => !started && setNote("There's nothing from the past week to recap, or no AI model is chosen yet."))
          }}
        >
          Recap my week
        </Button>
        <ConfirmButton disabled={entries.length === 0} confirmLabel="Clear everything?" onConfirm={() => void api().invoke('history:clear').then(load)}>
          Clear all
        </ConfirmButton>
      </div>
      {note && (
        <p role="alert" className="text-danger">
          {note}
        </p>
      )}
      {entries.length === 0 && (query ? <NoMatches /> : <EmptyState icon={History} title="No history yet">Pages you visit appear here, newest first.</EmptyState>)}
      {[...days].map(([day, visits]) => (
        <section key={day} aria-label={day} className="flex flex-col gap-1">
          <h2 className="sticky top-0 z-10 -mx-2 bg-surface/90 px-2 py-1.5 text-xs font-medium text-text-muted backdrop-blur-sm">{day}</h2>
          <ul>
            {(folding ? foldBySite(visits) : visits.map((entry) => ({ kind: 'page' as const, entry }))).map((row) => {
              if (row.kind === 'page') return <VisitRow key={row.entry.url} entry={row.entry} onRemove={remove} />
              const key = `${day} ${row.host}`
              const open = openSites.has(key)
              return (
                <li key={key} className="flex flex-col">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenSites((current) => {
                      const next = new Set(current)
                      if (open) next.delete(key)
                      else next.add(key)
                      return next
                    })}
                    className="flex h-9 items-center gap-3 rounded-md px-2 text-left hover:bg-surface-hover"
                  >
                    <span className="w-16 shrink-0 text-xs text-text-faint">{timeLabel(row.entries[0]!.lastVisit)}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <ChevronRight aria-hidden size={15} strokeWidth={2} className={cx('-ml-0.5 shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
                      <span className="truncate font-medium">{row.host}</span>
                      <span className="shrink-0 rounded-sm bg-surface-active px-1.5 text-2xs text-text-muted tabular-nums">{row.entries.length} pages</span>
                    </span>
                    {/* The span of the visits, when there is one: the first time is already at the start of the row. */}
                    {timeLabel(row.entries.at(-1)!.lastVisit) !== timeLabel(row.entries[0]!.lastVisit) && (
                      <span className="min-w-0 max-w-60 truncate text-xs text-text-faint">
                        {timeLabel(row.entries.at(-1)!.lastVisit)} to {timeLabel(row.entries[0]!.lastVisit)}
                      </span>
                    )}
                  </button>
                  {open && (
                    <ul aria-label={`Pages on ${row.host}`} className="ml-[5.25rem] border-l border-border pl-1">
                      {row.entries.map((entry) => (
                        <VisitRow key={entry.url} entry={entry} onRemove={remove} hideHost />
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}

function VisitRow({ entry, onRemove, hideHost }: { entry: HistoryEntry; onRemove: (url: string) => void; hideHost?: boolean }) {
  return (
    <li className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
      <span className="w-16 shrink-0 text-xs text-text-faint">{timeLabel(entry.lastVisit)}</span>
      <a href={entry.url} className="min-w-0 flex-1 truncate">
        {entry.title || entry.url}
      </a>
      {!hideHost && <span className="min-w-0 max-w-60 truncate text-xs text-text-faint">{hostOf(entry.url)}</span>}
      <IconButton size="sm" label="Remove from history" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(entry.url)}>
        <X size={12} strokeWidth={2} />
      </IconButton>
    </li>
  )
}
