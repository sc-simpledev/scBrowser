import type { Suggestion } from './omnibox'
import type { PageRect } from './tabs'

/**
 * The overlay is a transparent view stacked above web pages so popups drawn by the chrome
 * UI (omnibox dropdown, tooltips) aren't hidden under the page. The chrome UI describes
 * what to show in window coordinates; the main process sizes the overlay to fit.
 */
export interface OmniboxPopupState {
  anchor: PageRect
  suggestions: Suggestion[]
  selectedIndex: number
}

export interface TooltipState {
  anchor: PageRect
  label: string
  shortcut?: string
}

export interface OverlayState {
  omnibox: OmniboxPopupState | null
  tooltip: TooltipState | null
}

export const EMPTY_OVERLAY: OverlayState = { omnibox: null, tooltip: null }

/** Transparent space kept around popups so their shadows aren't clipped. */
export const OVERLAY_MARGIN = 12
export const SUGGESTION_ROW_HEIGHT = 36
export const POPUP_PADDING = 4
export const POPUP_GAP = 4
export const TOOLTIP_GAP = 6
export const TOOLTIP_REGION = { width: 320, height: 28 }

/** Window-space rectangle each popup occupies, including its shadow margin. */
export function overlayRegions(state: OverlayState): PageRect[] {
  const regions: PageRect[] = []
  if (state.omnibox && state.omnibox.suggestions.length > 0) {
    const { anchor, suggestions } = state.omnibox
    regions.push({
      x: anchor.x - OVERLAY_MARGIN,
      y: anchor.y + anchor.height + POPUP_GAP - OVERLAY_MARGIN,
      width: anchor.width + OVERLAY_MARGIN * 2,
      height: suggestions.length * SUGGESTION_ROW_HEIGHT + POPUP_PADDING * 2 + OVERLAY_MARGIN * 2
    })
  }
  if (state.tooltip) {
    const { anchor } = state.tooltip
    regions.push({
      x: anchor.x + anchor.width / 2 - TOOLTIP_REGION.width / 2,
      y: anchor.y + anchor.height + TOOLTIP_GAP - OVERLAY_MARGIN,
      width: TOOLTIP_REGION.width,
      height: TOOLTIP_REGION.height + OVERLAY_MARGIN * 2
    })
  }
  return regions
}

export function unionRect(rects: PageRect[]): PageRect | null {
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
