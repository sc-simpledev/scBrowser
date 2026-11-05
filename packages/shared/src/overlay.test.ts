import { describe, expect, it } from 'vitest'
import { EMPTY_OVERLAY, overlayRegions, type OverlayView } from './overlay'

const view = (patch: Partial<OverlayView>): OverlayView => ({ ...EMPTY_OVERLAY, permission: null, palette: null, tabSearch: null, appLink: null, extensionsPopup: null, extensionFrame: null, accent: 'teal', performance: false, toast: null, bookmarkEditor: null, auth: null, passwordPrompt: null, cleanup: null, workspaceEditor: null, ...patch })

describe('overlayRegions', () => {
  it('keeps a tooltip to its own bubble, as the overlay blocks clicks wherever it covers', () => {
    const anchor = { x: 100, y: 6, width: 32, height: 32 }
    const [region] = overlayRegions(view({ tooltip: { anchor, label: 'Back' } }))
    expect(region!.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
    expect(region!.height).toBeLessThanOrEqual(28)
    expect(region!.width).toBeLessThan(80)
  })
})
