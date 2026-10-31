import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input } from '@scbrowser/ui'
import type { HistoryEntry } from '@scbrowser/shared'
import { api } from '../api'

const PAGE_SIZE = 200

const dayLabel = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeLabel = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

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

  return (
    <>
      <div className="flex gap-2">
        <Input
          aria-label="Search history"
          placeholder="Search, or describe what you remember"
          className="flex-1"
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
          disabled={entries.length === 0}
          onClick={() => void api().invoke('history:clear').then(load)}
        >
          Clear all
        </Button>
      </div>
      {note && (
        <p role="alert" className="text-danger">
          {note}
        </p>
      )}
      {entries.length === 0 && <p className="text-text-muted">{query ? 'Nothing matches that search.' : 'No history yet.'}</p>}
      {[...days].map(([day, visits]) => (
        <section key={day} aria-label={day} className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-text-muted">{day}</h2>
          <ul>
            {visits.map((entry) => (
              <li key={entry.url} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
                <span className="w-16 shrink-0 text-xs text-text-faint">{timeLabel(entry.lastVisit)}</span>
                <a href={entry.url} className="min-w-0 flex-1 truncate">
                  {entry.title || entry.url}
                </a>
                <span className="min-w-0 max-w-60 truncate text-xs text-text-faint">{new URL(entry.url).host}</span>
                <IconButton
                  size="sm"
                  label="Remove from history"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void api().invoke('history:delete', entry.url).then(load)}
                >
                  <X size={12} strokeWidth={2} />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
