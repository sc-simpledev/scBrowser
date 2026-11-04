import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from '@scbrowser/ui'
import type { ExtensionPanelState } from '@scbrowser/shared'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useApp } from '../state/app'

const MIN_WIDTH = 240
const MAX_WIDTH = 720

/** An extension's side panel. The page itself is a native view drawn over the empty area here. */
export function ExtensionPanel() {
  const [panel, setPanel] = useState<ExtensionPanelState | null>(null)
  const savedWidth = useApp((s) => s.settings.extensionPanelWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? savedWidth
  const slot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.scb.invoke('extensions:panel-state').then(setPanel)
    return window.scb.on('extensions:panel', setPanel)
  }, [])

  const open = panel !== null
  useLayoutEffect(() => {
    const element = slot.current
    if (!element) return
    const report = () => {
      const { x, y, width: w, height } = element.getBoundingClientRect()
      void window.scb.invoke('extensions:panel-rect', { x, y, width: w, height })
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

  if (!panel) return null
  return (
    <aside aria-label={`${panel.name} side panel`} className="relative flex shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
      <ResizeHandle
        label="Side panel width"
        edge="left"
        width={width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        onWidth={setDragWidth}
        onCommit={(extensionPanelWidth) => void window.scb.invoke('settings:set', { extensionPanelWidth })}
        onDragging={(dragging) => void window.scb.invoke('layout:resizing', dragging)}
      />
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-medium">{panel.name}</span>
        <IconButton size="sm" label="Close side panel" onClick={() => void window.scb.invoke('extensions:panel-close')}>
          <X size={14} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div ref={slot} className="min-h-0 flex-1" />
    </aside>
  )
}
