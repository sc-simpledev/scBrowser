import { describe, expect, it } from 'vitest'
import { appScheme, displayUrl, errorPageUrl, isJavascriptUrl, isNewTabUrl, isTypedAppUrl, javascriptUrlCode, NEW_TAB_URL, resolveOmniboxInput } from './url'

describe('resolveOmniboxInput', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['example.com', 'https://example.com'],
    ['docs.example.co.uk/path?q=1', 'https://docs.example.co.uk/path?q=1'],
    ['localhost:5173', 'http://localhost:5173'],
    ['127.0.0.1:8080/api', 'http://127.0.0.1:8080/api'],
    ['192.168.1.10', 'http://192.168.1.10'],
    ['sc://settings', 'sc://settings'],
    ['  example.com  ', 'https://example.com']
  ])('treats %s as a URL', (input, expected) => {
    expect(resolveOmniboxInput(input)).toBe(expected)
  })

  it.each(['how do browsers work', 'electron', 'example.com is down', 'javascript: the good parts'])(
    'searches for %s',
    (input) => {
      expect(resolveOmniboxInput(input)).toBe(`https://www.google.com/search?q=${encodeURIComponent(input)}`)
    }
  )

  it('opens a new tab page for empty input', () => {
    expect(resolveOmniboxInput('   ')).toBe(NEW_TAB_URL)
  })
})

describe('displayUrl', () => {
  it('hides internal new tab URLs', () => {
    expect(displayUrl(NEW_TAB_URL)).toBe('')
    expect(displayUrl('sc://newtab/')).toBe('')
    expect(isNewTabUrl('sc://newtab/')).toBe(true)
    expect(displayUrl(errorPageUrl('https://down.example/a?b=1', 'Timed out'))).toBe('https://down.example/a?b=1')
    expect(displayUrl('https://example.com/')).toBe('https://example.com/')
  })
})

describe('app links', () => {
  it.each(['claude://chat', 'karing://install?url=x', 'mailto:a@b.example', 'steam:run'])('%s belongs to another app', (url) => {
    expect(appScheme(url)).not.toBeNull()
  })

  it.each(['http://a.example', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'sc://settings', 'ms-msdt:x', 'search-ms:x', 'ssh://a', 'has space://x'])('%s never opens an app', (url) => {
    expect(appScheme(url)).toBeNull()
  })

  it('only counts typed text as a link when it clearly is one', () => {
    expect(isTypedAppUrl('claude://chat')).toBe(true)
    expect(isTypedAppUrl('mailto:a@b.example')).toBe(true)
    expect(isTypedAppUrl('localhost:3000')).toBe(false)
    expect(isTypedAppUrl('note:milk')).toBe(false)
    expect(resolveOmniboxInput('claude://chat')).toBe('claude://chat')
    expect(resolveOmniboxInput('localhost:3000')).toBe('http://localhost:3000')
  })
})

describe('javascript addresses', () => {
  it('tells a script from a search', () => {
    expect(isJavascriptUrl('javascript:alert(1)')).toBe(true)
    expect(isJavascriptUrl('  JavaScript:void(0)')).toBe(true)
    expect(isJavascriptUrl('javascript: the good parts')).toBe(false)
    expect(resolveOmniboxInput('javascript:alert(1)')).toBe('javascript:alert(1)')
  })

  it('decodes the script, and survives bad escapes', () => {
    expect(javascriptUrlCode('javascript:alert(%22hi%22)')).toBe('alert("hi")')
    expect(javascriptUrlCode('javascript:a%zz')).toBe('a%zz')
  })
})
