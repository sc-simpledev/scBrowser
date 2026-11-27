import { ArrowLeft, Check, ChevronRight, Copy, Lock, Minus, Plus, QrCode, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select, Switch } from '@scbrowser/ui'
import { encodeQr, qrPath, siteBlockWord, SITE_POPUP, siteControlsHeight, type SiteAction, type SiteControlsState, type SiteFont } from '@scbrowser/shared'

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

/** The page's address as a QR code, drawn here: nothing about it leaves the computer. */
function QrView({ url }: { url: string }) {
  const code = useMemo(() => encodeQr(url), [url])
  const [copied, setCopied] = useState(false)
  const shown = url.replace(/^https?:\/\/(www\.)?/, '')
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-3" style={{ height: SITE_POPUP.qr }}>
      {code ? (
        <svg role="img" aria-label={`QR code for ${url}`} viewBox={`0 0 ${code.size + 8} ${code.size + 8}`} shapeRendering="crispEdges" className="size-52 shrink-0 rounded-md bg-[white]">
          <path d={qrPath(code)} fill="black" />
        </svg>
      ) : (
        <p className="grid size-52 place-items-center text-center text-xs text-text-muted">This address is too long for a QR code.</p>
      )}
      <div className="flex w-full min-w-0 items-center gap-1">
        <span title={url} className="min-w-0 flex-1 truncate text-center text-xs text-text-muted">
          {shown}
        </span>
        {/* A plain button: the popups have no tooltip provider for the UI kit's IconButton. */}
        <button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy link'}
          onClick={() => {
            act('copy-link')
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="grid size-6 shrink-0 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
        >
          {copied ? <Check aria-hidden size={12} strokeWidth={2} /> : <Copy aria-hidden size={12} strokeWidth={1.75} />}
        </button>
      </div>
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
        <button type="button" aria-label={state.qrOpen ? 'Back to the site’s controls' : 'QR code for this page'} title={state.qrOpen ? undefined : 'QR code, to open this page on a phone'} onClick={() => act('qr-toggle')} className="grid size-6 shrink-0 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text">
          {state.qrOpen ? <ArrowLeft aria-hidden size={13} strokeWidth={2} /> : <QrCode aria-hidden size={13} strokeWidth={1.75} />}
        </button>
        <button type="button" aria-label="Close" onClick={close} className="grid size-6 shrink-0 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text">
          <X aria-hidden size={13} strokeWidth={2} />
        </button>
      </div>
      {state.qrOpen ? (
        <QrView url={state.url} />
      ) : (
      <>
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
        {state.workspaces.length > 1 && (
          <Line label="Opens in" hint={state.workspace ? 'Links and addresses for it go there' : 'Whichever workspace you’re in'}>
            <Select aria-label="Workspace this site always opens in" className="w-28" value={state.workspace ?? ''} onChange={(e) => act(`workspace:${e.target.value}`)}>
              <option value="">Any</option>
              {state.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </Line>
        )}
      </div>
      <div className="flex flex-col border-t border-border">
        <button
          type="button"
          aria-expanded={state.contentOpen}
          onClick={() => act('content-toggle')}
          className="flex items-center justify-between gap-3 px-3 text-left hover:bg-surface-hover"
          style={{ height: SITE_POPUP.permissionRow }}
        >
          <span className="min-w-0 truncate">
            Site settings
            {!state.contentOpen && state.content.some((row) => row.blocked && !row.locked) && (
              <span className="text-text-faint"> · {state.content.filter((row) => row.blocked && !row.locked).map((row) => siteBlockWord(row.label)).join(', ')} blocked</span>
            )}
          </span>
          <ChevronRight aria-hidden size={13} strokeWidth={2} className={state.contentOpen ? 'shrink-0 rotate-90 text-text-faint' : 'shrink-0 text-text-faint'} />
        </button>
        {state.contentOpen && (
          <div className="flex flex-col pb-1">
            {state.content.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-3" style={{ height: SITE_POPUP.permissionRow }}>
                <div className="min-w-0">
                  <div className="truncate text-sm">{row.label}</div>
                  <div className={row.blocked && !row.locked ? 'truncate text-2xs text-danger' : 'truncate text-2xs text-text-faint'}>{row.hint}</div>
                </div>
                {!row.locked && <Switch label={`${row.label} on ${state.site}`} checked={!row.blocked} onChange={() => act(`content:${row.id}`)} />}
              </div>
            ))}
          </div>
        )}
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
      </>
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
