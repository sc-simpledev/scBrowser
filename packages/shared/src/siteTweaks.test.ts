import { describe, expect, it } from 'vitest'
import { belongsToSite, isHiddenElements, isSafeSelector, isSiteHost, siteBase, siteOf, siteTweakCss } from './siteTweaks'

describe('sites', () => {
  it('treats www and subdomains as the same site, and nothing else', () => {
    expect(siteBase('WWW.Example.com.')).toBe('example.com')
    expect(belongsToSite('mail.example.com', 'example.com')).toBe(true)
    expect(belongsToSite('.example.com', 'example.com')).toBe(true)
    expect(belongsToSite('notexample.com', 'example.com')).toBe(false)
    expect(belongsToSite('example.com.evil.net', 'example.com')).toBe(false)
  })

  it('only gives a site for web addresses', () => {
    expect(siteOf('https://www.example.com/page#x')).toBe('example.com')
    expect(siteOf('sc://settings')).toBeNull()
    expect(siteOf('file:///home/a.html')).toBeNull()
    expect(siteOf('not a url')).toBeNull()
  })

  it('checks hosts', () => {
    expect(isSiteHost('example.com')).toBe(true)
    expect(isSiteHost('127.0.0.1')).toBe(true)
    expect(isSiteHost('exa mple.com')).toBe(false)
    expect(isSiteHost('-bad.com')).toBe(false)
  })
})

describe('hidden parts', () => {
  it('only takes selectors that can’t break out of their rule', () => {
    expect(isSafeSelector('#sidebar > div.ad:nth-of-type(2)')).toBe(true)
    expect(isSafeSelector('body > main > aside')).toBe(true)
    expect(isSafeSelector('div} body { display:none')).toBe(false)
    expect(isSafeSelector('a; @import url(x)')).toBe(false)
    expect(isSafeSelector('[data-x="1"]')).toBe(false)
    expect(isSafeSelector('')).toBe(false)
  })

  it('validates the stored map', () => {
    expect(isHiddenElements({ 'example.com': ['#a'] })).toBe(true)
    expect(isHiddenElements({ 'example.com': ['a{}'] })).toBe(false)
    expect(isHiddenElements({ 'bad host': ['#a'] })).toBe(false)
    expect(isHiddenElements([])).toBe(false)
  })

  it('builds CSS for the site and its subdomains only', () => {
    const hidden = { 'example.com': ['#banner', '.promo'], 'other.com': ['#x'] }
    const css = siteTweakCss('news.example.com', hidden, { 'example.com': 'body { color: red }' })
    expect(css).toContain('#banner,\n.promo { display: none !important; }')
    expect(css).toContain('body { color: red }')
    expect(css).not.toContain('#x')
    expect(siteTweakCss('unrelated.org', hidden, {})).toBe('')
  })
})
