import { Pin, TextSearch, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '@scbrowser/ui'
import { matchTabs, MIN_TAB_TEXT_QUERY, PALETTE_POPUP, type TabSearchRow, type TabTextMatch } from '@scbrowser/shared'
import { Favicon } from '../components/Favicon'

const ROW_HEIGHT = 44
/** Pages are read after a short pause in typing, not on every key. */
const TEXT_DELAY_MS = 220

type Item = { kind: 'tab'; row: TabSearchRow } | { kind: 'text'; row: TabSearchRow; match: TabTextMatch }

/** Matches inside pages for the typed words, read in the main process; stale answers are dropped. */
function useTextMatches(query: string): TabTextMatch[] {
  const [matches, setMatches] = useState<TabTextMatch[]>([])
  useEffect(() => {
    const words = query.trim()
    if (words.length < MIN_TAB_TEXT_QUERY) return setMatches([])
    let current = true
    const timer = setTimeout(() => {
      void window.scbOverlay.invoke('overlay:tab-search-text', words).then((found) => current && setMatches(found))
    }, TEXT_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])
  return matches
}

export function TabSearch({ rows, x, y }: { rows: TabSearchRow[]; x: number; y: number }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const byKeyboard = useRef(false)
  const found = useMemo(() => matchTabs(query, rows), [query, rows])
  const textMatches = useTextMatches(query)
  // Title and address matches first, then words inside pages, in the order the tabs are used.
  const items = useMemo((): Item[] => {
    const byId = new Map(rows.map((row) => [row.id, row]))
    const inPages = textMatches.flatMap((match) => {
      const row = byId.get(match.id)
      return row ? [{ kind: 'text' as const, row, match }] : []
    })
    return [...found.map((row) => ({ kind: 'tab' as const, row })), ...inPages.toSorted((a, b) => b.row.lastActiveAt - a.row.lastActiveAt)]
  }, [found, textMatches, rows])
  // Closing a row can leave the selection past the end.
  const current = Math.min(selected, Math.max(0, items.length - 1))
  const firstText = items.findIndex((item) => item.kind === 'text')

  const close = () => void window.scbOverlay.invoke('overlay:tab-search-close')
  const pick = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === 'text') void window.scbOverlay.invoke('overlay:tab-search-pick', item.row.id, query.trim())
    else void window.scbOverlay.invoke('overlay:tab-search-pick', item.row.id)
  }

  useEffect(() => {
    inputRef.current?.focus()
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [])

  // Only the keyboard scrolls the list: following the pointer would move rows out from under it.
  useEffect(() => {
    if (byKeyboard.current) listRef.current?.querySelector(`[data-item="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <div
      role="dialog"
      aria-label="Search tabs"
      className="sc-glass-strong sc-tooltip absolute flex flex-col overflow-hidden rounded-lg shadow-3"
      style={{ left: x, top: y, width: PALETTE_POPUP.width, height: PALETTE_POPUP.height }}
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded
        aria-label="Search tabs"
        placeholder="Search tabs and the words in them"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') pick(items[current])
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            byKeyboard.current = true
            if (items.length > 0) setSelected((current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
          }
        }}
        className="h-11 shrink-0 border-b border-border bg-transparent px-3 text-md text-text outline-none placeholder:text-text-faint"
      />
      <ul ref={listRef} role="listbox" aria-label="Tabs" className="min-h-0 flex-1 overflow-y-auto p-1">
        {items.length === 0 && (
          <li className="px-2.5 py-2 text-text-muted">{query.trim().length >= MIN_TAB_TEXT_QUERY ? 'No tab has those words.' : 'No matching tabs.'}</li>
        )}
        {items.map((item, index) => {
          const { row } = item
          return (
            <li key={`${item.kind}:${row.id}`} role="presentation" className="contents">
              {index === firstText && (
                <div role="presentation" className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1 text-2xs font-medium text-text-faint">
                  <TextSearch aria-hidden size={12} strokeWidth={1.75} />
                  In pages
                </div>
              )}
              <div
                role="option"
                data-item={index}
                aria-selected={index === current}
                style={{ minHeight: ROW_HEIGHT }}
                // Rows sliding under a still pointer fire mouse events too; only real movement counts.
                onMouseMove={(e) => {
                  if (e.movementX === 0 && e.movementY === 0) return
                  byKeyboard.current = false
                  setSelected(index)
                }}
                onClick={() => pick(item)}
                className={cx('flex items-center gap-2.5 rounded-md px-2.5 py-1', index === current && 'bg-accent-soft')}
              >
                <Favicon url={row.faviconUrl} pageUrl={row.url} isLoading={row.isLoading} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.title}</span>
                  {item.kind === 'text' ? (
                    <span className="block truncate text-xs text-text-muted">
                      {item.match.before}
                      <mark className="bg-transparent font-semibold text-text">{item.match.match}</mark>
                      {item.match.after}
                    </span>
                  ) : (
                    <span className="block truncate text-xs text-text-muted">{row.url}</span>
                  )}
                </span>
                {item.kind === 'text' && item.match.count > 1 && <span className="shrink-0 text-2xs text-text-faint tabular-nums">{item.match.count >= 99 ? '99+' : item.match.count} matches</span>}
                {row.workspaceName && <span className="max-w-28 shrink-0 truncate text-2xs text-text-faint">{row.workspaceName}</span>}
                {row.pinned && <Pin role="img" aria-label="Pinned" size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
                {row.muted ? (
                  <VolumeX role="img" aria-label="Muted" size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                ) : (
                  row.audible && <Volume2 role="img" aria-label="Playing sound" size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
                )}
                {item.kind === 'tab' && (
                  <button
                    type="button"
                    aria-label={`Close ${row.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.scbOverlay.invoke('overlay:tab-search-remove', row.id)
                    }}
                    className="grid size-6 shrink-0 place-items-center rounded-sm text-text-faint transition-colors hover:bg-surface-active hover:text-text"
                  >
                    <X aria-hidden size={13} strokeWidth={2} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
