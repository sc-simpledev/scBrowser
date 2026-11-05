import { Pin, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '@scbrowser/ui'
import { matchTabs, PALETTE_POPUP, type TabSearchRow } from '@scbrowser/shared'
import { Favicon } from '../components/Favicon'

const ROW_HEIGHT = 44

export function TabSearch({ rows, x, y }: { rows: TabSearchRow[]; x: number; y: number }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const byKeyboard = useRef(false)
  const found = useMemo(() => matchTabs(query, rows), [query, rows])
  // Closing a row can leave the selection past the end.
  const current = Math.min(selected, Math.max(0, found.length - 1))

  const close = () => void window.scbOverlay.invoke('overlay:tab-search-close')
  const pick = (id: number | undefined) => {
    if (id !== undefined) void window.scbOverlay.invoke('overlay:tab-search-pick', id)
  }

  useEffect(() => {
    inputRef.current?.focus()
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [])

  // Only the keyboard scrolls the list: following the pointer would move rows out from under it.
  useEffect(() => {
    if (byKeyboard.current) listRef.current?.children[current]?.scrollIntoView({ block: 'nearest' })
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
        placeholder="Search tabs"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') pick(found[current]?.id)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            byKeyboard.current = true
            if (found.length > 0) setSelected((current + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length)
          }
        }}
        className="h-11 shrink-0 border-b border-border bg-transparent px-3 text-md text-text outline-none placeholder:text-text-faint"
      />
      <ul ref={listRef} role="listbox" aria-label="Tabs" className="min-h-0 flex-1 overflow-y-auto p-1">
        {found.length === 0 && <li className="px-2.5 py-2 text-text-muted">No matching tabs.</li>}
        {found.map((row, index) => (
          <li
            key={row.id}
            role="option"
            aria-selected={index === current}
            style={{ height: ROW_HEIGHT }}
            // Rows sliding under a still pointer fire mouse events too; only real movement counts.
            onMouseMove={(e) => {
              if (e.movementX === 0 && e.movementY === 0) return
              byKeyboard.current = false
              setSelected(index)
            }}
            onClick={() => pick(row.id)}
            className={cx('flex items-center gap-2.5 rounded-md px-2.5', index === current && 'bg-accent-soft')}
          >
            <Favicon url={row.faviconUrl} pageUrl={row.url} isLoading={row.isLoading} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.title}</span>
              <span className="block truncate text-xs text-text-muted">{row.url}</span>
            </span>
            {row.workspaceName && <span className="max-w-28 shrink-0 truncate text-2xs text-text-faint">{row.workspaceName}</span>}
            {row.pinned && <Pin role="img" aria-label="Pinned" size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
            {row.muted ? (
              <VolumeX role="img" aria-label="Muted" size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
            ) : (
              row.audible && <Volume2 role="img" aria-label="Playing sound" size={13} strokeWidth={1.75} className="shrink-0 text-accent" />
            )}
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
          </li>
        ))}
      </ul>
    </div>
  )
}
