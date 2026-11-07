import { useLayoutEffect, useRef, useState } from 'react'
import { Code2, X } from 'lucide-react'
import { DEVTOOLS_BAR, SPLIT_GAP, SPLIT_RATIO, splitLeftWidth } from '@scbrowser/shared'
import { IconButton } from '@scbrowser/ui'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useTabs } from '../state/tabs'

const MIN_DOCKED = 240

/**
 * Reserves the area where the active tab's native view is drawn and reports its
 * rectangle to the main process whenever the layout changes. In split view the two
 * pages leave a gap, and the divider sits in it, as nothing here can draw over a page.
 */
export function PageSlot() {
  const ref = useRef<HTMLDivElement>(null)
  const splitOn = useTabs((s) => s.splitIds.length > 0)
  const ratio = useTabs((s) => s.splitRatio)
  const docked = useTabs((s) => s.devToolsWidth)
  const [slotWidth, setSlotWidth] = useState(0)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [dragDocked, setDragDocked] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect()
      setSlotWidth(width)
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
  const room = pagesWidth - SPLIT_GAP
  const leftWidth = dragWidth ?? splitLeftWidth(pagesWidth, ratio)

  return (
    <div ref={ref} className="relative min-h-0 min-w-0 flex-1 bg-surface">
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
        // The handle centres itself on this box's right edge, which is the middle of the gap.
        <div className="absolute inset-y-0 left-0" style={{ width: leftWidth + SPLIT_GAP / 2 }}>
          <div aria-hidden className="absolute inset-y-0 right-0 w-px translate-x-1/2 bg-border-strong" />
          <ResizeHandle
            label="Split view divider"
            edge="right"
            width={leftWidth}
            min={Math.round(room * SPLIT_RATIO.min)}
            max={Math.round(room * SPLIT_RATIO.max)}
            onWidth={setDragWidth}
            onCommit={(width) => {
              void window.scb.invoke('tabs:split-ratio', width / room)
              setDragWidth(null)
            }}
            onDragging={(dragging) => void window.scb.invoke('layout:resizing', dragging)}
          />
        </div>
      )}
    </div>
  )
}
