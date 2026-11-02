import { useLayoutEffect, useRef } from 'react'

/**
 * Reserves the area where the active tab's native view is drawn and reports its
 * rectangle to the main process whenever the layout changes.
 */
export function PageSlot() {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect()
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

  return (
    <div ref={ref} className="min-h-0 min-w-0 flex-1 border-t border-border bg-surface" />
  )
}
