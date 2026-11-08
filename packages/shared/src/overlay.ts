import type { BookmarkGroup, PermissionPrompt } from './library'
import type { Suggestion } from './omnibox'
import type { AccentId } from './privacy'
import type { CleanupRow, PageRect, TabSearchRow } from './tabs'

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

/** Whether to keep a login someone just used. The password stays in the main process. */
export interface PasswordPromptState {
  host: string
  username: string
  update: boolean
  /** The vault has to be opened or created first, so saving goes by way of that. */
  needs: 'unlock' | 'setup' | null
  x: number
  y: number
}

/** The list under a sign-in field: saved logins to fill, or a new strong password for a sign-up form. */
export interface PasswordSuggestState {
  host: string
  logins: { id: string; username: string }[]
  /** The vault is locked, so the only row is to open it. */
  locked: boolean
  /** A field for a new password, so the list offers to make one. */
  generate: boolean
  x: number
  y: number
  width: number
}

export const PASSWORD_SUGGEST = { rowHeight: 34, maxRows: 5, minWidth: 260, maxWidth: 380, footer: 30 }

export function passwordSuggestHeight(state: Pick<PasswordSuggestState, 'logins' | 'locked' | 'generate'>): number {
  const rows = state.locked ? 1 : Math.min(PASSWORD_SUGGEST.maxRows, state.logins.length) + (state.generate ? 1 : 0)
  return Math.max(1, rows) * PASSWORD_SUGGEST.rowHeight + PASSWORD_SUGGEST.footer + POPUP_PADDING * 2
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

export interface TabSearchState {
  rows: TabSearchRow[]
  x: number
  y: number
}

/** Asks before a link opens another app, such as `claude://`. */
export interface AppLinkPromptState {
  url: string
  scheme: string
  appName: string
  /** The site asking, or null when the person entered the address themselves. */
  host: string | null
  x: number
  y: number
}

export interface ExtensionRow {
  id: string
  name: string
  /** A data address. */
  icon: string | null
  pinned: boolean
  hasAction: boolean
}

export interface ExtensionsPopupState {
  rows: ExtensionRow[]
  height: number
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

/** What can be changed for the open site, from the padlock in the address bar. */
export interface SiteControlsState {
  /** The site without `www.`, as settings key it. */
  site: string
  host: string
  secure: boolean
  /** Null while tracking protection is off everywhere. */
  tracking: boolean | null
  blocked: number
  ai: boolean
  forgetOnClose: boolean
  zoom: number
  permissions: { permission: string; label: string; allowed: boolean }[]
  x: number
  y: number
}

export type SiteAction = 'tracking' | 'ai' | 'forget-on-close' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'forget-now' | 'settings' | `permission:${string}`

export const isSiteAction = (value: unknown): value is SiteAction =>
  typeof value === 'string' && (/^(tracking|ai|forget-on-close|zoom-in|zoom-out|zoom-reset|forget-now|settings)$/.test(value) || /^permission:[\w:.-]{1,64}$/.test(value))

export const SITE_POPUP = { width: 320, header: 58, row: 44, permissionRow: 36, footer: 48 }

export function siteControlsHeight(state: Pick<SiteControlsState, 'permissions'>): number {
  const permissions = state.permissions.length > 0 ? 28 + state.permissions.length * SITE_POPUP.permissionRow : 0
  return SITE_POPUP.header + 4 * SITE_POPUP.row + permissions + SITE_POPUP.footer + 10
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

/** A link opened over the page, without making a tab. Its page is a native view inside `card`, under the header. */
export interface LinkPreviewState {
  /** The dimmed page area behind it, which closes the preview when clicked. */
  backdrop: PageRect
  card: PageRect
  title: string
  url: string
  loading: boolean
}

export interface OverlayView extends OverlayState {
  permission: PermissionPopupState | null
  /** Left edge and top of the command palette, when it's open. */
  palette: { x: number; y: number } | null
  tabSearch: TabSearchState | null
  appLink: AppLinkPromptState | null
  extensionsPopup: ExtensionsPopupState | null
  /** The border and shadow of an extension's panel, whose page is a native view above this. */
  extensionFrame: PageRect | null
  accent: AccentId
  performance: boolean
  /** Brief confirmation near the top right of the page. */
  toast: { text: string; x: number; y: number } | null
  bookmarkEditor: BookmarkEditorState | null
  auth: AuthPopupState | null
  passwordPrompt: PasswordPromptState | null
  passwordSuggest: PasswordSuggestState | null
  cleanup: CleanupPopupState | null
  workspaceEditor: WorkspaceEditorState | null
  linkPreview: LinkPreviewState | null
  siteControls: SiteControlsState | null
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
export const EXTENSIONS_POPUP = { width: 320, rowHeight: 36, chrome: 98, maxHeight: 460 }
export const APP_LINK_POPUP = { width: 360, height: 132 }
export const PASSWORD_POPUP = { width: 340, height: 96, inset: 8 }
export const CLEANUP_POPUP = { width: 480, height: 420, top: 72 }
export const WORKSPACE_POPUP = { width: 300, height: 188 }
/** The header above a link preview's page, and how far the card keeps from the page's edges. */
export const LINK_PREVIEW = { header: 44, inset: 40, maxWidth: 1180, minWidth: 360 }

/** Where a link preview's card goes in the page area, and where its page sits inside the card. */
export function linkPreviewLayout(page: PageRect): { card: PageRect; view: PageRect } {
  const inset = page.width < 720 ? 12 : LINK_PREVIEW.inset
  const width = Math.max(Math.min(LINK_PREVIEW.minWidth, page.width), Math.min(LINK_PREVIEW.maxWidth, page.width - inset * 2))
  const height = Math.max(LINK_PREVIEW.header + 80, page.height - inset * 2)
  const card = { x: Math.round(page.x + (page.width - width) / 2), y: Math.round(page.y + (page.height - height) / 2), width: Math.round(width), height: Math.round(height) }
  return { card, view: { x: card.x, y: card.y + LINK_PREVIEW.header, width: card.width, height: card.height - LINK_PREVIEW.header } }
}

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
    state.passwordPrompt && { ...state.passwordPrompt, width: PASSWORD_POPUP.width, height: PASSWORD_POPUP.height },
    state.passwordSuggest && { ...state.passwordSuggest, height: passwordSuggestHeight(state.passwordSuggest) },
    state.appLink && { ...state.appLink, ...APP_LINK_POPUP },
    state.extensionsPopup && { ...state.extensionsPopup, width: EXTENSIONS_POPUP.width },
    state.extensionFrame,
    state.cleanup && { ...state.cleanup, ...CLEANUP_POPUP },
    state.workspaceEditor && { ...state.workspaceEditor, ...WORKSPACE_POPUP },
    state.siteControls && { ...state.siteControls, width: SITE_POPUP.width, height: siteControlsHeight(state.siteControls) }
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
  for (const popup of [state.palette, state.tabSearch]) {
    if (!popup) continue
    regions.push({
      x: popup.x - OVERLAY_MARGIN,
      y: popup.y - OVERLAY_MARGIN,
      width: PALETTE_POPUP.width + OVERLAY_MARGIN * 2,
      height: PALETTE_POPUP.height + OVERLAY_MARGIN * 2
    })
  }
  if (state.linkPreview) regions.push(state.linkPreview.backdrop)
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
