import { describe, expect, it } from 'vitest'
import { memoryPrompt, rememberCommand } from './memory'
import { siteFontOf, withSiteFont } from './siteFont'

describe('site font', () => {
  it('adds, reads, changes and removes its block without touching other CSS', () => {
    const css = 'a { color: red }\n'
    const serif = withSiteFont(css, 'serif')
    expect(siteFontOf(serif)).toBe('serif')
    expect(serif).toContain('a { color: red }')
    const mono = withSiteFont(serif, 'mono')
    expect(siteFontOf(mono)).toBe('mono')
    expect(mono.match(/scterra-font:/g)).toHaveLength(1)
    expect(withSiteFont(mono, 'default')).toBe(css)
    expect(siteFontOf(css)).toBe('default')
  })
})

describe('memory', () => {
  it('says nothing with no notes', () => expect(memoryPrompt([])).toBe(''))
  it('lists notes on one line each', () => expect(memoryPrompt([{ text: 'likes\ntabs' }])).toContain('- likes tabs'))
  it('reads /remember', () => {
    expect(rememberCommand(' /remember I use pnpm ')).toBe('I use pnpm')
    expect(rememberCommand('remember this')).toBeNull()
    expect(rememberCommand('/remember')).toBeNull()
  })
})
