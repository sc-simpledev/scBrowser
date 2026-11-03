import { useEffect, useRef } from 'react'

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
  const stopDrag = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onWidth, onCommit, onDragging })
  callbacks.current = { onWidth, onCommit, onDragging }
  // A sidebar closed mid-drag mustn't leave the page hidden.
  useEffect(() => () => stopDrag.current?.(), [])
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
        stopDrag.current?.()
        const startX = e.clientX
        const startWidth = width
        let latest = width
        const finish = () => {
          stopDrag.current = null
          removeEventListener('pointermove', move)
          removeEventListener('pointerup', finish)
          removeEventListener('pointercancel', finish)
          callbacks.current.onCommit(latest)
          callbacks.current.onDragging?.(false)
        }
        // The window listens, not this strip: hiding the page drops any pointer capture part way through.
        const move = (event: PointerEvent) => {
          // The button was let go somewhere that couldn't report it.
          if (event.buttons === 0) return finish()
          latest = clamp(startWidth + (event.clientX - startX) * sign)
          callbacks.current.onWidth(latest)
        }
        addEventListener('pointermove', move)
        addEventListener('pointerup', finish)
        addEventListener('pointercancel', finish)
        stopDrag.current = finish
        callbacks.current.onDragging?.(true)
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
