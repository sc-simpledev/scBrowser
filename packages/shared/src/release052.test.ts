import { describe, expect, it } from 'vitest'
import { cardKey, dueLabel, isDue, orderCards, quizWorksheetHtml, schedule } from './quiz'
import { isCustomPreset, presetById, presetPrompt, shownPresetMessage, templateFrom, videoReportPrompt } from './reportPresets'
import type { Report } from './report'
import { compareVersions, previousRelease } from './updates'
import { parseTraceIp } from './vpn'

const DAY = 86_400_000
const report: Report = {
  kind: 'Study notes',
  title: 'Transport <notes>',
  summary: '',
  theme: 'notebook',
  blocks: [
    { type: 'callout', text: 'Big idea' },
    { type: 'heading', level: 2, text: 'Key concepts' },
    { type: 'cards', items: [{ title: 'A', text: 'a' }] },
    { type: 'table', headers: ['Term', 'Meaning'], rows: [] },
    { type: 'heading', level: 2, text: 'Test yourself' },
    { type: 'quiz', items: [{ question: 'Q one?', answer: 'Answer one' }, { question: 'Q two?', answer: 'Answer two' }] }
  ]
}

describe('spaced repetition', () => {
  it('keys a question by its words, not its spacing or case', () => {
    expect(cardKey('What is  a Headway?')).toBe(cardKey('what is a headway?'))
    expect(cardKey('one')).not.toBe(cardKey('two'))
  })
  it('moves known questions up a box and sends missed ones back to today', () => {
    const first = schedule(undefined, true, 0)
    expect(first).toEqual({ box: 1, due: DAY })
    expect(schedule(first, true, DAY)).toEqual({ box: 2, due: DAY + 3 * DAY })
    expect(schedule({ box: 4, due: 0 }, false, 5)).toEqual({ box: 1, due: 5 })
    expect(schedule({ box: 6, due: 0 }, true, 0).box).toBe(6)
  })
  it('asks the overdue first, then new ones, then the rest', () => {
    const cards = [{ question: 'later' }, { question: 'new' }, { question: 'overdue' }]
    const progress = { [cardKey('later')]: { box: 3, due: 10 * DAY }, [cardKey('overdue')]: { box: 1, due: DAY } }
    expect(orderCards(cards, progress, 2 * DAY).map((card) => card.question)).toEqual(['overdue', 'new', 'later'])
    expect(isDue(undefined, 0)).toBe(true)
    expect(dueLabel(DAY, 0)).toBe('tomorrow')
    expect(dueLabel(3 * DAY, 0)).toBe('in 3 days')
  })
  it('prints questions with room to write and the answers on their own page', () => {
    const html = quizWorksheetHtml(report, '')
    expect(html).toContain('Transport &lt;notes&gt;')
    expect(html.indexOf('Answer one')).toBeGreaterThan(html.indexOf('class="answers"'))
    expect(html).toContain("default-src 'none'")
  })
})

describe('templates', () => {
  it('keeps the layout and section names but none of the content', () => {
    const preset = templateFrom(report, 'My notes')
    expect(preset.shape).toContain('Open with a callout.')
    expect(preset.shape).toContain('"Key concepts" with cards, then a table; "Test yourself" with a quiz block')
    expect(preset.shape).not.toContain('Big idea')
    expect(preset.theme).toBe('notebook')
    expect(isCustomPreset(preset)).toBe(true)
    expect(shownPresetMessage(presetPrompt(preset, 'Rivers', false))).toBe('My notes: Rivers')
  })
  it('refuses templates that could break the preset message', () => {
    expect(isCustomPreset({ ...templateFrom(report, 'x'), name: 'a"b' })).toBe(false)
    expect(isCustomPreset({ ...templateFrom(report, 'x'), id: 'study' })).toBe(false)
  })
  it('asks a video report to cite the transcript times', () => {
    const prompt = videoReportPrompt(presetById('study')!)
    expect(prompt).toContain('like [1:23]')
    expect(shownPresetMessage(prompt)).toBe('Study notes: this video')
  })
})

describe('going back a version', () => {
  it('picks the newest published release older than this one', () => {
    const releases = [{ tag_name: 'v0.5.2' }, { tag_name: 'v0.5.1' }, { tag_name: 'v0.4.10' }, { tag_name: 'v0.4.9' }, { tag_name: 'v0.6.0', draft: true }, { tag_name: 'nightly' }]
    expect(previousRelease(releases, '0.5.2')).toBe('0.5.1')
    expect(previousRelease(releases, '0.5.0')).toBe('0.4.10')
    expect(previousRelease(releases, '0.4.9')).toBeNull()
    expect(previousRelease({ message: 'rate limited' }, '0.5.2')).toBeNull()
    expect(compareVersions('0.4.10', '0.4.9')).toBeGreaterThan(0)
  })
})

describe('TUN check', () => {
  it('reads the address from the trace page', () => {
    expect(parseTraceIp('fl=1\nh=1.1.1.1\nip=203.0.113.7\nts=1')).toBe('203.0.113.7')
    expect(parseTraceIp('ip=2001:db8::1\n')).toBe('2001:db8::1')
    expect(parseTraceIp('<html>')).toBeNull()
  })
})
