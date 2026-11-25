import { describe, expect, it } from 'vitest'
import { SKILL_GALLERY } from './ai'
import { chatFileName, chatMarkdown, chatTitle } from './chatExport'
import { highlightLink } from './citations'
import { buildSuggestions } from './omnibox'
import { isHalfRead, minutesLeft, pickForMinutes, type ReadingItem } from './readingList'
import { DEFAULT_SETTINGS, REPLY_STYLES, replyStylePrompt, sanitizeSettings } from './settings'
import { SETTING_COMMANDS } from './settingCommands'
import { inSyncedOrder, mergeSync, EMPTY_SYNC } from './sync'
import { nowPlayingTab } from './tabs'
import { cleanUrl, DEFAULT_SEARCH_KEYWORDS, isSearchKeywords, keywordNamed, keywordSearch, resolveOmniboxInput } from './url'

describe('clean links', () => {
  it('takes tracking tags off and leaves everything else exactly as written', () => {
    expect(cleanUrl('https://news.example/story?id=7&utm_source=mail&utm_medium=x&fbclid=abc')).toBe('https://news.example/story?id=7')
    expect(cleanUrl('https://shop.example/?q=a%20b&gclid=1#reviews')).toBe('https://shop.example/?q=a%20b#reviews')
    expect(cleanUrl('https://shop.example/?gclid=1')).toBe('https://shop.example/')
    expect(cleanUrl('https://a.example/?UTM_Campaign=x&keep=1')).toBe('https://a.example/?keep=1')
  })

  it('leaves addresses with nothing to take off, routes after the #, and other schemes alone', () => {
    expect(cleanUrl('https://a.example/?q=utm_source')).toBe('https://a.example/?q=utm_source')
    expect(cleanUrl('https://app.example/#/page?utm_source=x')).toBe('https://app.example/#/page?utm_source=x')
    expect(cleanUrl('sc://settings/?utm_source=x')).toBe('sc://settings/?utm_source=x')
  })

  it('only takes the share tag off sites that use it as one', () => {
    expect(cleanUrl('https://youtu.be/abc?si=xyz&t=30')).toBe('https://youtu.be/abc?t=30')
    expect(cleanUrl('https://maps.example/?si=2')).toBe('https://maps.example/?si=2')
  })
})

describe('search keywords', () => {
  it('searches a site for what follows a keyword', () => {
    const found = keywordSearch('yt  lofi beats ', DEFAULT_SEARCH_KEYWORDS)
    expect(found?.keyword.name).toBe('YouTube')
    expect(found?.url).toBe('https://www.youtube.com/results?search_query=lofi%20beats')
    expect(keywordSearch('YT cats', DEFAULT_SEARCH_KEYWORDS)?.keyword.keyword).toBe('yt')
    expect(keywordSearch('yt', DEFAULT_SEARCH_KEYWORDS)).toBeNull()
    expect(keywordSearch('youtube cats', DEFAULT_SEARCH_KEYWORDS)).toBeNull()
    expect(keywordNamed('wiki', DEFAULT_SEARCH_KEYWORDS)?.name).toBe('Wikipedia')
  })

  it('is what the address bar opens, before anything else is tried', () => {
    expect(resolveOmniboxInput('gh electron', undefined, DEFAULT_SEARCH_KEYWORDS)).toBe('https://github.com/search?q=electron')
    expect(resolveOmniboxInput('gh electron')).toBe('https://www.google.com/search?q=gh%20electron')
    expect(resolveOmniboxInput('example.com', undefined, DEFAULT_SEARCH_KEYWORDS)).toBe('https://example.com')
  })

  it('leads the address bar with the site search, the web search one row down', () => {
    const rows = buildSuggestions('wiki Moon', { history: [], tabs: [], activeTabId: null, keywords: DEFAULT_SEARCH_KEYWORDS })
    expect(rows[0]).toMatchObject({ kind: 'search', title: 'Moon', detail: 'Search Wikipedia', action: { type: 'navigate', url: 'https://en.wikipedia.org/w/index.php?search=Moon' } })
    expect(rows[1]).toMatchObject({ id: 'web', detail: 'Search Google' })
  })

  it('says what a keyword on its own does, and fills in the space when picked', () => {
    const rows = buildSuggestions('yt', { history: [], tabs: [], activeTabId: null, keywords: DEFAULT_SEARCH_KEYWORDS })
    expect(rows[0]!.detail).toBe('Search Google')
    expect(rows.find((row) => row.kind === 'keyword')).toMatchObject({ title: 'Search YouTube', action: { type: 'fill', text: 'yt ' } })
  })

  it('accepts only sound keyword lists', () => {
    expect(isSearchKeywords(DEFAULT_SEARCH_KEYWORDS)).toBe(true)
    expect(isSearchKeywords([...DEFAULT_SEARCH_KEYWORDS, { keyword: 'YT', name: 'Again', template: 'https://a.example/?q=%s' }])).toBe(false)
    expect(isSearchKeywords([{ keyword: 'x', name: 'No search', template: 'https://a.example/' }])).toBe(false)
    expect(isSearchKeywords([{ keyword: 'js', name: 'Script', template: 'javascript:alert(%s)' }])).toBe(false)
    // A keyword that looks like an address would hide the address.
    expect(isSearchKeywords([{ keyword: 'a.com', name: 'A', template: 'https://a.example/?q=%s' }])).toBe(false)
  })
})

