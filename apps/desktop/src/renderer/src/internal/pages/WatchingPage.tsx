import { Eye, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { intervalLabel, WATCH_INTERVALS, type PageWatch, type WatchInterval } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState } from '../EmptyState'

type Watch = Omit<PageWatch, 'lastText'>

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)
const when = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** For a watched price or count: only say so when the number passes a figure. */
function NumberAlert({ watch, reload }: { watch: Watch; reload: () => void }) {
  const [direction, setDirection] = useState(watch.target?.direction ?? 'below')
  const [figure, setFigure] = useState(watch.target ? String(watch.target.value) : '')
  const save = (nextDirection: 'below' | 'above', text: string) => {
    const value = Number(text)
    const target = text.trim() && Number.isFinite(value) ? { direction: nextDirection, value } : null
    void api().invoke('watch:set-target', watch.id, target).then(reload)
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <span>
        Number on the page: <span className="font-medium text-text tabular-nums">{watch.value}</span>. Only tell me when it goes
      </span>
      <Select
        aria-label="Above or below"
        className="w-24"
        value={direction}
        onChange={(e) => {
          const next = e.target.value as 'below' | 'above'
          setDirection(next)
          if (figure.trim()) save(next, figure)
        }}
      >
        <option value="below">below</option>
        <option value="above">above</option>
      </Select>
      <Input aria-label="Target number" className="w-28" inputMode="decimal" placeholder="any change" value={figure} onChange={(e) => setFigure(e.target.value.replace(/[^\d.-]/g, ''))} onBlur={() => save(direction, figure)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {watch.target && watch.hit && <span className="font-medium text-success">Reached</span>}
    </div>
  )
}

function WatchCard({ watch, reload }: { watch: Watch; reload: () => void }) {
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState(watch.unseen)
  const changed = watch.added.length + watch.removed.length > 0
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2">
            {watch.unseen && <span aria-label="Changed" className="size-1.5 shrink-0 rounded-full bg-accent" />}
            <a href={watch.url} className="truncate font-medium" onClick={() => void api().invoke('watch:seen', watch.id)}>
              {watch.title || hostOf(watch.url)}
            </a>
          </div>
          <div className="truncate text-xs text-text-faint">
            {hostOf(watch.url)}
            {watch.selector && ' · one part of the page'}
            {' · '}
            {watch.changedAt ? `Changed ${when(watch.changedAt)}` : 'No changes yet'}
            {watch.lastCheckedAt && ` · Checked ${when(watch.lastCheckedAt)}`}
          </div>
          {watch.error && <div role="alert" className="text-xs text-danger">{watch.error}</div>}
        </div>
        <Select
          aria-label="How often to check"
          className="w-36 shrink-0"
          value={watch.everyMinutes}
          onChange={(e) => void api().invoke('watch:set-interval', watch.id, Number(e.target.value) as WatchInterval).then(reload)}
        >
          {WATCH_INTERVALS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {intervalLabel(minutes)}
            </option>
          ))}
        </Select>
        <IconButton
          size="sm"
          label={checking ? 'Checking…' : 'Check now'}
          disabled={checking}
          onClick={() => {
            setChecking(true)
            void api()
              .invoke('watch:check', watch.id)
              .finally(() => {
                setChecking(false)
                reload()
              })
          }}
        >
          <RefreshCw size={12} strokeWidth={1.75} className={checking ? 'animate-spin' : undefined} />
        </IconButton>
        <IconButton size="sm" label="Stop watching" onClick={() => void api().invoke('watch:remove', watch.id).then(reload)}>
          <X size={12} strokeWidth={2} />
        </IconButton>
      </div>
      {watch.selector && typeof watch.value === 'number' && <NumberAlert watch={watch} reload={reload} />}
      {watch.summary && <p className="text-text-muted select-text">{watch.summary}</p>}
      {changed && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={open}
            className="self-start text-xs text-text-muted hover:text-text"
            onClick={() => {
              setOpen(!open)
              if (watch.unseen) void api().invoke('watch:seen', watch.id).then(reload)
            }}
          >
            {open ? 'Hide what changed' : 'Show what changed'}
          </button>
          {open && (
            <div aria-label="What changed" className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border font-mono text-xs select-text">
              {watch.removed.map((line, i) => (
                <div key={`r${i}`} className="border-l-2 border-danger px-2 py-0.5 text-text-muted line-through decoration-text-faint">
                  {line}
                </div>
              ))}
              {watch.added.map((line, i) => (
                <div key={`a${i}`} className="border-l-2 border-success px-2 py-0.5 text-text">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Pages checked now and then for changes, with what changed last time. */
export function WatchingPage() {
  const [watches, setWatches] = useState<Watch[] | null>(null)
  const load = useCallback(() => void api().invoke('watch:list').then(setWatches), [])
  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(load, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(timer)
    }
  }, [load])
  if (!watches) return null
  const unseen = watches.filter((watch) => watch.unseen).length
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          scTerra loads each page out of sight now and then, and tells you when its words change. To watch one, right-click it and pick Watch for changes.
        </p>
        {unseen > 0 && (
          <Button className="shrink-0" onClick={() => void api().invoke('watch:seen', null).then(load)}>
            Mark all as seen
          </Button>
        )}
      </div>
      {watches.length === 0 && <EmptyState icon={Eye} title="Not watching anything yet">Handy for prices, stock, results and changelogs.</EmptyState>}
      <ul className="flex flex-col gap-2">
        {[...watches]
          .sort((a, b) => Number(b.unseen) - Number(a.unseen) || (b.changedAt ?? 0) - (a.changedAt ?? 0))
          .map((watch) => (
            <WatchCard key={watch.id} watch={watch} reload={load} />
          ))}
      </ul>
    </>
  )
}
