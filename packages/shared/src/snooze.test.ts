import { describe, expect, it } from 'vitest'
import { briefSites, speechText } from './briefs'
import { snoozeUntil } from './snooze'

describe('snoozeUntil', () => {
  const wednesdayNoon = new Date(2026, 10, 11, 12, 0).getTime()
  it('picks local times', () => {
    expect(snoozeUntil('hour', wednesdayNoon)).toBe(wednesdayNoon + 3_600_000)
    expect(new Date(snoozeUntil('evening', wednesdayNoon)!).getHours()).toBe(18)
    expect(snoozeUntil('tomorrow', wednesdayNoon)).toBe(new Date(2026, 10, 12, 9, 0).getTime())
    expect(snoozeUntil('week', wednesdayNoon)).toBe(new Date(2026, 10, 16, 9, 0).getTime())
  })
  it('has no this evening once evening has come, and next Monday is never today', () => {
    expect(snoozeUntil('evening', new Date(2026, 10, 11, 21, 0).getTime())).toBeNull()
    expect(snoozeUntil('week', new Date(2026, 10, 16, 8, 0).getTime())).toBe(new Date(2026, 10, 23, 9, 0).getTime())
  })
})

describe('brief helpers', () => {
  it('reads sites from what was typed', () => {
    expect(briefSites('https://www.TheVerge.com/tech, arstechnica.com nonsense arstechnica.com')).toEqual(['theverge.com', 'arstechnica.com'])
  })
  it('makes a brief sayable', () => {
    expect(speechText('## Big news\n- **OpenAI** shipped a thing [1]\n- More [2: "quote"]')).toBe('Big news.\nOpenAI shipped a thing\nMore')
  })
})
