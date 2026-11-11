import { BookMarked, Check, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import type { ReadingItem } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState } from '../EmptyState'
import { ReplyMarkdown } from '../../shared/ReplyContent'

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') || url : url)
const cleanError = (error: Error) => error.message.replace(/^.*Error: /, '')
const openLink = (href: string) => void api().invoke('browser:open', href)

function ReadingRow({ item, reload }: { item: ReadingItem; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const read = item.readAt !== null
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <button type="button" className={cx('block max-w-full truncate text-left font-medium', read && 'text-text-muted')} onClick={() => void api().invoke('reading:open', item.id).then(reload)}>
            {item.title || item.url}
          </button>
          <div className="truncate text-xs text-text-faint">
            {hostOf(item.url)} · Saved {new Date(item.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </div>
        </div>
        {item.summary ? (
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide summary' : 'Summary'}
          </Button>
        ) : (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setProblem(null)
              void api()
                .invoke('reading:summarise', item.id)
                .then(() => {
                  setOpen(true)
                  reload()
                })
                .catch((error: Error) => setProblem(cleanError(error)))
                .finally(() => setBusy(false))
            }}
          >
            <Sparkles aria-hidden size={12} strokeWidth={1.75} className="text-accent" />
            {busy ? 'Summarising…' : 'Summarise'}
          </Button>
        )}
        <IconButton size="sm" label={read ? 'Mark as unread' : 'Mark as read'} aria-pressed={read} onClick={() => void api().invoke('reading:set-read', item.id, !read).then(reload)}>
          <Check size={12} strokeWidth={2} className={read ? 'text-accent' : undefined} />
        </IconButton>
        <IconButton size="sm" label="Remove from reading list" onClick={() => void api().invoke('reading:remove', item.id).then(reload)}>
          <X size={12} strokeWidth={2} />
        </IconButton>
      </div>
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      {open && item.summary && (
        <div className="rounded-md border border-border px-3 py-2 text-sm">
          <ReplyMarkdown text={item.summary} onOpenLink={openLink} />
        </div>
      )}
    </li>
  )
}

/** Pages saved to read later. Summaries are only made when asked for, with the person's own AI. */
export function ReadingPage() {
  const [items, setItems] = useState<ReadingItem[] | null>(null)
  const [show, setShow] = useState<'unread' | 'all'>('unread')
  const [batch, setBatch] = useState<{ done: number; total: number; failed: number } | null>(null)
  const load = useCallback(() => void api().invoke('reading:list').then(setItems), [])
  useEffect(() => {
    load()
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [load])
  if (!items) return null
  const unread = items.filter((item) => item.readAt === null)
  const shown = show === 'unread' ? unread : items
  const waiting = unread.filter((item) => !item.summary)
  // One at a time, so the AI isn't sent several pages at once, and one failure doesn't stop the rest.
  const summariseAll = async () => {
    const queue = waiting
    let failed = 0
    setBatch({ done: 0, total: queue.length, failed })
    for (const [index, item] of queue.entries()) {
      await api()
        .invoke('reading:summarise', item.id)
        .catch(() => failed++)
      setBatch({ done: index + 1, total: queue.length, failed })
      load()
    }
    setTimeout(() => setBatch(null), failed ? 6000 : 2500)
  }
  return (
    <>
      <div role="group" aria-label="Show" className="flex items-center gap-1.5 text-xs">
        {(
          [
            ['unread', `Unread ${unread.length}`],
            ['all', `All ${items.length}`]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={show === value}
            onClick={() => setShow(value)}
            className={cx('flex h-6 items-center rounded-sm border px-2', show === value ? 'border-(--sc-accent) text-text' : 'border-border text-text-muted hover:bg-surface-hover')}
          >
            {label}
          </button>
        ))}
        {batch ? (
          <span role="status" className="ml-auto text-text-muted tabular-nums">
            {batch.done < batch.total ? `Summarising ${batch.done + 1} of ${batch.total}…` : `Summarised ${batch.total - batch.failed} of ${batch.total}${batch.failed ? `. ${batch.failed} couldn't be read.` : '.'}`}
          </span>
        ) : (
          <button
            type="button"
            disabled={waiting.length === 0}
            title="Sends each unread page's text to your AI, one at a time."
            onClick={() => void summariseAll()}
            className="ml-auto flex h-6 items-center gap-1 rounded-sm border border-border px-2 text-text-muted hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
          >
            <Sparkles aria-hidden size={11} strokeWidth={1.75} className="text-accent" />
            Summarise unread{waiting.length > 0 ? ` (${waiting.length})` : ''}
          </button>
        )}
        <button
          type="button"
          disabled={unread.length === 0}
          title="Only titles, addresses and summaries go to the AI, not the pages."
          onClick={() => void api().invoke('reading:digest')}
          className="flex h-6 items-center rounded-sm border border-border px-2 text-text-muted hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
        >
          Digest of unread
        </button>
      </div>
      <p className="-mt-3 text-xs text-text-faint">Summarise sends that page's text to your AI. A digest sends only titles, addresses and summaries.</p>
      {items.length === 0 && <EmptyState icon={BookMarked} title="Nothing saved yet">Right-click a page and pick Add to reading list.</EmptyState>}
      {items.length > 0 && shown.length === 0 && <p className="text-text-muted">All read. Nice.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <ReadingRow key={item.id} item={item} reload={load} />
        ))}
      </ul>
    </>
  )
}
