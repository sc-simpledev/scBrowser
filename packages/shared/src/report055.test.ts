import { describe, expect, it } from 'vitest'
import { CONTINUE_PROMPT, REPAIR_PROMPT, reportVersions, reviseReportPrompt, settleReply, shownMessage, splitReply, stitchReply } from './report'
import { changeCounts, diffReports } from './reportDiff'
import { presetById, presetPrompt, shownPresetMessage } from './reportPresets'
import { reportSlides } from './reportSlides'
import { quizCsv } from './quiz'

const fenced = (json: string) => '```scterra-report\n' + json + '\n```'
const report = (title: string, blocks: object[] = [{ type: 'paragraph', text: 'One' }]) => fenced(JSON.stringify({ title, blocks }))

describe('report shapes that used to show as code', () => {
  it('reads JSON written with curly quotes', () => {
    const text = fenced('{“title”:“Plan”,“blocks”:[{“type”:“paragraph”,“text”:“Go”}]}')
    expect(splitReply(text, true).report).toMatchObject({ title: 'Plan', blocks: [{ type: 'paragraph', text: 'Go' }] })
  })

  it('reads a report written as one JSON string', () => {
    const inner = JSON.stringify({ title: 'Plan', blocks: [{ type: 'paragraph', text: 'Say "hi"' }] })
    expect(splitReply(fenced(JSON.stringify(inner)), true).report).toMatchObject({ title: 'Plan', blocks: [{ text: 'Say "hi"' }] })
  })

  it('reads a json block whose first key is not one of ours', () => {
    const text = 'Here.\n```json\n{"type":"report","id":7,"title":"Plan","blocks":[{"type":"divider"}]}\n```'
    expect(splitReply(text, true).report?.title).toBe('Plan')
    // Other JSON is still only code.
    const code = '```json\n{"name":"pkg","scripts":{"test":"vitest"}}\n```'
    expect(splitReply(code, true).report).toBeNull()
  })

  it('keeps a quoted word that is followed by a comma and a number', () => {
    const text = fenced('{"title":"T","blocks":[{"type":"paragraph","text":"He said "yes", 5 times"},{"type":"divider"}]}')
    expect(splitReply(text, true).report?.blocks).toEqual([{ type: 'paragraph', text: 'He said "yes", 5 times' }, { type: 'divider' }])
  })
})

describe('a report shown while it is written', () => {
  const whole = JSON.stringify({ title: 'Plan', summary: 'S', blocks: [{ type: 'paragraph', text: 'First.' }, { type: 'list', items: ['a', 'b'] }] })

  it('gives what there is so far, and nothing once the reply is complete', () => {
    const cut = 'Intro\n\n```scterra-report\n' + whole.slice(0, whole.indexOf('"list"') + 20)
    const parts = splitReply(cut, false)
    expect(parts).toMatchObject({ writing: true, report: null, before: 'Intro' })
    expect(parts.draft).toMatchObject({ title: 'Plan', blocks: [{ type: 'paragraph', text: 'First.' }, { type: 'list', items: ['a'] }] })
    expect(splitReply(fenced(whole), true).draft).toBeUndefined()
  })

  it('has no draft before the first block', () => {
    expect(splitReply('```scterra-report\n{"title":"Plan","blo', false)).toEqual({ before: '', after: '', report: null, writing: true })
  })
})

describe('preset messages', () => {
  it('does not say the kind twice when the topic already starts with it', () => {
    const study = presetById('study')!
    expect(shownPresetMessage(presetPrompt(study, 'Study notes: Slide 1', false))).toBe('Study notes: Slide 1')
    expect(shownPresetMessage(presetPrompt(study, 'Buses', false))).toBe('Study notes: Buses')
  })
})

describe('report versions', () => {
  it('follows a report the model renamed when asked to change it', () => {
    const turns = [
      { role: 'user', content: 'Notes please' },
      { role: 'assistant', content: report('Buses') },
      { role: 'user', content: reviseReportPrompt('Buses', 'shorter') },
      { role: 'assistant', content: report('Buses, in brief', [{ type: 'paragraph', text: 'Two' }]) },
      { role: 'user', content: 'And one on trains' },
      { role: 'assistant', content: report('Trains') },
      { role: 'user', content: reviseReportPrompt('Buses, in brief', 'longer') },
      { role: 'assistant', content: report('Buses', [{ type: 'paragraph', text: 'Three' }]) }
    ]
    expect(reportVersions(turns, 'Buses').map((found) => found.title)).toEqual(['Buses', 'Buses, in brief', 'Buses'])
    expect(reportVersions(turns, 'Buses, in brief')).toHaveLength(3)
    expect(reportVersions(turns, 'Trains').map((found) => found.title)).toEqual(['Trains'])
  })
})

