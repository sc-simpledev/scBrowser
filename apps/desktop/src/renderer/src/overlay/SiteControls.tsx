import { ChevronRight, Lock, Minus, Plus, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button, Select, Switch } from '@scbrowser/ui'
import { SITE_POPUP, siteControlsHeight, type SiteAction, type SiteControlsState, type SiteFont } from '@scbrowser/shared'

const act = (action: SiteAction) => void window.scbOverlay.invoke('overlay:site-action', action)
const close = () => void window.scbOverlay.invoke('overlay:site-close')

function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3" style={{ height: SITE_POPUP.row }}>
      <div className="min-w-0">
        <div className="truncate">{label}</div>
        {hint && <div className="truncate text-xs text-text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

/** Everything about the open site in one place, under the padlock. Changes apply at once. */
export function SiteControls({ state, x, y }: { state: SiteControlsState; x: number; y: number }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.focus()
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [])
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label={`Controls for ${state.site}`}
      className="sc-glass-strong sc-tooltip absolute flex flex-col overflow-hidden rounded-lg shadow-3 outline-none"
      style={{ left: x, top: y, width: SITE_POPUP.width, height: siteControlsHeight(state) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3" style={{ height: SITE_POPUP.header }}>
        {state.secure ? <Lock aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" /> : <TriangleAlert aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-danger" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{state.site}</div>
          <div className={state.secure ? 'truncate text-xs text-text-faint' : 'truncate text-xs text-danger'} title={state.secure ? undefined : 'Others on the network can see this page and what you type in it.'}>
            {state.secure ? 'Secure connection' : 'Not secure'}
          </div>
        </div>
        <button type="button" aria-label="Close" onClick={close} className="grid size-6 shrink-0 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text">
          <X aria-hidden size={13} strokeWidth={2} />
        </button>
      </div>
      <div className="flex flex-col py-1">
        <div className="flex items-center justify-between gap-3 px-3" style={{ height: SITE_POPUP.row }}>
          <div className="min-w-0">
            <div className="truncate">Tracking protection</div>
            {state.tracking && state.blocked > 0 ? (
              <button type="button" aria-expanded={state.blockedOpen} onClick={() => act('blocked-toggle')} className="flex items-center gap-0.5 text-xs text-text-faint hover:text-text">
                {state.blocked} blocked on this page
                <ChevronRight aria-hidden size={11} strokeWidth={2} className={state.blockedOpen ? 'rotate-90' : ''} />
              </button>
            ) : (
              <div className="truncate text-xs text-text-faint">{state.tracking === null ? 'Off everywhere, in Settings' : state.tracking ? 'Nothing blocked on this page' : 'Off for this site'}</div>
            )}
          </div>
          {state.tracking !== null && <Switch label="Tracking protection on this site" checked={state.tracking} onChange={() => act('tracking')} />}
        </div>
        {state.blockedOpen && (
          <ul aria-label="Blocked on this page" className="flex flex-col pb-2">
            {state.blockedHosts.map(({ host, count }) => (
              <li key={host} className="flex items-center justify-between gap-3 px-3 text-xs text-text-muted" style={{ height: SITE_POPUP.blockedRow }}>
                <span className="min-w-0 truncate">{host}</span>
                <span className="shrink-0 text-text-faint tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
        <Line label="AI on this site" hint={state.ai ? 'Pages can be sent when you ask' : 'Never sent to AI'}>
          <Switch label="Allow AI on this site" checked={state.ai} onChange={() => act('ai')} />
        </Line>
        <Line label="Forget when scTerra closes" hint="Signs you out each time">
          <Switch label="Forget this site when scTerra closes" checked={state.forgetOnClose} onChange={() => act('forget-on-close')} />
        </Line>
        <Line label="Zoom">
          <div className="flex items-center gap-0.5">
            <button type="button" aria-label="Zoom out" onClick={() => act('zoom-out')} className="grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text">
              <Minus aria-hidden size={13} strokeWidth={2} />
            </button>
            <button type="button" aria-label="Reset zoom" title="Reset zoom" onClick={() => act('zoom-reset')} className="h-7 w-12 rounded-md text-xs tabular-nums hover:bg-surface-hover">
              {state.zoom}%
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => act('zoom-in')} className="grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text">
              <Plus aria-hidden size={13} strokeWidth={2} />
            </button>
          </div>
        </Line>
        <Line label="Font">
          <Select aria-label="Font on this site" className="w-28" value={state.font} onChange={(e) => act(`font:${e.target.value as SiteFont}`)}>
            <option value="default">Site’s own</option>
            <option value="sans">Sans</option>
            <option value="serif">Serif</option>
            <option value="mono">Mono</option>
          </Select>
        </Line>
      </div>
      {state.permissions.length > 0 && (
        <div className="flex flex-col border-t border-border">
          <div className="flex h-7 items-end px-3 text-2xs font-medium text-text-faint">Permissions</div>
          {state.permissions.map((permission) => (
            <div key={permission.permission} className="flex items-center justify-between gap-3 px-3" style={{ height: SITE_POPUP.permissionRow }}>
              <span className="min-w-0 truncate">
                {permission.label}
                <span className="text-text-faint">{permission.allowed ? ' · allowed' : ' · blocked'}</span>
              </span>
              <button type="button" onClick={() => act(`permission:${permission.permission}`)} className="h-6 shrink-0 rounded-md px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text">
                Reset
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t border-border px-2" style={{ height: SITE_POPUP.footer }}>
        <Button variant="ghost" onClick={() => act('forget-now')}>
          Forget this site…
        </Button>
        <Button variant="ghost" onClick={() => act('settings')}>
          Privacy settings
        </Button>
      </div>
    </div>
  )
}
