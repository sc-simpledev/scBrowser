import type { BookmarkGroup, PermissionPrompt } from './library'
import type { Suggestion } from './omnibox'
import type { AccentId } from './privacy'
import type { CleanupRow, PageRect } from './tabs'

/**
 * The overlay is a transparent view stacked above web pages so popups drawn by the chrome
 * UI (omnibox dropdown, tooltips) aren't hidden under the page. The chrome UI describes
 * what to show in window coordinates; the main process sizes the overlay to fit.
 */
export interface OmniboxPopupState {
  anchor: PageRect
  suggestions: Suggestion[]
  selectedIndex: number
  /** Replaces the rows once the person has asked a question. */
  answer: OmniboxAnswer | null
}

export interface OmniboxAnswer {
  question: string
  text: string
  streaming: boolean
  error: string | null
  /** Saved chats are on, so this can carry on in the assistant. */
  canContinue: boolean
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

/** Popups the main process owns, shown near the top-left of the page. */
export interface PermissionPopupState {
  prompt: PermissionPrompt
  x: number
  y: number
}

/** The small form for editing a bookmark. */
export interface BookmarkEditorState {
  id: number
  title: string
  url: string
  groupId: number | null
  groups: BookmarkGroup[]
  /** Editing from the toolbar also offers the address; from the page it's the page's own. */
  editUrl: boolean
  x: number
  y: number
}

/** A site or proxy asking for a username and password. */
export interface AuthPopupState {
  requestId: number
  host: string
  /** Written by the site, so it's shown as a quote and never as our own words. */
  realm: string
  /** The password would travel unencrypted. */
  insecure: boolean
  x: number
  y: number
}

export interface CleanupPopupState {
  rows: CleanupRow[]
  x: number
  y: number
}

export interface WorkspaceEditorState {
  /** Null while creating one. */
  id: string | null
  name: string
  focus: boolean
  canRemove: boolean
  x: number
  y: number
}

export interface WorkspaceEdit {
  id: string | null
  name: string
  focus: boolean
}

export interface BookmarkEdit {
  id: number
  title: string
  url: string
  groupId: number | null
}

export interface OverlayView extends OverlayState {
  permission: PermissionPopupState | null
  /** Left edge and top of the command palette, when it's open. */
  palette: { x: number; y: number } | null
  accent: AccentId
  /** Brief confirmation near the top right of the page. */
  toast: { text: string; x: number; y: number } | null
  bookmarkEditor: BookmarkEditorState | null
  auth: AuthPopupState | null
  cleanup: CleanupPopupState | null
  workspaceEditor: WorkspaceEditorState | null
}

export const EMPTY_OVERLAY: OverlayState = { omnibox: null, tooltip: null }

/** Transparent space kept around popups so their shadows aren't clipped. */
export const OVERLAY_MARGIN = 12
export const SUGGESTION_ROW_HEIGHT = 36
export const POPUP_PADDING = 4
export const POPUP_GAP = 4
export const TOOLTIP_GAP = 6
/** Tooltips block clicks where they're drawn, so they take no more room than their text needs. */
export const TOOLTIP_REGION = { maxWidth: 320, height: 28, charWidth: 7, padding: 24 }
export const PALETTE_POPUP = { width: 560, height: 380, top: 72 }
export const TOAST_POPUP = { width: 300, height: 40, inset: 8 }
export const BOOKMARK_POPUP = { width: 320, height: 248, inset: 8 }
export const PERMISSION_POPUP = { width: 340, height: 120, inset: 8 }
export const ANSWER_HEIGHT = 300
export const AUTH_POPUP = { width: 340, height: 248 }
export const CLEANUP_POPUP = { width: 480, height: 420, top: 72 }
export const WORKSPACE_POPUP = { width: 300, height: 188 }

/** Window-space rectangle each popup occupies, including its shadow margin. */
export function overlayRegions(state: OverlayView): PageRect[] {
  const regions: PageRect[] = []
  if (state.omnibox && (state.omnibox.answer || state.omnibox.suggestions.length > 0)) {
    const { anchor, suggestions, answer } = state.omnibox
    regions.push({
      x: anchor.x - OVERLAY_MARGIN,
      y: anchor.y + anchor.height + POPUP_GAP - OVERLAY_MARGIN,
      width: anchor.width + OVERLAY_MARGIN * 2,
      height: (answer ? ANSWER_HEIGHT : suggestions.length * SUGGESTION_ROW_HEIGHT + POPUP_PADDING * 2) + OVERLAY_MARGIN * 2
    })
  }
  const popups = [
    state.auth && { ...state.auth, ...AUTH_POPUP },
    state.cleanup && { ...state.cleanup, ...CLEANUP_POPUP },
    state.workspaceEditor && { ...state.workspaceEditor, ...WORKSPACE_POPUP }
  ]
  for (const popup of popups) {
    if (popup) regions.push({ x: popup.x - OVERLAY_MARGIN, y: popup.y - OVERLAY_MARGIN, width: popup.width + OVERLAY_MARGIN * 2, height: popup.height + OVERLAY_MARGIN * 2 })
  }
  if (state.tooltip) {
    const { anchor, label, shortcut } = state.tooltip
    const text = label.length + (shortcut ? shortcut.length + 2 : 0)
    const width = Math.min(TOOLTIP_REGION.maxWidth, text * TOOLTIP_REGION.charWidth + TOOLTIP_REGION.padding)
    regions.push({
      x: anchor.x + anchor.width / 2 - width / 2,
      y: anchor.y + anchor.height + TOOLTIP_GAP,
      width,
      height: TOOLTIP_REGION.height
    })
  }
  if (state.bookmarkEditor) {
    regions.push({
      x: state.bookmarkEditor.x - OVERLAY_MARGIN,
      y: state.bookmarkEditor.y - OVERLAY_MARGIN,
      width: BOOKMARK_POPUP.width + OVERLAY_MARGIN * 2,
      height: BOOKMARK_POPUP.height + OVERLAY_MARGIN * 2
    })
  }
  if (state.palette) {
    regions.push({
      x: state.palette.x - OVERLAY_MARGIN,
      y: state.palette.y - OVERLAY_MARGIN,
      width: PALETTE_POPUP.width + OVERLAY_MARGIN * 2,
      height: PALETTE_POPUP.height + OVERLAY_MARGIN * 2
    })
  }
  if (state.toast) {
    regions.push({
      x: state.toast.x - OVERLAY_MARGIN,
      y: state.toast.y - OVERLAY_MARGIN,
      width: TOAST_POPUP.width + OVERLAY_MARGIN * 2,
      height: TOAST_POPUP.height + OVERLAY_MARGIN * 2
    })
  }
  if (state.permission) {
    regions.push({
      x: state.permission.x + PERMISSION_POPUP.inset - OVERLAY_MARGIN,
      y: state.permission.y + PERMISSION_POPUP.inset - OVERLAY_MARGIN,
      width: PERMISSION_POPUP.width + OVERLAY_MARGIN * 2,
      height: PERMISSION_POPUP.height + OVERLAY_MARGIN * 2
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
