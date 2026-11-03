import { create } from 'zustand'
import type { TooltipHost } from '@scbrowser/ui'
import { EMPTY_OVERLAY, type OmniboxPopupState, type OverlayState, type TooltipState } from '@scbrowser/shared'

interface OverlayStore extends OverlayState {
  setOmnibox: (omnibox: OmniboxPopupState | null) => void
  setTooltip: (tooltip: TooltipState | null) => void
}

export const useOverlay = create<OverlayStore>((set) => ({
  ...EMPTY_OVERLAY,
  setOmnibox: (omnibox) => set({ omnibox }),
  setTooltip: (tooltip) => set({ tooltip })
}))

export const overlayTooltipHost: TooltipHost = {
  show: (anchor, label, shortcut) => useOverlay.getState().setTooltip({ anchor, label, shortcut }),
  hide: () => useOverlay.getState().setTooltip(null)
}

/** Mirrors overlay state to the main process, at most once per frame. */
export function connectOverlay(): () => void {
  let frame = 0
  const unsubscribe = useOverlay.subscribe(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const { omnibox, tooltip } = useOverlay.getState()
      void window.scb.invoke('overlay:set', { omnibox, tooltip })
    })
  })
  // Popups anchored to the window shouldn't outlive it losing focus.
  const onBlur = () => useOverlay.getState().setTooltip(null)
  window.addEventListener('blur', onBlur)
  // The main process saw the pointer reach a page, which this view can't see for itself.
  const offClear = window.scb.on('overlay:clear-tooltip', onBlur)
  return () => {
    cancelAnimationFrame(frame)
    unsubscribe()
    offClear()
    window.removeEventListener('blur', onBlur)
  }
}
