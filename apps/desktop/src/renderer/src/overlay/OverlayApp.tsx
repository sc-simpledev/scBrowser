import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TooltipBubble } from '@scbrowser/ui'
import { EMPTY_OVERLAY, OVERLAY_MARGIN, POPUP_GAP, TOOLTIP_GAP, type OverlayEvents } from '@scbrowser/shared'
import { SuggestionList } from './SuggestionList'

type Payload = OverlayEvents['overlay:state']

export function OverlayApp() {
  const [{ state, origin }, setPayload] = useState<Payload>({ state: EMPTY_OVERLAY, origin: { x: 0, y: 0 } })

  useEffect(() => window.scbOverlay.on('overlay:state', setPayload), [])

  const { omnibox, tooltip } = state
  return (
    <>
      {omnibox && omnibox.suggestions.length > 0 && (
        <div
          className="absolute"
          style={{
            left: omnibox.anchor.x - origin.x,
            top: omnibox.anchor.y + omnibox.anchor.height + POPUP_GAP - origin.y,
            width: omnibox.anchor.width
          }}
        >
          <SuggestionList
            suggestions={omnibox.suggestions}
            selectedIndex={omnibox.selectedIndex}
            onPick={(index) => void window.scbOverlay.invoke('overlay:pick', index)}
          />
        </div>
      )}
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
      <TooltipBubble label={label} shortcut={shortcut} />
    </div>
  )
}