describe('links to a highlight', () => {
  it('points at the words, escaping the ones text fragments treat as punctuation', () => {
    expect(highlightLink('https://a.example/post#top', 'state-of-the-art, fast & small')).toBe('https://a.example/post#:~:text=state%2Dof%2Dthe%2Dart%2C%20fast%20%26%20small')
  })

  it('names a long selection by its first and last words', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen'
    expect(highlightLink('https://a.example/', long)).toBe('https://a.example/#:~:text=one%20two%20three%20four%20five,thirteen%20fourteen%20fifteen%20sixteen%20seventeen')
  })

  it('has nothing to point at on pages that aren\'t websites', () => {
    expect(highlightLink('sc://settings/', 'words')).toBeNull()
    expect(highlightLink('https://a.example/', '   ')).toBeNull()
  })
})

describe('saving a chat', () => {
  const report = '```scterra-report\n{"title":"Tea or coffee","summary":"Tea wins.","theme":"clean","blocks":[{"type":"paragraph","text":"Tea has less caffeine."}]}\n```'
  const turns = [
    { role: 'user' as const, content: 'Compare tea and coffee for me please' },
    { role: 'assistant' as const, content: `Here it is.\n\n${report}`, pageTitle: 'Drinks' }
  ]

  it('writes reports out as Markdown, never as their JSON', () => {
    const text = chatMarkdown(turns, new Date(2026, 10, 25, 9, 30))
    expect(text).toMatch(/^# Compare tea and coffee for me please\n/)
    expect(text).toContain('## You')
    expect(text).toContain('## scAI')
    expect(text).toContain('_About: Drinks_')
    expect(text).toContain('Tea has less caffeine.')
    expect(text).not.toContain('"blocks"')
  })

  it('writes questions the reply asked as a list', () => {
    const asked = 'Which one?\n\n```scterra-question\n{"question":"Pick a drink","options":["Tea",{"label":"Coffee","description":"Stronger"}]}\n```'
    const text = chatMarkdown([{ role: 'user', content: 'Help' }, { role: 'assistant', content: asked }], new Date())
    expect(text).toContain('**Pick a drink**\n- Tea\n- Coffee: Stronger')
    expect(text).not.toContain('scterra-question')
  })

  it('names the file after the first message, safely', () => {
    expect(chatTitle([])).toBe('Chat')
    expect(chatFileName([{ role: 'user', content: 'What is a/b: <test>?' }])).toBe('What is a b test.md')
    expect(chatFileName([{ role: 'user', content: 'x'.repeat(200) }]).length).toBeLessThanOrEqual(63)
  })
})

describe('reply styles', () => {
  it('adds one line to the system prompt, and nothing for Normal', () => {
    expect(replyStylePrompt('normal')).toBe('')
    expect(replyStylePrompt('concise')).toMatch(/^\n\nReply style: Keep replies short/)
    expect(new Set(REPLY_STYLES.map((style) => style.id)).size).toBe(REPLY_STYLES.length)
  })

  it('is a setting the palette can change', () => {
    expect(SETTING_COMMANDS.some((command) => command.id === 'set:replyStyle="steps"')).toBe(true)
    expect(SETTING_COMMANDS.some((command) => command.id.startsWith('set:cleanLinks='))).toBe(true)
  })
})

describe('new settings', () => {
  it('keeps good values and drops bad ones', () => {
    expect(sanitizeSettings({ cleanLinks: false, mediaControls: false, autoPictureInPicture: true, replyStyle: 'explanatory', searchKeywords: [] })).toEqual({
      cleanLinks: false,
      mediaControls: false,
      autoPictureInPicture: true,
      replyStyle: 'explanatory',
      searchKeywords: []
    })
    expect(sanitizeSettings({ replyStyle: 'rude', mediaControls: 'yes', searchKeywords: [{ keyword: '' }] })).toEqual({})
    expect(DEFAULT_SETTINGS.cleanLinks).toBe(true)
    expect(DEFAULT_SETTINGS.autoPictureInPicture).toBe(false)
  })
})

describe('now playing', () => {
  const tab = (id: number, media: 'playing' | 'paused' | null) => ({ id, media })

  it('shows sound away from the screen: playing first, else the last paused', () => {
    expect(nowPlayingTab([tab(1, 'paused'), tab(2, 'playing'), tab(3, 'paused')], [9])?.id).toBe(2)
    expect(nowPlayingTab([tab(1, 'paused'), tab(3, 'paused')], [9])?.id).toBe(3)
    expect(nowPlayingTab([tab(1, 'playing')], [1])).toBeNull()
    expect(nowPlayingTab([tab(1, 'playing'), tab(2, 'playing')], [1, 2])).toBeNull()
    expect(nowPlayingTab([tab(1, null)], [])).toBeNull()
  })
})

describe('reading progress', () => {
  const item = (patch: Partial<ReadingItem>): ReadingItem => ({ id: String(Math.random()), url: 'https://a.example/', title: 'A', addedAt: 0, readAt: null, summary: null, ...patch })

  it('counts a page as half-read between the start and the end', () => {
    expect(isHalfRead(item({ progress: 0.5 }))).toBe(true)
    expect(isHalfRead(item({ progress: 0.01 }))).toBe(false)
    expect(isHalfRead(item({ progress: 0.99 }))).toBe(false)
    expect(minutesLeft(item({ minutes: 20, progress: 0.75 }))).toBe(5)
    expect(minutesLeft(item({ minutes: 20 }))).toBe(20)
  })

  it('offers to finish a half-read page before starting a new one', () => {
    const fresh = item({ title: 'Fresh', minutes: 8 })
    const started = item({ title: 'Started', minutes: 30, progress: 0.8, readAt: 5 })
    expect(pickForMinutes([fresh, started], 10)?.title).toBe('Started')
    expect(pickForMinutes([fresh, started], 5)?.title).toBe('Fresh')
  })
})

describe('bookmark order in sync', () => {
  it('puts items in the synced order, and anything it doesn\'t name after', () => {
    expect(inSyncedOrder(['a', 'b', 'c', 'd'], (key) => key, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('merges the order of each folder, this device winning when both changed it', () => {
    const base = { ...EMPTY_SYNC, order: { '': ['b:1', 'b:2'] } }
    const local = { ...EMPTY_SYNC, order: { '': ['b:1', 'b:2'], Work: ['b:3', 'b:4'] } }
    const remote = { ...EMPTY_SYNC, order: { '': ['b:2', 'b:1'] } }
    expect(mergeSync(base, local, remote).order).toEqual({ '': ['b:2', 'b:1'], Work: ['b:3', 'b:4'] })
    // A file from an older version has no order at all, which isn't the same as none.
    expect(mergeSync(base, local, EMPTY_SYNC).order).toEqual(local.order)
  })
})

describe('skill gallery', () => {
  it('has distinct names and real prompts', () => {
    expect(new Set(SKILL_GALLERY.map((skill) => skill.name)).size).toBe(SKILL_GALLERY.length)
    expect(SKILL_GALLERY.every((skill) => skill.prompt.length > 30 && skill.description.length < 40)).toBe(true)
  })
})
