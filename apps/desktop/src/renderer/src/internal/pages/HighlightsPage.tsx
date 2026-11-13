import { FileText, Highlighter, X, Newspaper, StickyNote } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconButton, Input } from '@scbrowser/ui'
import { MAX_NOTE_CHARS, type Highlight } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState } from '../EmptyState'

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') || url : url)

/** A note saves when the box loses focus, so typing doesn't write on every key. */
function NoteField({ highlight, onSaved }: { highlight: Highlight; onSaved: () => void }) {
  const [note, setNote] = useState(highlight.note)
  const [open, setOpen] = useState(!!highlight.note)
  if (!open) {
    return (
      <button type="button" className="self-start text-xs text-text-faint hover:text-text" onClick={() => setOpen(true)}>
        Add a note
      </button>
    )
  }
  return (
    <textarea
      aria-label="Note"
      rows={2}
      maxLength={MAX_NOTE_CHARS}
      placeholder="Your note"
      value={note}
      autoFocus={!highlight.note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => {
        if (note !== highlight.note) void api().invoke('highlights:note', highlight.id, note).then(onSaved)
        if (!note) setOpen(false)
      }}
      className="w-full resize-y rounded-md border border-border bg-field px-2 py-1.5 text-xs outline-none placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-focus-ring"
    />
  )
}

/** Words marked on pages, by page, with notes and a way to write them up. */
export function HighlightsPage() {
  const [highlights, setHighlights] = useState<Highlight[] | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const load = useCallback(() => void api().invoke('highlights:list').then(setHighlights), [])
  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [load])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (highlights ?? []).filter((highlight) => !needle || `${highlight.text} ${highlight.note} ${highlight.title} ${highlight.url}`.toLowerCase().includes(needle))
  }, [highlights, query])
  if (!highlights) return null
  const pages = Map.groupBy(shown, (highlight) => highlight.url)
  const report = (ids: string[]) => void api().invoke('highlights:report', ids)

  return (
    <>
      <div className="flex gap-2">
        <Input aria-label="Search highlights" placeholder="Search highlights and notes" className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button disabled={shown.length === 0} onClick={() => report(shown.map((highlight) => highlight.id))}>
          <FileText aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
          Write a report from {query ? 'these' : 'all'}
        </Button>
        <Button variant="ghost" title="Save all highlights and notes as a Markdown file" disabled={highlights.length === 0} onClick={() => void api().invoke('highlights:export')}>
          Export
        </Button>
      </div>
      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="h-7 px-2" disabled={shown.length === 0} onClick={() => void api().invoke('highlights:to-notes', shown.map((highlight) => highlight.id)).then(setStatus)}>
          <StickyNote aria-hidden size={13} strokeWidth={1.75} />
          Add {query ? 'these' : 'all'} to new tab notes
        </Button>
        <Button
          variant="ghost"
          className="h-7 px-2"
          disabled={shown.length === 0}
          title="A weekly brief on what's new about the things you highlighted. Only their words go into the search."
          onClick={() =>
            void api()
              .invoke('highlights:brief', shown.map((highlight) => highlight.id))
              .then(() => (location.href = 'sc://briefs/'))
              .catch((error: unknown) => setStatus(error instanceof Error ? error.message.replace(/^.*Error: /, '') : "Couldn't set up the brief"))
          }
        >
          <Newspaper aria-hidden size={13} strokeWidth={1.75} />
          Brief me on what's new about {query ? 'these' : 'them'}
        </Button>
        {status && (
          <span role="status" className="text-xs text-text-muted">
            {status}
          </span>
        )}
      </div>
      <p className="text-xs text-text-faint">Only your highlighted words and notes go to the AI for a report, not the rest of the pages.</p>
      {highlights.length === 0 && <EmptyState icon={Highlighter} title="Nothing highlighted yet">Select some words on a page, right-click and pick Highlight. They’ll be marked whenever you come back.</EmptyState>}
      {highlights.length > 0 && shown.length === 0 && <p className="text-text-muted">Nothing matches that search.</p>}
      {[...pages].map(([url, marks]) => (
        <section key={url} aria-label={marks[0]?.title || url} className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
          <header className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <a href={url} className="block truncate font-medium">
                {marks[0]?.title || url}
              </a>
              <div className="truncate text-xs text-text-faint">{hostOf(url)}</div>
            </div>
            <Button variant="ghost" className="shrink-0" onClick={() => report(marks.map((mark) => mark.id))}>
              Report from this page
            </Button>
          </header>
          <ul className="flex flex-col gap-2">
            {marks.map((highlight) => (
              <li key={highlight.id} className="group flex gap-2">
                <span aria-hidden className="w-0.5 shrink-0 rounded-full bg-accent" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <button type="button" title="Show it on the page" className="text-left select-text" onClick={() => void api().invoke('highlights:open', highlight.id)}>
                    {highlight.text}
                  </button>
                  <NoteField highlight={highlight} onSaved={load} />
                </div>
                <IconButton size="sm" label="Remove highlight" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('highlights:remove', highlight.id).then(load)}>
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
