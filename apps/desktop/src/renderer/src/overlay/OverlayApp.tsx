import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, TooltipBubble } from '@scbrowser/ui'
import {
  EMPTY_OVERLAY,
  OVERLAY_MARGIN,
  PERMISSION_LABELS,
  PERMISSION_POPUP,
  POPUP_GAP,
  shortcutLabel,
  TOAST_POPUP,
  TOOLTIP_GAP,
  type OverlayEvents,
  type PermissionPopupState
} from '@scbrowser/shared'
import { AnswerCard } from './AnswerCard'
import { AuthPopup } from './AuthPopup'
import { PasswordPrompt } from './PasswordPrompt'
import { BookmarkEditor } from './BookmarkEditor'
import { CleanupPopup } from './CleanupPopup'
import { CommandPalette } from './CommandPalette'
import { SuggestionList } from './SuggestionList'
import { WorkspaceEditor } from './WorkspaceEditor'

type Payload = OverlayEvents['overlay:state']

export function OverlayApp() {
  const [{ state, origin }, setPayload] = useState<Payload>({ state: { ...EMPTY_OVERLAY, permission: null, palette: null, accent: 'teal', toast: null, bookmarkEditor: null, auth: null, passwordPrompt: null, cleanup: null, workspaceEditor: null }, origin: { x: 0, y: 0 } })

  useEffect(() => window.scbOverlay.on('overlay:state', setPayload), [])

  // A tooltip must never get in the way: this view takes the pointer wherever it's drawn.
  useEffect(() => {
    const clear = () => void window.scbOverlay.invoke('overlay:tooltip-clear')
    window.addEventListener('pointermove', clear)
    return () => window.removeEventListener('pointermove', clear)
  }, [])

  const { omnibox, tooltip, permission, palette, accent, toast, bookmarkEditor, auth, passwordPrompt, cleanup, workspaceEditor } = state

  useEffect(() => {
    document.documentElement.dataset.accent = accent
  }, [accent])
  return (
    <>
      {omnibox && (omnibox.answer || omnibox.suggestions.length > 0) && (
        <div
          className="absolute"
          style={{
            left: omnibox.anchor.x - origin.x,
            top: omnibox.anchor.y + omnibox.anchor.height + POPUP_GAP - origin.y,
            width: omnibox.anchor.width
          }}
        >
          {omnibox.answer ? (
            <AnswerCard answer={omnibox.answer} />
          ) : (
            <SuggestionList
              suggestions={omnibox.suggestions}
              selectedIndex={omnibox.selectedIndex}
              onPick={(index) => void window.scbOverlay.invoke('overlay:pick', index)}
            />
          )}
        </div>
      )}
      {palette && <CommandPalette x={palette.x - origin.x} y={palette.y - origin.y} />}
      {toast && (
        <div
          role="status"
          className="sc-glass-strong sc-tooltip absolute flex items-center rounded-lg px-3 shadow-3"
          style={{ left: toast.x - origin.x, top: toast.y - origin.y, width: TOAST_POPUP.width, height: TOAST_POPUP.height }}
        >
          {toast.text}
        </div>
      )}
      {bookmarkEditor && <BookmarkEditor key={bookmarkEditor.id} editor={bookmarkEditor} x={bookmarkEditor.x - origin.x} y={bookmarkEditor.y - origin.y} />}
      {permission && <PermissionPopup popup={permission} origin={origin} />}
      {passwordPrompt && <PasswordPrompt prompt={passwordPrompt} x={passwordPrompt.x - origin.x} y={passwordPrompt.y - origin.y} />}
      {auth && <AuthPopup key={auth.requestId} auth={auth} x={auth.x - origin.x} y={auth.y - origin.y} />}
      {cleanup && <CleanupPopup cleanup={cleanup} x={cleanup.x - origin.x} y={cleanup.y - origin.y} />}
      {workspaceEditor && <WorkspaceEditor key={workspaceEditor.id ?? 'new'} editor={workspaceEditor} x={workspaceEditor.x - origin.x} y={workspaceEditor.y - origin.y} />}
      {tooltip && (
        <PlacedTooltip
          key={`${tooltip.label}:${tooltip.anchor.x}`}
          centerX={tooltip.anchor.x + tooltip.anchor.width / 2 - origin.x}
          top={tooltip.anchor.y + tooltip.anchor.height + TOOLTIP_GAP - origin.y}
          label={tooltip.label}
          shortcut={tooltip.shortcut}
        />
      )}
    </>
  )
}

function PermissionPopup({ popup, origin }: { popup: PermissionPopupState; origin: { x: number; y: number } }) {
  const { prompt, x, y } = popup
  const answer = (allow: boolean) => void window.scbOverlay.invoke('overlay:permission', prompt.requestId, allow)
  const wants = prompt.permissions.map((p) => PERMISSION_LABELS[p]).join(' and ')
  return (
    <div
      role="alertdialog"
      aria-label="Site permission"
      className="sc-glass-strong sc-tooltip absolute flex flex-col justify-between gap-3 rounded-lg p-3 shadow-3"
      style={{
        left: x + PERMISSION_POPUP.inset - origin.x,
        top: y + PERMISSION_POPUP.inset - origin.y,
        width: PERMISSION_POPUP.width,
        height: PERMISSION_POPUP.height
      }}
    >
      <p>
        <span className="block truncate font-medium">{new URL(prompt.origin).host}</span>
        <span className="text-text-muted">wants to {wants}</span>
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={() => answer(false)}>Block</Button>
        <Button variant="primary" onClick={() => answer(true)}>
          Allow
        </Button>
      </div>
    </div>
  )
}

/** Centres the tooltip under its anchor, nudged inwards if it would be cut off. */
function PlacedTooltip({ centerX, top, label, shortcut }: { centerX: number; top: number; label: string; shortcut?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState<number | null>(null)

  useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 0
    const max = window.innerWidth - width - OVERLAY_MARGIN / 2
    setLeft(Math.max(OVERLAY_MARGIN / 2, Math.min(max, centerX - width / 2)))
  }, [centerX, label, shortcut])

  return (
    <div ref={ref} className="absolute" style={{ left: left ?? centerX, top, visibility: left === null ? 'hidden' : 'visible' }}>
      <TooltipBubble label={label} shortcut={shortcut && shortcutLabel(shortcut, window.scbOverlay.platform)} />
    </div>
  )
}
