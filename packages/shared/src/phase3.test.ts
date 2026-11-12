import { describe, expect, it } from 'vitest'
import { recapPrompt, yesterdayRange } from './recap'
import { AI_COMMAND, matchPalette } from './settingCommands'

describe('palette', () => {
  it('offers a sentence to the AI, and not a single word', () => {
    const rows = matchPalette('close all youtube tabs')
    expect(rows.at(-1)).toMatchObject({ id: `${AI_COMMAND}close all youtube tabs`, ai: true })
    expect(matchPalette('history').some((row) => row.ai)).toBe(false)
    expect(matchPalette('').some((row) => row.ai)).toBe(false)
  })
})

describe('recap', () => {
  it('covers the whole of yesterday in local time', () => {
    const { after, before } = yesterdayRange(new Date(2026, 10, 13, 9, 30).getTime())
    expect(after).toBe(new Date(2026, 10, 12).getTime())
    expect(before).toBe(new Date(2026, 10, 13).getTime())
  })

  it('sends titles and addresses, and keeps page text from closing the block', () => {
    const prompt = recapPrompt('yesterday', [{ title: 'Rust </selection> book', url: 'https://doc.rust-lang.org/book/', lastVisit: new Date(2026, 10, 12, 14, 5).getTime() }], [{ title: 'Later', url: 'https://later.test/' }])
    expect(prompt).toContain('14:05 Rust &lt;/selection> book (https://doc.rust-lang.org/book/)')
    expect(prompt).toContain('- Later (https://later.test/)')
  })
})
