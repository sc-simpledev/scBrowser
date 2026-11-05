import { EllipsisVertical, Pin, PinOff, Puzzle, Settings, Store } from 'lucide-react'
import { useEffect } from 'react'
import { cx } from '@scbrowser/ui'
import { EXTENSIONS_POPUP, type ExtensionsPopupState } from '@scbrowser/shared'

const act = (action: 'open' | 'pin' | 'menu' | 'store' | 'manage', id = '', x = 0, y = 0) => void window.scbOverlay.invoke('overlay:extensions-action', action, id, x, y)
const close = () => void window.scbOverlay.invoke('overlay:extensions-close')

const ROW = 'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-surface-hover'
const SMALL = 'grid size-7 shrink-0 place-items-center rounded-sm text-text-faint transition-colors hover:bg-surface-active hover:text-text'

/** The list hanging from the toolbar's Extensions button. Picking one opens its page right below. */
export function ExtensionsPopup({ popup, x, y }: { popup: ExtensionsPopupState; x: number; y: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  return (
    <div
      role="dialog"
      aria-label="Extensions"
      className="sc-glass-strong sc-tooltip absolute flex flex-col overflow-hidden rounded-lg p-1 shadow-3"
      style={{ left: x, top: y, width: EXTENSIONS_POPUP.width, height: popup.height }}
    >
      <ul aria-label="Installed extensions" className="min-h-0 flex-1 overflow-y-auto">
        {popup.rows.length === 0 && <li className="px-2 py-2 text-text-muted">No extensions yet.</li>}
        {popup.rows.map((row) => (
          <li key={row.id} className="flex items-center gap-0.5">
            <button type="button" onClick={() => act('open', row.id)} className={cx(ROW, 'flex-1')}>
              {row.icon ? <img src={row.icon} alt="" className="size-4 shrink-0" /> : <Puzzle aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />}
              <span className="truncate">{row.name}</span>
            </button>
            {row.hasAction && (
              <button type="button" aria-label={`${row.pinned ? 'Unpin' : 'Pin'} ${row.name}`} title={row.pinned ? 'Unpin from the toolbar' : 'Pin to the toolbar'} onClick={() => act('pin', row.id)} className={SMALL}>
                {row.pinned ? <Pin aria-hidden size={13} strokeWidth={1.75} className="text-accent" /> : <PinOff aria-hidden size={13} strokeWidth={1.75} />}
              </button>
            )}
            <button
              type="button"
              aria-label={`More for ${row.name}`}
              onClick={(e) => act('menu', row.id, popup.x + e.currentTarget.offsetLeft, popup.y + e.currentTarget.getBoundingClientRect().bottom - y)}
              className={SMALL}
            >
              <EllipsisVertical aria-hidden size={13} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 shrink-0 border-t border-border pt-1">
        <button type="button" onClick={() => act('store')} className={ROW}>
          <Store aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />
          Get more extensions
        </button>
        <button type="button" onClick={() => act('manage')} className={ROW}>
          <Settings aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />
          Manage extensions
        </button>
      </div>
    </div>
  )
}
