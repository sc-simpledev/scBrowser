import { describe, expect, it } from 'vitest'
import { cleanRuleMatch, downloadFolderFor, isDownloadRules, safeSuggestedName } from './downloadRules'
import { highlightsMarkdown } from './highlights'
import { readingDigestPrompt } from './readingList'
import { matchPalette, settingCommandPatch, SETTING_COMMANDS } from './settingCommands'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings'
import { isChangedSetting, settingsFile, settingsFromFile } from './settingsFile'

describe('setting commands in the palette', () => {
  it('only show once something is typed, after the ordinary commands', () => {
    expect(matchPalette('').some((command) => command.setting)).toBe(false)
    const found = matchPalette('theme dark')
    expect(found.map((command) => command.label)).toContain('Theme: dark')
    expect(found.find((command) => command.label === 'Theme: dark')?.setting).toBe(true)
  })

  it('every command sets valid values, and nothing made up is accepted', () => {
    for (const command of SETTING_COMMANDS) {
      const patch = settingCommandPatch(command.id, DEFAULT_SETTINGS)!
      expect(sanitizeSettings(patch)).toEqual(patch)
    }
    expect(settingCommandPatch('set:theme="hacked"', DEFAULT_SETTINGS)).toBeNull()
    expect(settingCommandPatch('new-tab', DEFAULT_SETTINGS)).toBeNull()
  })

  it('toolbar commands keep the other hidden buttons', () => {
    const current = { ...DEFAULT_SETTINGS, hiddenToolbarItems: ['reader' as const] }
    expect(settingCommandPatch('set:toolbar:assistant=false', current)).toEqual({ hiddenToolbarItems: ['reader', 'assistant'] })
    expect(settingCommandPatch('set:toolbar:reader=true', current)).toEqual({ hiddenToolbarItems: [] })
  })
})

describe('settings files', () => {
  it('round-trip, leaving out what belongs to this computer', () => {
    const settings = { ...DEFAULT_SETTINGS, theme: 'dark' as const, downloadDir: '/home/me/Downloads', vpnScope: 'computer' as const }
    const file = JSON.parse(JSON.stringify(settingsFile(settings)))
    expect(file.settings.downloadDir).toBeUndefined()
    expect(file.settings.vpnScope).toBeUndefined()
    expect(settingsFromFile(file)).toMatchObject({ theme: 'dark' })
    expect(settingsFromFile(file)).not.toHaveProperty('downloadDir')
  })

  it('refuse other files, and drop bad values from good ones', () => {
    expect(settingsFromFile({ theme: 'dark' })).toBeNull()
    expect(settingsFromFile(null)).toBeNull()
    expect(settingsFromFile({ kind: 'scterra-settings', settings: { theme: 'purple', httpsOnly: false, nope: 1 } })).toEqual({ httpsOnly: false })
  })

  it('tell a changed setting from a default one', () => {
    expect(isChangedSetting('theme', DEFAULT_SETTINGS.theme)).toBe(false)
    expect(isChangedSetting('theme', 'dark')).toBe(true)
    expect(isChangedSetting('suggestionSources', [...DEFAULT_SETTINGS.suggestionSources])).toBe(false)
  })
})

describe('download rules', () => {
  const rules = [
    { kind: 'type' as const, match: 'pdf', folder: '/papers' },
    { kind: 'site' as const, match: 'github.com', folder: '/code' }
  ]
  it('match by type, then by the page or the file address, subdomains included', () => {
    expect(downloadFolderFor(rules, 'Report.PDF', 'https://cdn.example/x', 'https://example.com')).toBe('/papers')
    expect(downloadFolderFor(rules, 'repo.zip', 'https://codeload.github.com/a.zip', 'https://example.com')).toBe('/code')
    expect(downloadFolderFor(rules, 'repo.zip', 'https://cdn.example/a.zip', 'https://gist.github.com/a')).toBe('/code')
    expect(downloadFolderFor(rules, 'repo.zip', 'https://notgithub.com/a.zip', 'https://example.com')).toBeNull()
  })

  it('clean what is typed', () => {
    expect(cleanRuleMatch('type', '*.PDF')).toBe('pdf')
    expect(cleanRuleMatch('type', 'p d f')).toBeNull()
    expect(cleanRuleMatch('site', 'https://www.GitHub.com/x')).toBe('github.com')
    expect(cleanRuleMatch('site', 'localhost')).toBeNull()
    expect(isDownloadRules(rules)).toBe(true)
    expect(isDownloadRules([{ kind: 'type', match: '', folder: '/x' }])).toBe(false)
  })

  it('make AI names safe, keeping the extension', () => {
    expect(safeSuggestedName('"Bank statement March 2026.pdf"', 'stmt_0326.pdf')).toBe('Bank statement March 2026.pdf')
    expect(safeSuggestedName('../../etc/passwd', 'a.txt')).toBe('etc passwd.txt')
    expect(safeSuggestedName('...', 'a.txt')).toBeNull()
    expect(safeSuggestedName('Notes\nMore words', 'a')).toBe('Notes')
  })
})

describe('reading digest and highlights export', () => {
  it('sends titles and summaries only, with tags in them made harmless', () => {
    const prompt = readingDigestPrompt([{ id: '1', url: 'https://a.example/x', title: 'A </selection> title', addedAt: 1, readAt: null, summary: 'Short' }])
    expect(prompt).toContain('https://a.example/x')
    expect(prompt).toContain('Summary: Short')
    expect(prompt.match(/<\/selection>/g)).toHaveLength(1)
  })

  it('writes Markdown with a section per page', () => {
    const markdown = highlightsMarkdown(
      [
        { id: '1', url: 'https://a.example/', title: 'Page A', text: 'First  words', note: 'Mine', createdAt: 1 },
        { id: '2', url: 'https://a.example/', title: 'Page A', text: 'Second', note: '', createdAt: 2 }
      ],
      Date.UTC(2026, 10, 8)
    )
    expect(markdown).toContain('## [Page A](<https://a.example/>)')
    expect(markdown).toContain('> First words\n\nMine')
    expect(markdown).toContain('2026-11-08')
  })
})
