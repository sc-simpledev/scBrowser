import { ChevronDown, ChevronRight, Moon, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { cx } from '@scbrowser/ui'
import { CONTAINERS, isNewTabUrl, type TabState } from '@scbrowser/shared'
import { useApp } from '../state/app'
import { useOverlay } from '../state/overlay'
import { useTabs } from '../state/tabs'
import { endTabDrag, startTabDrag } from '../state/tabDrag'
import { Favicon } from './Favicon'

const fullTitle = (tab: TabState) => tab.title || (isNewTabUrl(tab.url) ? 'New tab' : tab.url)
/** A title tidied by the AI when there is one; the full one shows on hover. */
const tabTitle = (tab: TabState) => tab.shortTitle || fullTitle(tab)

const HOVER_CARD_DELAY_MS = 600

/** Where a tab is, in a word: the site's host, or scTerra for its own pages. */
function placeOf(url: string): string {
  if (isNewTabUrl(url)) return 'New tab'
  if (url.startsWith('sc://')) return 'scTerra'
  try {
    return new URL(url).host.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

const memoryText = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(kb / 1024))} MB`)

/** The second line of a side tab's hover card: where it is, and what it's costing. */
function cardDetail(tab: TabState, memoryKb: number | null): string {
  const parts = [placeOf(tab.url)]
  if (tab.isSleeping) parts.push('Sleeping')
  else if (memoryKb) parts.push(`${memoryText(memoryKb)} memory`)
  if (tab.muted) parts.push('Muted')
  return parts.join(' · ')
}

/**
 * A small card beside a side tab after the pointer rests on it: the whole title, the site and how
 * much memory it uses. Drawn in the overlay like tooltips, so it clears the moment the pointer moves on.
 */
function useHoverCard(tab: TabState, enabled: boolean, placement: 'right' | 'below', withPreview: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shown = useRef(false)
  /** Still under the pointer, checked once the memory figure comes back. */
  const inside = useRef(false)
  const current = useRef(tab)
  current.current = tab
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    inside.current = false
    if (!shown.current) return
    shown.current = false
    useOverlay.getState().setTooltip(null)
  }, [])
  useEffect(() => hide, [hide])
  const show = (element: HTMLElement) => {
    clearTimeout(timer.current)
    if (!enabled) return
    inside.current = true
    timer.current = setTimeout(async () => {
      const latest = current.current
      const [memory, image] = await Promise.all([
        latest.isSleeping ? null : window.scb.invoke('tabs:memory', latest.id).catch(() => null),
        withPreview ? window.scb.invoke('tabs:preview', latest.id).catch(() => null) : null
      ])
      if (!element.isConnected || !inside.current) return
      const { x, y, width, height } = element.getBoundingClientRect()
      shown.current = true
      useOverlay.getState().setTooltip({ anchor: { x, y, width, height }, label: fullTitle(latest), detail: cardDetail(latest, memory), placement, ...(image ? { image } : {}) })
    }, HOVER_CARD_DELAY_MS)
  }
  return { show, hide }
}

interface TabProps {
  tab: TabState
  active: boolean
  /** Showing beside the active tab in split view. */
  split: boolean
  layout: 'horizontal' | 'vertical' | 'rail'
  index: number
  draggingId: number | null
  onDragState: (id: number | null) => void
  /** Its place in the tab tree: whether it has a branch, folded or not, and how many tabs the fold holds. */
  fold?: { collapsed: boolean; count: number }
}

/** Shows when a tab has sound or is muted, and switches that with a click. */
function AudioButton({ tab, corner }: { tab: TabState; corner: boolean }) {
  if (!tab.audible && !tab.muted) return null
  const Icon = tab.muted ? VolumeX : Volume2
  return (
    <button
      type="button"
      aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
      title={tab.muted ? 'Unmute tab' : 'Mute tab'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => void window.scb.invoke('tabs:mute', tab.id, !tab.muted)}
      className={cx(
        'grid shrink-0 place-items-center rounded-sm transition-colors hover:bg-surface-active hover:text-text',
        tab.muted ? 'text-text-faint' : 'text-accent',
        // Tabs that are only an icon carry it on a corner.
        corner ? 'absolute top-0.5 right-0.5 size-3.5 bg-surface' : 'size-5 @max-[64px]:hidden'
      )}
    >
      <Icon aria-hidden size={corner ? 10 : 13} strokeWidth={2} />
    </button>
  )
}

/** The rail has no room for a button, so the favicon turns into an X when the pointer is on it. */
function FaviconCloseButton({ tab, onClose }: { tab: TabState; onClose: () => void }) {
  return (
    <span className="group/icon relative grid size-5 shrink-0 place-items-center">
      <span className="grid place-items-center group-hover/icon:opacity-0 group-focus-within/icon:opacity-0">
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
      </span>
      <button
        type="button"
        aria-label="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        className="absolute inset-0 grid place-items-center rounded-sm bg-surface-active text-text opacity-0 transition-opacity group-hover/icon:opacity-100 focus-visible:opacity-100"
      >
        <X size={12} strokeWidth={2.25} />
      </button>
    </span>
  )
}

/** A tab's icon that folds its branch: the icon until the pointer is on it, then which way it'll go. */
function FoldButton({ tab, collapsed }: { tab: TabState; collapsed: boolean }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <button
      type="button"
      aria-label={collapsed ? 'Expand branch' : 'Collapse branch'}
      aria-expanded={!collapsed}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => void window.scb.invoke('tabs:collapse', tab.id)}
      className="group/fold relative grid size-5 shrink-0 place-items-center rounded-sm hover:bg-surface-active"
    >
      <span className="grid place-items-center group-hover/fold:opacity-0 group-focus-visible/fold:opacity-0">
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
      </span>
      <Chevron aria-hidden size={13} strokeWidth={2} className="absolute text-text-muted opacity-0 group-hover/fold:opacity-100 group-focus-visible/fold:opacity-100" />
    </button>
  )
}

export function Tab({ tab, active, split, layout, index, draggingId, onDragState, fold }: TabProps) {
  const close = () => void window.scb.invoke('tabs:close', tab.id)
  const side = layout !== 'horizontal'
  const iconOnly = tab.pinned || layout === 'rail'
  const container = CONTAINERS.find((c) => c.id === tab.container)
  const sleepButton = useApp((s) => s.settings.tabSleepButton) && !iconOnly && !tab.isSleeping
  // The tab tree: branches step in under the tab they were opened from. Only where there's room for it.
  const depth = useApp((s) => s.settings.tabTree) && layout === 'vertical' && !tab.pinned ? (tab.depth ?? 0) : 0
  // Side tabs get a hover card; across the top, the title is already most of what's there, unless it brings a picture of the page.
  const previews = useApp((s) => s.settings.tabPreviews)
  const card = useHoverCard(tab, side || previews, side ? 'right' : 'below', previews)
  // Picked with Ctrl or Shift, along with others.
  const picked = useTabs((s) => s.selected.length > 1 && s.selected.includes(tab.id))

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={side || previews ? undefined : fullTitle(tab)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        card.hide()
        onDragState(tab.id)
        void startTabDrag(tab.id)
      }}
      onDragEnd={() => {
        onDragState(null)
        endTabDrag()
      }}
      onPointerEnter={(e) => card.show(e.currentTarget)}
      onPointerLeave={card.hide}
      onDragOver={(e) => {
        if (draggingId === null) return
        e.preventDefault()
        if (draggingId === tab.id) return
        // Reorder once the pointer passes the middle of the tab it's moving over.
        const rect = e.currentTarget.getBoundingClientRect()
        // Pinned side tabs sit in rows, where it's across that counts.
        const past = side && !(tab.pinned && layout === 'vertical') ? e.clientY - rect.top > rect.height / 2 : e.clientX - rect.left > rect.width / 2
        const from = Number(e.currentTarget.closest('[role="tablist"]')?.querySelector(`[data-tab-id="${draggingId}"]`)?.getAttribute('data-index'))
        if ((from < index && past) || (from > index && !past)) void window.scb.invoke('tabs:move', draggingId, index)
      }}
      data-tab-id={tab.id}
      data-index={index}
      onMouseDown={(e) => {
        card.hide()
        if (e.button !== 0) return
        // Ctrl (⌘ on a Mac) or Shift picks tabs to act on together, without leaving the open one.
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault()
          useTabs.getState().pick(tab.id, e.shiftKey)
          return
        }
        useTabs.getState().clearSelection()
        void window.scb.invoke('tabs:activate', tab.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) close()
      }}
      onContextMenu={() => {
        card.hide()
        const { selected } = useTabs.getState()
        if (selected.length > 1 && selected.includes(tab.id)) void window.scb.invoke('tabs:selection-menu', selected)
        else void window.scb.invoke('tabs:context-menu', tab.id)
      }}
      data-picked={picked || undefined}
      data-active={active || undefined}
      data-depth={depth || undefined}
      style={depth > 0 ? { marginLeft: depth * 12, width: `calc(100% - ${depth * 12}px)` } : undefined}
      className={cx(
        'sc-no-drag group @container relative flex items-center',
        'transition-[background-color,color,box-shadow] duration-(--sc-duration-fast)',
        side && 'rounded-md',
        // Across the top, the open tab joins the toolbar under it, with curved feet (sc-htab in index.css).
        layout === 'horizontal' && 'sc-htab',
        // A size container has no width of its own to offer the strip, so it says how wide it would like to be.
        layout === 'horizontal' && !tab.pinned && 'min-w-10 flex-[0_1_224px] gap-2 pr-1.5 pl-3 [contain-intrinsic-inline-size:224px]',
        layout === 'horizontal' && tab.pinned && 'w-10 shrink-0 justify-center',
        layout === 'horizontal' && (active ? 'h-8.75 rounded-t-[10px]' : 'mb-1 h-7.5 rounded-md'),
        layout === 'vertical' && !tab.pinned && 'h-9 w-full shrink-0 gap-2 pr-1 pl-2',
        layout === 'vertical' && tab.pinned && 'size-9 shrink-0 justify-center',
        layout === 'rail' && 'size-9 shrink-0 justify-center self-center',
        draggingId === tab.id && 'opacity-50',
        picked && 'ring-1 ring-accent ring-inset',
        active
          ? cx('bg-surface font-medium text-text', side && 'shadow-1')
          : picked
            ? 'bg-accent-soft text-text'
            : split
              ? 'bg-surface-hover text-text'
              : 'text-text-muted hover:bg-surface-hover hover:text-text',
        // The accent marks the active side tab, as the design rules reserve it for.
        side && active && !iconOnly && 'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
      )}
    >
      {layout === 'rail' && !tab.pinned ? (
        <FaviconCloseButton tab={tab} onClose={close} />
      ) : layout === 'vertical' && !tab.pinned && fold ? (
        <FoldButton tab={tab} collapsed={fold.collapsed} />
      ) : layout === 'vertical' && !tab.pinned ? (
        // The same box as the New tab row's icon, so the two line up.
        <span className="grid size-5 shrink-0 place-items-center">
          <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
        </span>
      ) : (
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
      )}
      {!iconOnly && (
        <span className={cx('min-w-0 flex-1 truncate @max-[64px]:hidden', tab.isSleeping && 'text-text-faint')}>
          {tabTitle(tab)}
        </span>
      )}
      {fold?.collapsed && fold.count > 0 && (
        <span aria-label={`${fold.count} more in this branch`} className="shrink-0 px-0.5 text-2xs font-medium tabular-nums text-text-faint @max-[96px]:hidden">
          +{fold.count}
        </span>
      )}
      {container && (
        <span
          role="img"
          aria-label={`${container.name} container`}
          title={`${container.name} container`}
          className={cx('size-2 shrink-0 rounded-full', iconOnly && 'absolute right-1 bottom-1')}
          style={{ backgroundColor: `oklch(0.65 0.15 ${container.hue})` }}
        />
      )}
      <AudioButton tab={tab} corner={iconOnly} />
      {sleepButton && (
        <button
          type="button"
          aria-label="Sleep tab"
          title="Sleep tab, to free its memory"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void window.scb.invoke('tabs:sleep', tab.id)}
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint hover:bg-surface-active hover:text-text @max-[96px]:hidden',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <Moon size={11} strokeWidth={2} />
        </button>
      )}
      {!iconOnly && (
        <button
          type="button"
          aria-label="Close tab"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={close}
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint hover:bg-surface-active hover:text-text @max-[64px]:hidden',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
