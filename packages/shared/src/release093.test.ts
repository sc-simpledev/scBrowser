import { describe, expect, it } from 'vitest'
import { clearSince } from './clearData'
import { fullToolbarOrder, TOOLBAR_SLOTS } from './containers'
import { gestureArrows, gestureFrom } from './gestures'
import { overlayRegions, tooltipBox, tooltipSize, TAB_PREVIEW, TOOLTIP_CARD } from './overlay'
import { DEFAULT_READER_STYLE, isReaderStyle } from './reader'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings'
import { buildKeymap, comboAccelerator, comboFromKey, comboLabel, isCombo, isFixedCombo, isShortcutOverrides, isUsableCombo, PALETTE_SHORTCUTS, shortcutKeys, shortcutUsing, SHORTCUTS } from './shortcuts'
import { linksMarkdown } from './tabs'
import { PALETTE_COMMANDS } from './privacy'

const key = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta
})

describe('keyboard shortcuts', () => {
  it('writes key presses the way the table does', () => {
    expect(comboFromKey(key('t', 'KeyT', { ctrl: true }), 'linux')).toBe('Ctrl+T')
    expect(comboFromKey(key('T', 'KeyT', { ctrl: true, shift: true }), 'linux')).toBe('Ctrl+Shift+T')
    expect(comboFromKey(key('ArrowLeft', 'ArrowLeft', { alt: true }), 'linux')).toBe('Alt+Left')
    expect(comboFromKey(key('Delete', 'Delete', { ctrl: true, shift: true }), 'linux')).toBe('Ctrl+Shift+Delete')
    expect(comboFromKey(key('F5', 'F5', { shift: true }), 'linux')).toBe('Shift+F5')
    expect(comboFromKey(key('=', 'Equal', { ctrl: true }), 'linux')).toBe('Ctrl+=')
    expect(comboFromKey(key('+', 'Equal', { ctrl: true, shift: true }), 'linux')).toBe('Ctrl+Shift+Plus')
    // With Shift, the key is the shifted sign; where it sits says which it is.
    expect(comboFromKey(key('>', 'Period', { ctrl: true, shift: true }), 'linux')).toBe('Ctrl+Shift+.')
    expect(comboFromKey(key('!', 'Digit1', { ctrl: true, shift: true }), 'linux')).toBe('Ctrl+Shift+1')
    expect(comboFromKey(key('Control', 'ControlLeft', { ctrl: true }), 'linux')).toBeNull()
  })

  it('takes ⌘ as Ctrl on a Mac, but Control Tab stays Ctrl Tab', () => {
    expect(comboFromKey(key('t', 'KeyT', { meta: true }), 'darwin')).toBe('Ctrl+T')
    expect(comboFromKey(key('t', 'KeyT', { ctrl: true }), 'darwin')).toBe('T')
    expect(comboFromKey(key('Tab', 'Tab', { ctrl: true }), 'darwin')).toBe('Ctrl+Tab')
  })

  it('every default key is well formed, usable and used by one shortcut only', () => {
    const all = SHORTCUTS.flatMap((shortcut) => shortcut.keys)
    for (const combo of all) {
      expect(isCombo(combo), combo).toBe(true)
      expect(isUsableCombo(combo), combo).toBe(true)
    }
    expect(new Set(all).size).toBe(all.length)
    expect(buildKeymap({}).get('Ctrl+T')).toBe('new-tab')
    expect(buildKeymap({}).get('Ctrl+Shift+Delete')).toBe('clear-data')
  })

  it('refuses keys that belong to the page or are written another way', () => {
    expect(isUsableCombo('T')).toBe(false)
    expect(isUsableCombo('Shift+T')).toBe(false)
    expect(isCombo('Shift+Ctrl+T')).toBe(false)
    expect(isCombo('Ctrl+Ctrl+T')).toBe(false)
    expect(isCombo('Ctrl+Banana')).toBe(false)
    expect(isShortcutOverrides({ 'new-tab': ['Ctrl+Alt+T'] })).toBe(true)
    expect(isShortcutOverrides({ 'no-such-thing': ['Ctrl+Alt+T'] })).toBe(false)
    expect(isShortcutOverrides({ 'new-tab': ['T'] })).toBe(false)
    expect(isShortcutOverrides({ 'new-tab': ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4'] })).toBe(false)
    expect(isFixedCombo('Ctrl+3')).toBe(true)
    expect(isFixedCombo('Ctrl+Alt+3')).toBe(true)
    expect(isFixedCombo('Ctrl+0')).toBe(false)
  })

  it('a key given to one shortcut leaves the one it came from', () => {
    const overrides = { 'search-tabs': ['Ctrl+T'] }
    const map = buildKeymap(overrides)
    expect(map.get('Ctrl+T')).toBe('search-tabs')
    expect(map.get('Ctrl+Shift+E')).toBeUndefined()
    expect(shortcutUsing('Ctrl+T', {}, 'search-tabs')).toBe('new-tab')
    expect(shortcutUsing('Ctrl+T', {}, 'new-tab')).toBeNull()
    expect(shortcutKeys('new-tab', { 'new-tab': [] })).toEqual([])
    expect(buildKeymap({ 'new-tab': [] }).get('Ctrl+T')).toBeUndefined()
  })

  it('shows keys as people read them and as menus want them', () => {
    expect(comboLabel('Ctrl+Shift+T', 'linux')).toBe('Ctrl Shift T')
    expect(comboLabel('Alt+Left', 'linux')).toBe('Alt ←')
    expect(comboLabel('Ctrl+Shift+T', 'darwin')).toBe('⌘ ⇧ T')
    expect(comboLabel('Shift+Escape', 'linux')).toBe('Shift Esc')
    expect(comboAccelerator('Ctrl+Shift+T')).toBe('CmdOrCtrl+Shift+T')
    expect(comboAccelerator('Shift+Escape')).toBe('Shift+Esc')
  })

  it('palette rows point at real shortcuts and real commands', () => {
    for (const [command, shortcut] of Object.entries(PALETTE_SHORTCUTS)) {
      expect(PALETTE_COMMANDS.some((entry) => entry.id === command), command).toBe(true)
      expect(SHORTCUTS.some((entry) => entry.id === shortcut), shortcut).toBe(true)
    }
  })

  it('keeps only valid changed keys in settings', () => {
    expect(sanitizeSettings({ shortcuts: { 'new-tab': ['Ctrl+Alt+N'] } })).toEqual({ shortcuts: { 'new-tab': ['Ctrl+Alt+N'] } })
    expect(sanitizeSettings({ shortcuts: { 'new-tab': ['N'] } })).toEqual({})
  })
})

describe('settings added in 0.9.3', () => {
  it('takes startup pages and a home page only as web addresses', () => {
    expect(sanitizeSettings({ startup: 'pages', startupPages: ['https://example.com/', 'http://a.test/x'] })).toEqual({ startup: 'pages', startupPages: ['https://example.com/', 'http://a.test/x'] })
    expect(sanitizeSettings({ startupPages: ['javascript:alert(1)'] })).toEqual({})
    expect(sanitizeSettings({ startupPages: ['sc://settings'] })).toEqual({})
    expect(sanitizeSettings({ homePage: '' })).toEqual({ homePage: '' })
    expect(sanitizeSettings({ homePage: 'file:///etc/passwd' })).toEqual({})
  })

  it('takes zoom and text sizes only from their choices', () => {
    expect(sanitizeSettings({ defaultZoom: 125, fontSize: 20, minimumFontSize: 12 })).toEqual({ defaultZoom: 125, fontSize: 20, minimumFontSize: 12 })
    expect(sanitizeSettings({ defaultZoom: 133, fontSize: 4, minimumFontSize: 99 })).toEqual({})
  })

  it('keeps site lists to real host names', () => {
    expect(sanitizeSettings({ popupsAllowed: ['example.com'], mutedSites: ['news.example'] })).toEqual({ popupsAllowed: ['example.com'], mutedSites: ['news.example'] })
    expect(sanitizeSettings({ popupsAllowed: ['https://example.com/'] })).toEqual({})
  })

  it('starts with privacy on and the mouse extras off', () => {
    expect(DEFAULT_SETTINGS.globalPrivacyControl).toBe(true)
    expect(DEFAULT_SETTINGS.mouseGestures).toBe(false)
    expect(DEFAULT_SETTINGS.middleClickScroll).toBe(false)
    expect(DEFAULT_SETTINGS.tabCycleOrder).toBe('strip')
  })

  it('checks reader styles field by field', () => {
    expect(isReaderStyle(DEFAULT_READER_STYLE)).toBe(true)
    expect(isReaderStyle({ font: 'serif', size: 'larger', width: 'wide', theme: 'sepia' })).toBe(true)
    expect(isReaderStyle({ font: 'comic', size: 'larger', width: 'wide', theme: 'sepia' })).toBe(false)
    expect(isReaderStyle({ ...DEFAULT_READER_STYLE, extra: 1 })).toBe(false)
  })
})

describe('a new toolbar slot', () => {
  it('goes after the slot it follows, in an order someone saved before it existed', () => {
    const saved = TOOLBAR_SLOTS.filter((slot) => slot !== 'home')
    expect(fullToolbarOrder(saved)).toEqual([...TOOLBAR_SLOTS])
    const moved = ['omnibox', 'back', 'forward', 'reload', 'vpn', 'split', 'downloads', 'passwords', 'extensions'] as const
    expect(fullToolbarOrder([...moved])).toEqual(['omnibox', 'back', 'forward', 'reload', 'home', 'vpn', 'split', 'downloads', 'passwords', 'extensions'])
  })
})

describe('copying tabs as links', () => {
  it('gives one address as it is, and more as a Markdown list', () => {
    expect(linksMarkdown([{ title: 'A', url: 'https://a.example/' }])).toBe('https://a.example/')
    expect(linksMarkdown([{ title: 'A [draft]', url: 'https://a.example/x (1)' }, { title: '  Two\nlines ', url: 'https://b.example/' }])).toBe(
      '- [A \\[draft\\]](https://a.example/x%20%281%29)\n- [Two lines](https://b.example/)'
    )
  })
})

describe('clear browsing data', () => {
  it('reaches back as far as the range says', () => {
    const now = 1_000_000_000_000
    expect(clearSince('hour', now)).toBe(now - 3_600_000)
    expect(clearSince('month', now)).toBe(now - 28 * 86_400_000)
    expect(clearSince('all', now)).toBe(0)
  })
})

describe('mouse gestures', () => {
  it('reads drawn paths', () => {
    expect(gestureFrom('L')).toBe('back')
    expect(gestureFrom('DR')).toBe('close')
    expect(gestureFrom('LRLR')).toBeNull()
    expect(gestureArrows('UD')).toBe('↑ ↓')
  })
})

describe('tab previews in hover cards', () => {
  it('makes room for the picture over the title', () => {
    const anchor = { x: 0, y: 40, width: 200, height: 30 }
    const plain = tooltipSize({ label: 'A page', detail: 'example.com' })
    const withPicture = tooltipSize({ label: 'A page', detail: 'example.com', image: 'data:image/jpeg;base64,AAAA' })
    expect(withPicture.width).toBe(TOOLTIP_CARD.width)
    expect(withPicture.height).toBe(plain.height + TAB_PREVIEW.height + TAB_PREVIEW.gap)
    // Under the first tab across the top it stays inside the window.
    expect(tooltipBox({ anchor, label: 'A page', detail: 'example.com', image: 'data:,', placement: 'below' }).x).toBeGreaterThanOrEqual(0)
    expect(overlayRegions({ omnibox: null, tooltip: { anchor, label: 'A page', image: 'data:,', placement: 'below' } } as never).length).toBeGreaterThan(0)
  })
})
