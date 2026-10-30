import { describe, expect, it } from 'vitest'
import { displayUrl, isNewTabUrl, NEW_TAB_URL, resolveOmniboxInput } from './url'

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

  it.each(['how do browsers work', 'electron', 'example.com is down', 'javascript:alert(1)'])(
    'searches for %s',
    (input) => {
      expect(resolveOmniboxInput(input)).toBe(`https://duckduckgo.com/?q=${encodeURIComponent(input)}`)
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
    expect(displayUrl('https://example.com/')).toBe('https://example.com/')
  })
})
