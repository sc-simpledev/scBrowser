import { describe, expect, it } from 'vitest'
import { blockReason, DEFAULT_BLOCKER, hostToClassify, isBlockerConfig, pickMessage, ruleActive, toDomain, type BlockRule } from './blocker'

const rule = (patch: Partial<BlockRule> = {}): BlockRule => ({ id: '1', domain: 'reddit.com', when: 'always', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', ...patch })
// A Monday.
const at = (time: string, day = 2) => new Date(`2026-11-0${day}T${time}:00`)

describe('rules', () => {
  it('matches a site and its subdomains, not lookalikes', () => {
    const config = { ...DEFAULT_BLOCKER, rules: [rule()] }
    expect(blockReason(config, false, 'https://reddit.com/r/x', at('10:00'))).toBeTruthy()
    expect(blockReason(config, false, 'https://old.reddit.com/', at('10:00'))).toBeTruthy()
    expect(blockReason(config, false, 'https://notreddit.com/', at('10:00'))).toBeNull()
  })

  it('follows the schedule, including overnight', () => {
    const day = rule({ when: 'schedule' })
    expect(ruleActive(day, false, at('10:00'))).toBe(true)
    expect(ruleActive(day, false, at('17:00'))).toBe(false)
    expect(ruleActive(day, false, at('10:00', 1))).toBe(false)
    const night = rule({ when: 'schedule', start: '22:00', end: '06:00', days: [1] })
    expect(ruleActive(night, false, at('23:00'))).toBe(true)
    expect(ruleActive(night, false, at('05:00', 3))).toBe(true)
    expect(ruleActive(night, false, at('05:00'))).toBe(false)
  })

  it('applies Focus Mode rules only in Focus Mode', () => {
    expect(ruleActive(rule({ when: 'focus' }), true, at('10:00'))).toBe(true)
    expect(ruleActive(rule({ when: 'focus' }), false, at('10:00'))).toBe(false)
  })

  it('lets the allowlist beat everything, and the off switch stop everything', () => {
    const config = { ...DEFAULT_BLOCKER, rules: [rule()], categories: ['Social'], categoryMode: 'always' as const, allowlist: ['old.reddit.com'] }
    expect(blockReason(config, true, 'https://old.reddit.com/', at('10:00'))).toBeNull()
    expect(hostToClassify(config, true, 'https://old.reddit.com/')).toBeNull()
    expect(blockReason({ ...config, enabled: false }, true, 'https://reddit.com/', at('10:00'))).toBeNull()
  })

  it('ignores internal pages', () => {
    expect(blockReason({ ...DEFAULT_BLOCKER, rules: [rule({ domain: 'settings' })] }, false, 'sc://settings/', at('10:00'))).toBeNull()
  })
})

describe('categories', () => {
  const config = { ...DEFAULT_BLOCKER, categories: ['Social'], categoryMode: 'focus' as const }

  it('asks only when the mode says so', () => {
    expect(hostToClassify(config, false, 'https://a.example/x')).toBeNull()
    expect(hostToClassify(config, true, 'https://a.example/x?y=1')).toBe('a.example')
    expect(hostToClassify({ ...config, categoryMode: 'always' }, false, 'https://a.example/')).toBe('a.example')
    expect(hostToClassify({ ...config, categoryMode: 'off' }, true, 'https://a.example/')).toBeNull()
  })

  it('never sends local addresses', () => {
    expect(hostToClassify(config, true, 'http://192.168.1.1/')).toBeNull()
    expect(hostToClassify(config, true, 'http://localhost:3000/')).toBeNull()
  })
})

it('cleans typed sites', () => {
  expect(toDomain('https://www.Reddit.com/r/all')).toBe('reddit.com')
  expect(toDomain('  news.example ')).toBe('news.example')
  expect(toDomain('nonsense')).toBeNull()
})

it('picks a message, or a default', () => {
  expect(pickMessage(['a', 'b'], 0.9)).toBe('b')
  expect(pickMessage([])).toBeTruthy()
})

it('rejects bad stored settings', () => {
  expect(isBlockerConfig(DEFAULT_BLOCKER)).toBe(true)
  expect(isBlockerConfig({ ...DEFAULT_BLOCKER, rules: [rule({ start: '25:00' })] })).toBe(false)
})
