import { useRef } from 'react'

interface ResizeHandleProps {
  label: string
  /** The edge of the sidebar it sits on. Dragging away from the sidebar makes it wider. */
  edge: 'left' | 'right'
  width: number
  min: number
  max: number
  /** Called as it moves, for drawing. */
  onWidth: (width: number) => void
  /** Called once it's let go, for saving. */
  onCommit: (width: number) => void
  onDragging?: (dragging: boolean) => void
}

const KEY_STEP = 16

/** A thin strip over a sidebar's border. Also works from the keyboard, with the arrow keys. */
export function ResizeHandle({ label, edge, width, min, max, onWidth, onCommit, onDragging }: ResizeHandleProps) {
  const drag = useRef<{ x: number; width: number; latest: number } | null>(null)
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)))
  const sign = edge === 'left' ? -1 : 1
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`sc-no-drag absolute inset-y-0 z-10 w-1.5 cursor-col-resize transition-colors outline-none hover:bg-border-strong focus-visible:bg-accent active:bg-accent ${edge === 'left' ? '-left-0.75' : '-right-0.75'}`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, width, latest: width }
        onDragging?.(true)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        drag.current.latest = clamp(drag.current.width + (e.clientX - drag.current.x) * sign)
        onWidth(drag.current.latest)
      }}
      onPointerUp={() => {
        if (!drag.current) return
        onCommit(drag.current.latest)
        drag.current = null
        onDragging?.(false)
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return
        onCommit(drag.current.latest)
        drag.current = null
        onDragging?.(false)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const next = clamp(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP) * sign)
        onWidth(next)
        onCommit(next)
      }}
    />
  )
}
