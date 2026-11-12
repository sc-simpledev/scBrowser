import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Code2, Link2, Maximize2, X } from 'lucide-react'
import { DEVTOOLS_BAR, isNewTabUrl, SPLIT_GAP, SPLIT_RATIO, splitPanes, splitRoom, type PageRect, type TabState } from '@scbrowser/shared'
import { cx, IconButton } from '@scbrowser/ui'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useTabs } from '../state/tabs'
import { Favicon } from './Favicon'

/** One side of split view: a card round the page, with the tab's name and what can be done with it. */
function SplitCard({ tab, rect, active, linked }: { tab: TabState; rect: PageRect; active: boolean; linked: boolean | null }) {
  const title = tab.title || (isNewTabUrl(tab.url) ? 'New tab' : tab.url)
  return (
    <section
      aria-label={`Split view: ${title}`}
      data-active={active || undefined}
      className={cx(
        'absolute flex flex-col rounded-(--sc-split-radius) border bg-surface transition-[border-color,box-shadow] duration-(--sc-duration-fast)',
        active ? 'border-(--sc-accent) shadow-[0_0_0_3px_var(--sc-accent-soft)]' : 'border-border'
      )}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div className="flex h-(--sc-split-bar) shrink-0 items-center gap-2 pr-1 pl-2.5" onMouseDown={(e) => e.button === 0 && !active && void window.scb.invoke('tabs:activate', tab.id)}>
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
        <span className={cx('min-w-0 flex-1 truncate text-xs', active ? 'font-medium text-text' : 'text-text-muted')}>{title}</span>
        {linked !== null && (
          <IconButton
            size="sm"
            label={linked ? 'Links open on the right. Click to stop' : 'Open links on the right'}
            aria-pressed={linked}
            className={linked ? 'bg-accent-soft text-accent' : undefined}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void window.scb.invoke('tabs:split-link')}
          >
            <Link2 size={13} strokeWidth={1.75} />
          </IconButton>
        )}
        <IconButton size="sm" label="Swap sides" onMouseDown={(e) => e.stopPropagation()} onClick={() => void window.scb.invoke('tabs:split-swap')}>
          <ArrowLeftRight size={13} strokeWidth={1.75} />
        </IconButton>
        <IconButton size="sm" label="Show only this tab" onMouseDown={(e) => e.stopPropagation()} onClick={() => void window.scb.invoke('tabs:split-keep', tab.id)}>
          <Maximize2 size={12} strokeWidth={1.75} />
        </IconButton>
        <IconButton size="sm" label="Close tab" onMouseDown={(e) => e.stopPropagation()} onClick={() => void window.scb.invoke('tabs:close', tab.id)}>
          <X size={13} strokeWidth={1.75} />
        </IconButton>
      </div>
    </section>
  )
}

const MIN_DOCKED = 240

/**
 * Reserves the area where the active tab's native view is drawn and reports its
 * rectangle to the main process whenever the layout changes. In split view the two
 * pages leave a gap, and the divider sits in it, as nothing here can draw over a page.
 */
export function PageSlot() {
  const ref = useRef<HTMLDivElement>(null)
  const splitIds = useTabs((s) => s.splitIds)
  const allTabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const splitOn = splitIds.length > 0
  const ratio = useTabs((s) => s.splitRatio)
  const linked = useTabs((s) => s.splitLinked)
  const docked = useTabs((s) => s.devToolsWidth)
  const [slotWidth, setSlotWidth] = useState(0)
  const [slotHeight, setSlotHeight] = useState(0)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [dragDocked, setDragDocked] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect()
      setSlotWidth(width)
      setSlotHeight(height)
      void window.scb.invoke('layout:page-rect', { x, y, width, height })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  // Developer tools take their room first, and split view shares out what's left.
  const shownDocked = dragDocked ?? docked
  const pagesWidth = slotWidth - (shownDocked > 0 ? shownDocked + SPLIT_GAP : 0)
  const room = splitRoom(pagesWidth)
  const shownRatio = dragWidth !== null && room > 0 ? dragWidth / room : ratio
  const panes = splitPanes({ x: 0, y: 0, width: pagesWidth, height: slotHeight }, shownRatio)
  const sides = splitIds.map((id) => allTabs.find((tab) => tab.id === id))

  return (
    <div ref={ref} className={cx('relative min-h-0 min-w-0 flex-1', splitOn ? 'bg-transparent' : 'bg-surface')}>
      {shownDocked > 0 && (
        <div className="absolute inset-y-0 right-0" style={{ width: shownDocked + SPLIT_GAP / 2 }}>
          <div aria-hidden className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-border-strong" />
          <div
            data-testid="devtools-bar"
            className="absolute right-0 top-0 flex items-center gap-1.5 border-b border-border bg-bg pl-2.5 pr-1 text-xs text-text-muted"
            style={{ width: shownDocked, height: DEVTOOLS_BAR }}
          >
            <Code2 size={13} strokeWidth={1.75} aria-hidden />
            <span className="flex-1 truncate">Developer tools</span>
            <IconButton size="sm" label="Close developer tools" onClick={() => void window.scb.invoke('tabs:devtools-close')}>
              <X size={14} strokeWidth={1.75} />
            </IconButton>
          </div>
          <ResizeHandle
            label="Developer tools width"
            edge="left"
            width={shownDocked}
            min={MIN_DOCKED}
            max={Math.max(MIN_DOCKED, slotWidth - MIN_DOCKED - SPLIT_GAP)}
            onWidth={setDragDocked}
            onCommit={(width) => {
              void window.scb.invoke('tabs:devtools-width', width)
              setDragDocked(null)
            }}
            onDragging={(dragging) => void window.scb.invoke('layout:resizing', dragging)}
          />
        </div>
      )}
      {splitOn && room > 0 && (
        <>
          {sides.map((tab, index) => tab && <SplitCard key={tab.id} tab={tab} rect={panes[index]!.card} active={tab.id === activeId} linked={index === 0 ? linked : null} />)}
          {/* The handle centres itself on this box's right edge, which is the middle of the gap. */}
          <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: panes[0].card.x + panes[0].card.width + SPLIT_GAP / 2 }}>
            <div aria-hidden className="absolute top-1/2 right-0 h-8 w-1 translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong" />
            <ResizeHandle
              label="Split view divider"
              edge="right"
              width={panes[0].card.width}
              min={Math.round(room * SPLIT_RATIO.min)}
              max={Math.round(room * SPLIT_RATIO.max)}
              onWidth={setDragWidth}
              onCommit={(width) => {
                void window.scb.invoke('tabs:split-ratio', width / room)
                setDragWidth(null)
              }}
              onDragging={(dragging) => void window.scb.invoke('layout:resizing', dragging)}
              className="pointer-events-auto rounded-full"
            />
          </div>
        </>
      )}
    </div>
  )
}
