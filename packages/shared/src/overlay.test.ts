import { describe, expect, it } from 'vitest'
import { EMPTY_OVERLAY, LINK_PREVIEW, linkPreviewLayout, overlayBounds, overlayRegions, type OverlayView } from './overlay'

const view = (patch: Partial<OverlayView>): OverlayView => ({ ...EMPTY_OVERLAY, permission: null, palette: null, tabSearch: null, appLink: null, extensionsPopup: null, extensionFrame: null, accent: 'teal', performance: false, toast: null, bookmarkEditor: null, auth: null, passwordPrompt: null, passwordSuggest: null, cleanup: null, workspaceEditor: null, linkPreview: null, siteControls: null, ...patch })

describe('overlayRegions', () => {
  it('keeps a tooltip to its own bubble, as the overlay blocks clicks wherever it covers', () => {
    const anchor = { x: 100, y: 6, width: 32, height: 32 }
    const [region] = overlayRegions(view({ tooltip: { anchor, label: 'Back' } }))
    expect(region!.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
    expect(region!.height).toBeLessThanOrEqual(28)
    expect(region!.width).toBeLessThan(80)
  })
})

describe('link preview layout', () => {
  it('centres the card in the page, with the page under its header', () => {
    const page = { x: 240, y: 80, width: 1200, height: 800 }
    const { card, view } = linkPreviewLayout(page)
    expect(card.x - page.x).toBe(page.x + page.width - (card.x + card.width))
    expect(card.width).toBeLessThanOrEqual(LINK_PREVIEW.maxWidth)
    expect(view.y).toBe(card.y + LINK_PREVIEW.header)
    expect(view.height).toBe(card.height - LINK_PREVIEW.header)
  })

  it('keeps a small margin in a narrow page', () => {
    const { card } = linkPreviewLayout({ x: 0, y: 0, width: 500, height: 600 })
    expect(card.x).toBe(12)
    expect(card.width).toBe(476)
  })

  it('makes the whole page take clicks, so clicking beside it closes it', () => {
    const backdrop = { x: 240, y: 80, width: 1200, height: 800 }
    expect(overlayRegions(view({ linkPreview: { backdrop, card: backdrop, title: '', url: 'https://a.com', loading: false } }))).toContainEqual(backdrop)
  })
})

describe('overlayBounds', () => {
  const tooltip = { anchor: { x: 10, y: 5, width: 100, height: 30 }, label: 'Tab' }
  const toast = { text: 'Saved', x: 900, y: 600 }
  it('never stretches over the tabs and page to hold two popups far apart', () => {
    const both = overlayBounds({ ...EMPTY_OVERLAY, tooltip, toast } as unknown as OverlayView)!
    expect(both.x).toBeGreaterThan(800)
    expect(both.width).toBeLessThan(500)
  })
  it('is empty with nothing to show', () => {
    expect(overlayBounds(EMPTY_OVERLAY as unknown as OverlayView)).toBeNull()
  })
})
