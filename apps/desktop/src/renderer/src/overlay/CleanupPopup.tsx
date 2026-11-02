import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, cx } from '@scbrowser/ui'
import { CLEANUP_POPUP, type CleanupPopupState } from '@scbrowser/shared'

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host || url : url)

/** Tabs suggested for closing. Nothing closes until the person says so. */
export function CleanupPopup({ cleanup, x, y }: { cleanup: CleanupPopupState; x: number; y: number }) {
  const [kept, setKept] = useState<number[]>([])
  const closeButton = useRef<HTMLButtonElement>(null)
  const count = cleanup.rows.length - kept.length
  const dismiss = () => void window.scbOverlay.invoke('overlay:cleanup', null)
  useEffect(() => closeButton.current?.focus(), [])

  return (
    <div
      role="dialog"
      aria-label="Clean up tabs"
      className="sc-glass-strong sc-tooltip absolute flex flex-col overflow-hidden rounded-lg shadow-3"
      style={{ left: x, top: y, width: CLEANUP_POPUP.width, maxHeight: CLEANUP_POPUP.height }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') dismiss()
      }}
    >
      <header className="shrink-0 border-b border-border px-3 py-2.5">
        <h2 className="text-md font-medium">Clean up tabs</h2>
        <p className="text-xs text-text-muted">These look finished with. Untick any you want to keep.</p>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {cleanup.rows.map((row) => {
          const on = !kept.includes(row.id)
          return (
            <li key={row.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setKept(on ? [...kept, row.id] : kept.filter((id) => id !== row.id))}
                className="flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-surface-hover"
              >
                <span aria-hidden className={cx('grid size-4 shrink-0 place-items-center rounded-sm transition-colors', on ? 'bg-accent text-on-accent' : 'shadow-[0_0_0_1px_var(--sc-border-strong)]')}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.title}</span>
                  <span className="block truncate text-xs text-text-faint">{hostOf(row.url)}</span>
                </span>
                <span className="shrink-0 text-2xs text-text-muted">{row.reason}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-border px-2">
        <Button onClick={dismiss}>Cancel</Button>
        <Button
          ref={closeButton}
          variant="primary"
          disabled={count === 0}
          onClick={() => void window.scbOverlay.invoke('overlay:cleanup', cleanup.rows.flatMap(({ id }) => (kept.includes(id) ? [] : [id])))}
        >
          Close {count} {count === 1 ? 'tab' : 'tabs'}
        </Button>
      </footer>
    </div>
  )
}
