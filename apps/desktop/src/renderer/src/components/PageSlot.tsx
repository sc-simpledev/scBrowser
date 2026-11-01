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
    <div className="flex min-h-0 flex-1 px-1.5 pb-1.5">
      <div ref={ref} className="flex-1 rounded-lg bg-surface shadow-2" />
    </div>
  )
}
