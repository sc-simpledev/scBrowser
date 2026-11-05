import { describe, expect, it } from 'vitest'
import { highlight } from './highlight'

describe('highlight', () => {
  it('keeps every character, in order', () => {
    const code = 'const a = "x" // hi\nlet b = 2'
    expect(highlight(code, 'javascript').map((t) => t.text).join('')).toBe(code)
  })

  it('marks keywords, strings, numbers, comments and tags', () => {
    const kinds = (code: string, language: string) => highlight(code, language).filter((t) => t.kind !== 'plain').map((t) => [t.kind, t.text.trim()])
    expect(kinds('const a = "x" // hi', 'javascript')).toEqual([['keyword', 'const'], ['string', '"x"'], ['comment', '// hi']])
    expect(kinds('<a href="x">', 'html')).toEqual([['tag', '<a'], ['attr', 'href'], ['string', '"x"'], ['tag', '>']])
    expect(kinds('def f(): return 1', 'python')).toEqual([['keyword', 'def'], ['keyword', 'return'], ['number', '1']])
  })

  it('leaves plain text and huge files alone', () => {
    expect(highlight('hello', 'text')).toEqual([{ kind: 'plain', text: 'hello' }])
    expect(highlight('x'.repeat(300_000), 'javascript')).toHaveLength(1)
  })
})
