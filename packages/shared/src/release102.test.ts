import { describe, expect, it } from 'vitest'
import {
  autoplayBlocked,
  buildKeymap,
  CODER_BUILTIN_COMMANDS,
  fileHunks,
  isSiteAction,
  PALETTE_COMMANDS,
  PALETTE_SHORTCUTS,
  sanitizeSettings,
  WHATS_NEW,
  withSiteAutoplay
} from './index'

describe('autoplay for one site', () => {
  it('follows Settings unless the site, or the closest site above it, says otherwise', () => {
    expect(autoplayBlocked({}, 'https://news.example.com/', true)).toBe(true)
    expect(autoplayBlocked({}, 'https://news.example.com/', false)).toBe(false)
    expect(autoplayBlocked({ 'example.com': 'allow' }, 'https://news.example.com/', true)).toBe(false)
    expect(autoplayBlocked({ 'example.com': 'block' }, 'https://example.com/watch', false)).toBe(true)
    expect(autoplayBlocked({ 'example.com': 'block', 'music.example.com': 'allow' }, 'https://music.example.com/', false)).toBe(false)
    expect(autoplayBlocked({ 'example.com': 'block' }, 'https://other.test/', false)).toBe(false)
    // Pages that aren't a site, such as a file, keep Settings' choice.
    expect(autoplayBlocked({ 'example.com': 'allow' }, 'file:///home/me/a.html', true)).toBe(true)
  })

  it('keeps a rule only where the site differs from Settings', () => {
    expect(withSiteAutoplay({}, 'example.com', true, false)).toEqual({ 'example.com': 'block' })
    expect(withSiteAutoplay({}, 'example.com', false, true)).toEqual({ 'example.com': 'allow' })
    expect(withSiteAutoplay({ 'example.com': 'block', 'other.test': 'allow' }, 'example.com', false, false)).toEqual({ 'other.test': 'allow' })
  })

  it('is a setting that only takes sites and allow or block, and a padlock action', () => {
    expect(sanitizeSettings({ siteAutoplay: { 'example.com': 'allow', 'news.test': 'block' } })).toEqual({ siteAutoplay: { 'example.com': 'allow', 'news.test': 'block' } })
    expect(sanitizeSettings({ siteAutoplay: { 'example.com': 'sometimes' } })).toEqual({})
    expect(sanitizeSettings({ siteAutoplay: { 'not a host': 'allow' } })).toEqual({})
    expect(sanitizeSettings({ siteAutoplay: ['example.com'] })).toEqual({})
    expect(isSiteAction('content:autoplay')).toBe(true)
  })
})

describe('bookmark all tabs from the keyboard', () => {
  it('is Ctrl Shift D, shown in the palette, and changeable like any shortcut', () => {
    expect(buildKeymap({}).get('Ctrl+Shift+D')).toBe('bookmark-all-tabs')
    expect(buildKeymap({ 'bookmark-all-tabs': ['Ctrl+Alt+B'] }).get('Ctrl+Shift+D')).toBeUndefined()
    expect(PALETTE_SHORTCUTS['bookmark-all-tabs']).toBe('bookmark-all-tabs')
    expect(PALETTE_COMMANDS.find((command) => command.id === 'bookmark-all-tabs')?.shortcut).toBe('Ctrl Shift D')
    // Ctrl D on its own still bookmarks just the page.
    expect(buildKeymap({}).get('Ctrl+D')).toBe('bookmark')
  })
})

describe('review of a change', () => {
  it('shows lines around a change, but not the empty piece after a file’s last newline', () => {
    const [hunk] = fileHunks('one\ntwo\nthree\nfour\n', 'one\ntwo\nTHREE\nfour\n')
    expect(hunk!.line).toBe(3)
    expect(hunk!.rows).toEqual(['  one', '  two', '- three', '+ THREE', '  four'])
    // A file without a last newline keeps every line it has.
    expect(fileHunks('a\nb', 'A\nb')[0]!.rows).toEqual(['- a', '+ A', '  b'])
  })
})

describe('Terra Code commands', () => {
  it('has /rename', () => {
    expect(CODER_BUILTIN_COMMANDS.find((command) => command.name === 'rename')).toMatchObject({ args: '<name>' })
  })
})

describe('What’s new', () => {
  it('leads with 1.0.2', () => {
    expect(WHATS_NEW[0]!.version).toBe('1.0.2')
    expect(WHATS_NEW[0]!.items.length).toBeGreaterThan(3)
  })
})