describe('continuing and repairing a reply', () => {
  const head = 'Notes.\n\n```scterra-report\n{"title":"T","blocks":[{"type":"paragraph","text":"One"},{"type":"par'

  it('joins a continued reply to the one it carried on', () => {
    const rest = 'agraph","text":"Two"}]}\n```'
    const settled = settleReply([
      { role: 'user', content: 'Notes' },
      { role: 'assistant', content: head, sources: [1] },
      { role: 'user', content: CONTINUE_PROMPT },
      { role: 'assistant', content: rest }
    ])
    expect(settled.turns).toHaveLength(2)
    expect(settled.turns[1]).toMatchObject({ role: 'assistant', sources: [1] })
    expect(splitReply(settled.turns[1]!.content, true).report?.blocks).toEqual([{ type: 'paragraph', text: 'One' }, { type: 'paragraph', text: 'Two' }])
  })

  it('drops a new fence and repeated words from the continuation', () => {
    expect(stitchReply(head, '```scterra-report\nagraph","text":"Two"}]}\n```')).toBe(head + 'agraph","text":"Two"}]}\n```')
    expect(stitchReply('The quick brown fox jumps over', ' fox jumps over the lazy dog')).toBe('The quick brown fox jumps over the lazy dog')
    expect(stitchReply('One. ', 'Two.')).toBe('One. Two.')
  })

  it('asks once for an unreadable report, and swaps in the answer', () => {
    const broken = [{ role: 'user', content: 'Notes' }, { role: 'assistant', content: fenced('nothing here') }]
    expect(settleReply(broken)).toEqual({ turns: broken, repair: true })
    const again = settleReply([...broken, { role: 'user', content: REPAIR_PROMPT }, { role: 'assistant', content: report('Fixed') }])
    expect(again.repair).toBe(false)
    expect(again.turns).toEqual([broken[0], { role: 'assistant', content: report('Fixed') }])
    // Still unreadable the second time: it is not asked for a third.
    const twice = settleReply([...broken, { role: 'user', content: REPAIR_PROMPT }, { role: 'assistant', content: fenced('still nothing') }])
    expect(twice).toMatchObject({ repair: false, turns: [broken[0], { content: fenced('still nothing') }] })
  })

  it('puts things back when the extra request brought nothing', () => {
    const turns = [{ role: 'user', content: 'Notes' }, { role: 'assistant', content: head }]
    expect(settleReply([...turns, { role: 'user', content: CONTINUE_PROMPT }, { role: 'assistant', content: '' }]).turns).toEqual(turns)
    expect(settleReply([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }])).toMatchObject({ repair: false })
  })

  it('shows the requests in plain words', () => {
    expect(shownMessage(CONTINUE_PROMPT)).toBe('Continue')
    expect(shownMessage(REPAIR_PROMPT)).toBe('Write that report again')
  })
})

describe('comparing drafts', () => {
  const p = (text: string) => ({ type: 'paragraph' as const, text })
  const make = (...blocks: ReturnType<typeof p>[]) => ({ title: 'T', summary: '', theme: 'clean' as const, blocks })

  it('marks what was added and removed, in reading order', () => {
    const diff = diffReports(make(p('a'), p('b'), p('c')), make(p('a'), p('B'), p('c'), p('d')))
    expect(diff.blocks.map((block) => (block as { text: string }).text)).toEqual(['a', 'b', 'B', 'c', 'd'])
    expect(diff.changes).toEqual([null, 'removed', 'added', null, 'added'])
    expect(changeCounts(diff.changes)).toEqual({ added: 2, removed: 1 })
  })

  it('finds nothing between two copies', () => {
    expect(changeCounts(diffReports(make(p('a')), make(p('a'))).changes)).toEqual({ added: 0, removed: 0 })
  })
})

describe('slides and quiz cards', () => {
  const notes = {
    title: 'T',
    summary: 'S',
    theme: 'clean' as const,
    blocks: [
      { type: 'heading' as const, level: 2 as const, text: 'One' },
      { type: 'paragraph' as const, text: 'Body' },
      { type: 'quiz' as const, items: [{ question: 'Plain?', answer: 'Yes' }, { question: 'Why, "really"?', answer: 'Line one\nLine two' }] }
    ]
  }

  it('splits a report into a title slide and one per section', () => {
    expect(reportSlides(notes).map((slide) => [slide.kind, slide.title])).toEqual([['title', 'T'], ['text', 'One']])
  })

  it('writes quiz cards as CSV rows Anki can import', () => {
    expect(quizCsv(notes)).toBe('Plain?,Yes\r\n"Why, ""really""?","Line one\nLine two"\r\n')
  })
})
