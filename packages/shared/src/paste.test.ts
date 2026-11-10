import { describe, expect, it } from 'vitest'
import { cleanPasted } from './paste'

describe('cleanPasted', () => {
  it('writes out escaped characters', () => {
    expect(cleanPasted('How does access affect people&#39;s daily lives?')).toBe("How does access affect people's daily lives?")
    expect(cleanPasted('Fish &amp; chips &ndash; &quot;cheap&quot; &#x2014; &copy;')).toBe('Fish & chips – "cheap" — ©')
  })
  it('leaves code and unknown entities alone', () => {
    expect(cleanPasted('<p>&amp;</p>')).toBe('<p>&amp;</p>')
    expect(cleanPasted('&notathing; &#0;')).toBe('&notathing; &#0;')
  })
  it('drops invisible characters and extra blank lines', () => {
    expect(cleanPasted('a​b c\r\n\r\n\r\n\r\nd  \n')).toBe('ab c\n\nd\n')
  })
})
