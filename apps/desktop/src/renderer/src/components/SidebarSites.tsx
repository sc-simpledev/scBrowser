import { ArrowLeft, ExternalLink, Plus, RotateCw, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { MAX_SIDEBAR_SITES, type SidebarSite, type SidebarSiteState } from '@scbrowser/shared'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useApp } from '../state/app'

const MIN_WIDTH = 300
const MAX_WIDTH = 720

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)

/** The open sidebar site, shared by the rail and the panel. */
function useSidebarState() {
  const [state, setState] = useState<SidebarSiteState | null>(null)
  useEffect(() => {
    void window.scb.invoke('sidebar-sites:state').then(setState)
    return window.scb.on('sidebar-sites:changed', setState)
  }, [])
  return state
}

/**
 * A site's icon from its bookmark, which is saved on this computer, or its first letter. The rail
 * never fetches icons itself, so drawing it contacts nobody.
 */
function SiteIcon({ site }: { site: SidebarSite }) {
  const icon = useApp((s) => s.bookmarks.find((bookmark) => bookmark.icon && hostOf(bookmark.url) === hostOf(site.url))?.icon ?? null)
  if (icon) return <img src={icon} alt="" className="size-4 rounded-sm" draggable={false} />
  return <span className="grid size-5 place-items-center rounded-sm bg-surface-active text-2xs font-semibold text-text-muted uppercase">{hostOf(site.url).charAt(0)}</span>
}

/** A slim column at the window's right edge with a button for each sidebar site. */
export function SidebarRail() {
  const sites = useApp((s) => s.settings.sidebarSites)
  const state = useSidebarState()
  if (sites.length === 0) return null
  return (
    <nav aria-label="Sidebar sites" className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-bg py-2">
      {sites.map((site) => {
        const open = state?.home === site.url
        return (
          <IconButton
            key={site.url}
            label={site.title || hostOf(site.url)}
            aria-pressed={open}
            className={cx('relative', open && 'bg-surface-active')}
            onClick={() => void window.scb.invoke('sidebar-sites:toggle', site.url)}
            onContextMenu={(e) => {
              e.preventDefault()
              void window.scb.invoke('sidebar-sites:menu', site.url, e.clientX, e.clientY)
            }}
          >
            {open && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-[-6px] w-0.5 rounded-full bg-accent" />}
            <SiteIcon site={site} />
          </IconButton>
        )
      })}
      {sites.length < MAX_SIDEBAR_SITES && (
        <IconButton label="Add this page to the sidebar" onClick={() => void window.scb.invoke('sidebar-sites:add-current')}>
          <Plus size={14} strokeWidth={1.75} />
        </IconButton>
      )}
    </nav>
  )
}

/** The open site's panel. Its page is a native view drawn over the empty area here. */
export function SidebarSitePanel() {
  const state = useSidebarState()
  const savedWidth = useApp((s) => s.settings.sidebarSiteWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? savedWidth
  const slot = useRef<HTMLDivElement>(null)
  const open = state !== null

  useLayoutEffect(() => {
    const element = slot.current
    if (!element) return
    const report = () => {
      const { x, y, width: w, height } = element.getBoundingClientRect()
      void window.scb.invoke('sidebar-sites:rect', { x, y, width: w, height })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [open])

  if (!state) return null
  const act = (action: 'back' | 'reload' | 'open-tab' | 'close') => void window.scb.invoke('sidebar-sites:action', action)
  return (
    <aside aria-label={`${state.title || hostOf(state.url)} in the sidebar`} className="relative flex shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
      <ResizeHandle
        label="Sidebar site width"
        edge="left"
        width={width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        onWidth={setDragWidth}
        onCommit={(sidebarSiteWidth) => void window.scb.invoke('settings:set', { sidebarSiteWidth })}
        onDragging={(dragging) => void window.scb.invoke('layout:resizing', dragging)}
      />
      <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border pr-1 pl-1">
        <IconButton size="sm" label="Back" disabled={!state.canGoBack} onClick={() => act('back')}>
          <ArrowLeft size={14} strokeWidth={1.75} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate px-1 font-medium">{state.title || hostOf(state.url)}</span>
        <IconButton size="sm" label="Reload" onClick={() => act('reload')}>
          <RotateCw size={13} strokeWidth={1.75} className={state.loading ? 'animate-spin' : undefined} />
        </IconButton>
        <IconButton size="sm" label="Open as tab" onClick={() => act('open-tab')}>
          <ExternalLink size={13} strokeWidth={1.75} />
        </IconButton>
        <IconButton size="sm" label="Close" onClick={() => act('close')}>
          <X size={14} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div ref={slot} className="min-h-0 flex-1" />
    </aside>
  )
}
