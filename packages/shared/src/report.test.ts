import { describe, expect, it } from 'vitest'
import { REPORT_THEMES, replaceReport, reportHtml, reportMarkdown, reportVersions, reviseReportPrompt, shownMessage, type Report, repairJson, splitReply, toReport } from './report'
import { presetById, presetPrompt, REPORT_PRESETS } from './reportPresets'

const block = (json: string) => '```scterra-report\n' + json + '\n```'
const valid = '{"title":"Plan","summary":"S","theme":"brief","blocks":[{"type":"heading","text":"One"},{"type":"paragraph","text":"Two"}]}'

describe('splitReply', () => {
  it('leaves plain text alone', () => {
    expect(splitReply('Hello')).toEqual({ before: 'Hello', after: '', report: null, writing: false })
  })

  it('finds a report and the text around it', () => {
    const parts = splitReply(`Here it is.\n\n${block(valid)}\n\nAnything else?`)
    expect(parts.before).toBe('Here it is.')
    expect(parts.after).toBe('Anything else?')
    expect(parts.report?.title).toBe('Plan')
    expect(parts.report?.theme).toBe('brief')
  })

  it('still reads reports saved under the old name', () => {
    expect(splitReply('```scdelta-report\n' + valid + '\n```').report?.title).toBe('Plan')
  })

  it('reports progress while the block is unfinished', () => {
    expect(splitReply('Intro\n```scterra-report\n{"title":"Pl')).toMatchObject({ before: 'Intro', writing: true, report: null })
  })

  it('keeps what was written apart if the report is unreadable', () => {
    const text = 'Here it is.\n\n' + block('{not json')
    expect(splitReply(text, true)).toMatchObject({ before: 'Here it is.', report: null, writing: false, unread: block('{not json') })
    // A json block that isn't a report is only ever a code block.
    const code = 'Config:\n```json\n{"title": nope}\n```'
    expect(splitReply(code, true)).toEqual({ before: code, after: '', report: null, writing: false })
  })
})

describe('splitReply with imperfect model output', () => {
  const title = (text: string, complete = true) => splitReply(text, complete).report?.title

  it('is not fooled by a code fence inside a string', () => {
    const json = '{"title":"Code","blocks":[{"type":"paragraph","text":"Run ```npm test``` first"}]}'
    const parts = splitReply(`${block(json)}\n\nDone.`)
    expect(parts.report?.title).toBe('Code')
    expect(parts.after).toBe('Done.')
  })

  it('accepts the JSON on the same line as the tag', () => {
    expect(title('```scterra-report {"title":"Plan","blocks":[{"type":"divider"}]}```')).toBe('Plan')
  })

  it('accepts a json fence, a tilde fence, Windows line ends, indents and capitals', () => {
    expect(title('Intro\n```json\n' + valid + '\n```')).toBe('Plan')
    expect(title('~~~scterra-report\n' + valid + '\n~~~')).toBe('Plan')
    expect(title('Intro\r\n```scterra-report\r\n' + valid + '\r\n```\r\n')).toBe('Plan')
    expect(title('  ```SCTERRA-REPORT\n' + valid + '\n  ```')).toBe('Plan')
  })

  it('accepts a report with no fence at all', () => {
    expect(splitReply(`Here it is.\n${valid}`, true)).toMatchObject({ before: 'Here it is.', report: { title: 'Plan' } })
  })

  it('leaves ordinary code blocks alone', () => {
    const text = 'Example:\n```json\n{"name":"x"}\n```'
    expect(splitReply(text, true)).toMatchObject({ before: text, report: null })
  })

  it('keeps what was written when a reply is cut off, and only once it has finished', () => {
    const cut = 'Intro\n```scterra-report\n{"title":"Plan","blocks":[{"type":"paragraph","text":"One"},{"type":"list","items":["a","b'
    expect(splitReply(cut, false)).toMatchObject({ writing: true, report: null })
    const parts = splitReply(cut, true)
    expect(parts.writing).toBe(false)
    expect(parts.report?.blocks).toEqual([
      { type: 'paragraph', text: 'One' },
      { type: 'list', items: ['a', 'b'], ordered: false }
    ])
  })

  it('never stays on writing once the reply is finished', () => {
    expect(splitReply('```scterra-report\n', true).writing).toBe(false)
  })

  it('handles JSON mistakes', () => {
    expect(title(block('{"title":"Plan","blocks":[{"type":"paragraph","text":"a\nb"},],}'))).toBe('Plan')
    expect(title(block('{"title":"Plan","blocks":[{"type":"paragraph","text":"say "hi" now"}]}'))).toBe('Plan')
    expect(title(block('{"title":"Plan", // note\n"blocks":[{"type":"divider"}]}'))).toBe('Plan')
    expect(title(block('{"title":"It\\\'s","blocks":[{"type":"divider"}]}'))).toBe("It's")
  })
})

describe('repairJson', () => {
  it('leaves valid JSON meaning the same', () => {
    const json = '{"a":"x, \\"y\\": z","b":[1,2,{"c":null}]}'
    expect(JSON.parse(repairJson(json))).toEqual(JSON.parse(json))
  })

  it('closes whatever was left open', () => {
    expect(JSON.parse(repairJson('{"a":[1,{"b":"c'))).toEqual({ a: [1, { b: 'c' }] })
    expect(JSON.parse(repairJson('{"a":1,"b":'))).toEqual({ a: 1 })
  })
})

describe('reports with miscounted brackets', () => {
  // What a hosted model really wrote, three times running: the table's rows closed with `]}]}` or `]}}`.
  const head = '{"title":"Study notes","theme":"notebook","blocks":[{"type":"heading","level":2,"text":"Key terms"},{"type":"table","headers":["Term","Definition"],"rows":[["Headway","Time between services."],["Social exclusion","Being cut off."]'
  const tail = ',{"type":"heading","level":2,"text":"Practice questions"},{"type":"quiz","items":[{"question":"Why?","answer":"Because."}]}]}'
  const kinds = (text: string) => splitReply(text, true).report?.blocks.map((b) => b.type)
  const all = ['heading', 'table', 'heading', 'quiz']

  it.each([
    ['one bracket swapped for a brace', ']}]}'],
    ['a list closed with a brace', ']}}'],
    ['a bracket too many', ']]]}'],
    ['a bracket missing', ']}'],
    ['a brace too many', ']]}}']
  ])('reads the whole report with %s', (_, closers) => {
    for (const fence of ['```', '````']) {
      const parts = splitReply(`Here are your notes.\n\n${fence}scterra-report\n${head}${closers}${tail}\n${fence}\n\nGood luck.`, true)
      expect(parts.report?.blocks.map((b) => b.type)).toEqual(all)
      expect(parts.report?.blocks[1]).toMatchObject({ rows: [['Headway', 'Time between services.'], ['Social exclusion', 'Being cut off.']] })
      expect(parts.before).toBe('Here are your notes.')
      expect(parts.after).toBe('Good luck.')
    }
  })

  it('reads it with no fence, or a json one', () => {
    expect(kinds(`Notes:\n\n${head}]}]}${tail}`)).toEqual(all)
    expect(kinds('Notes:\n\n```json\n' + head + ']}}' + tail + '\n```')).toEqual(all)
  })

  it('waits for the closing fence while the reply is arriving', () => {
    const arriving = '```scterra-report\n' + head + ']}]}' + tail.slice(0, 40)
    expect(splitReply(arriving, false)).toMatchObject({ writing: true, report: null })
    expect(kinds(arriving)).toEqual(['heading', 'table', 'heading'])
  })

  it('does not let a stray closing bracket end the report early', () => {
    const early = '```scterra-report\n{"title":"T","blocks":[{"type":"list","items":["a"]}]},{"type":"paragraph","text":"Kept"}]}\n```'
    expect(kinds(early)).toEqual(['list', 'paragraph'])
  })

  it('leaves a fence written around the report out of the reply', () => {
    const nested = '```scterra-report\n```json\n{"title":"T","blocks":[{"type":"divider"}]}\n```\n```\nDone.'
    expect(splitReply(nested, true)).toMatchObject({ after: 'Done.', report: { title: 'T' } })
  })
})

describe('reports cut off anywhere', () => {
  const whole = JSON.stringify({
    title: 'T',
    blocks: [
      { type: 'paragraph', text: 'First.' },
      { type: 'stats', items: [{ value: '42%', label: 'share' }, { value: '1 in 5', label: 'homes' }] },
      { type: 'list', ordered: false, items: ['One', 'Two'] },
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] },
      { type: 'quiz', items: [{ question: 'Q?', answer: 'A.' }] }
    ]
  })

  it('still shows a report wherever the text stops after its first block', () => {
    const first = whole.indexOf('First."}') + 8
    for (let length = first; length <= whole.length; length++) {
      const parts = splitReply('Intro\n\n```scterra-report\n' + whole.slice(0, length), true)
      expect(parts.report?.blocks[0], whole.slice(0, length)).toEqual({ type: 'paragraph', text: 'First.' })
    }
  })

  it('keeps a quoted word that is followed by a comma', () => {
    const text = '```scterra-report\n{"title":"T","blocks":[{"type":"paragraph","text":"Known as "transport deserts", these areas"},{"type":"divider"}]}\n```'
    expect(splitReply(text, true).report?.blocks).toEqual([{ type: 'paragraph', text: 'Known as "transport deserts", these areas' }, { type: 'divider' }])
  })
})

describe('toReport', () => {
  it('understands other names for blocks and fields', () => {
    const report = toReport(
      JSON.stringify({
        blocks: [
          { type: 'h3', content: 'Head' },
          { type: 'text', content: 'Body' },
          { type: 'numbered_list', items: [{ text: 'One' }] },
          { type: 'note', text: 'Careful' },
          { type: 'table', columns: ['A', 'B'], rows: [{ A: 1, B: 'x' }] }
        ]
      })
    )
    expect(report?.blocks).toEqual([
      { type: 'heading', text: 'Head', level: 3 },
      { type: 'paragraph', text: 'Body' },
      { type: 'list', items: ['One'], ordered: true },
      { type: 'callout', text: 'Careful' },
      { type: 'table', headers: ['A', 'B'], rows: [['1', 'x']] }
    ])
  })

  it('removes Markdown from text', () => {
    expect(toReport('{"blocks":[{"type":"paragraph","text":"A **bold** and `code` word"}]}')?.blocks).toEqual([{ type: 'paragraph', text: 'A bold and code word' }])
  })

  it('drops unknown blocks and fields, so markup and styles cannot get in', () => {
    const report = toReport('{"blocks":[{"type":"html","text":"<script>"},{"type":"paragraph","text":"ok","style":"color:red"}],"css":"x"}')
    expect(report?.blocks).toEqual([{ type: 'paragraph', text: 'ok' }])
    expect(report).not.toHaveProperty('css')
  })

  it('uses defaults for a missing title and unknown theme', () => {
    expect(toReport('{"theme":"neon","blocks":[{"type":"divider"}]}')).toMatchObject({ title: 'Report', theme: 'clean' })
  })

  it('needs at least one usable block', () => {
    expect(toReport('{"blocks":[{"type":"nope"}]}')).toBeNull()
    expect(toReport('nope')).toBeNull()
  })

  it('tidies lists and tables', () => {
    const report = toReport('{"blocks":[{"type":"list","items":["a",2,""]},{"type":"table","headers":["h"],"rows":[["c",1],"x"]}]}')
    expect(report?.blocks).toEqual([
      { type: 'list', items: ['a', '2'], ordered: false },
      { type: 'table', headers: ['h'], rows: [['c', '1']] }
    ])
  })
})

describe('reportHtml', () => {
  const report = { title: '<script>alert(1)</script>', summary: 'A & B', theme: 'clean', blocks: [{ type: 'paragraph', text: '<img src=x onerror=alert(1)>' }] } as unknown as Report

  it('escapes everything the model wrote', () => {
    const html = reportHtml(report, '')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('A &amp; B')
  })

  it('stops the saved file running scripts or reaching the network', () => {
    expect(reportHtml(report, '')).toContain("default-src 'none'")
  })
})

describe('report versions', () => {
  it('finds every draft by title, and shows a change request as what was asked', () => {
    const draft = (text: string, title = 'Plan') => 'Intro.\n' + block(JSON.stringify({ title, blocks: [{ type: 'paragraph', text }] }))
    const turns = [
      { role: 'user', content: 'Plan it' },
      { role: 'assistant', content: draft('One') },
      { role: 'user', content: reviseReportPrompt('Plan', 'Shorter') },
      { role: 'assistant', content: draft('Two') },
      { role: 'assistant', content: draft('Other', 'Something else') }
    ]
    expect(reportVersions(turns, 'Plan').map((report) => report.blocks[0])).toEqual([{ type: 'paragraph', text: 'One' }, { type: 'paragraph', text: 'Two' }])
    expect(shownMessage(turns[2]!.content)).toBe('Change to “Plan”: Shorter')
    expect(shownMessage('A normal question')).toBe('A normal question')
  })
})

describe('report tables', () => {
  it('keeps an empty corner cell, so the columns stay lined up', () => {
    const report = toReport('{"blocks":[{"type":"table","headers":["","A","B"],"rows":[["x","1","2"]]}]}')
    expect(report?.blocks[0]).toMatchObject({ headers: ['', 'A', 'B'] })
  })
})

describe('reportMarkdown', () => {
  it('writes every kind of block, keeping tables intact', () => {
    const text = reportMarkdown({
      title: 'Plan',
      summary: 'Short.',
      theme: 'clean',
      blocks: [
        { type: 'heading', level: 3, text: 'Steps' },
        { type: 'list', ordered: true, items: ['One', 'Two'] },
        { type: 'table', headers: ['A|B'], rows: [['line\nbreak']] },
        { type: 'callout', text: 'Careful' },
        { type: 'spacer' },
        { type: 'divider' }
      ]
    })
    expect(text).toBe('# Plan\n\nShort.\n\n### Steps\n\n1. One\n2. Two\n\n| A\\|B |\n| --- |\n| line break |\n\n> Careful\n\n---\n')
  })
})

describe('reports in other shapes', () => {
  const blocksOf = (json: string) => splitReply('Here is your study notes report.\n\n```json\n' + json + '\n```', true).report?.blocks

  it('reads slides with their own blocks, as asked for in the topic', () => {
    const json = JSON.stringify({
      title: 'Study Notes: Limited Public Transport',
      summary: 'Notes.',
      theme: 'notebook',
      slides: [
        { title: 'Slide 1: Define the issue', content: [{ type: 'callout', text: 'Big idea' }, { type: 'paragraph', text: 'Definition' }] },
        { title: 'Slide 2: In the chosen location', points: ['Bus every 40 minutes', 'No trains'], stats: [{ value: '38%', label: 'have no stop nearby' }] }
      ]
    })
    expect(blocksOf(json)).toEqual([
      { type: 'heading', text: 'Slide 1: Define the issue', level: 2 },
      { type: 'callout', text: 'Big idea' },
      { type: 'paragraph', text: 'Definition' },
      { type: 'heading', text: 'Slide 2: In the chosen location', level: 2 },
      { type: 'list', items: ['Bus every 40 minutes', 'No trains'], ordered: false },
      { type: 'stats', items: [{ value: '38%', label: 'have no stop nearby' }] }
    ])
  })

  it('opens sections nested inside blocks, and blocks with no type', () => {
    const json = JSON.stringify({
      title: 'T',
      blocks: [
        { type: 'section', title: 'Key concepts', blocks: [{ heading: 'Access', text: 'Reaching places.' }] },
        { headers: ['Term', 'Meaning'], rows: [['Headway', 'Time between buses']] }
      ]
    })
    expect(blocksOf(json)).toEqual([
      { type: 'heading', text: 'Key concepts', level: 2 },
      { type: 'heading', text: 'Access', level: 3 },
      { type: 'paragraph', text: 'Reaching places.' },
      { type: 'table', headers: ['Term', 'Meaning'], rows: [['Headway', 'Time between buses']] }
    ])
  })

  it('reads objects keyed by topic, wrapped reports, and loose text with bullets', () => {
    const json = JSON.stringify({ report: { title: 'T', key_ideas: ['One', 'Two'], whenItBegan: 'It grew.\n- In 1990\n- Again in 2010' } })
    const report = splitReply('```json\n' + json + '\n```', true).report
    expect(report?.title).toBe('T')
    expect(report?.blocks).toEqual([
      { type: 'heading', text: 'Key ideas', level: 2 },
      { type: 'list', items: ['One', 'Two'], ordered: false },
      { type: 'heading', text: 'When it began', level: 2 },
      { type: 'paragraph', text: 'It grew.' },
      { type: 'list', items: ['In 1990', 'Again in 2010'], ordered: false }
    ])
  })

  it('turns lists of like notes into cards', () => {
    const json = JSON.stringify({ title: 'T', concepts: [{ title: 'Access', text: 'a' }, { title: 'Equity', text: 'b' }] })
    expect(blocksOf(json)).toEqual([
      { type: 'heading', text: 'Concepts', level: 2 },
      { type: 'cards', items: [{ title: 'Access', text: 'a' }, { title: 'Equity', text: 'b' }] }
    ])
  })

  it('still drops blocks of unknown types', () => {
    expect(toReport('{"blocks":[{"type":"html","text":"<b>"},{"type":"section","text":"Intro"}]}')?.blocks).toEqual([{ type: 'heading', text: 'Intro', level: 2 }])
  })
})

describe('richer report blocks', () => {
  it('reads stats, timelines, pros and cons, cards and steps in the shapes models write', () => {
    const report = toReport(
      JSON.stringify({
        kind: 'SWOT analysis',
        title: 'T',
        theme: 'modern',
        blocks: [
          { type: 'stats', items: [{ value: '42%', label: 'share' }, ['3', 'stores']] },
          { type: 'milestones', items: [{ date: '2024', event: 'Launch' }] },
          { type: 'pros_cons', pros: ['Fast'], cons: [{ text: 'Pricey' }] },
          { type: 'swot', items: [{ title: 'Strengths', text: 'Brand' }] },
          { type: 'steps', items: ['Just text'] },
          { type: 'stats', items: [] }
        ]
      })
    )
    expect(report?.kind).toBe('SWOT analysis')
    expect(report?.theme).toBe('modern')
    expect(report?.blocks).toEqual([
      { type: 'stats', items: [{ value: '42%', label: 'share' }, { value: '3', label: 'stores' }] },
      { type: 'timeline', items: [{ when: '2024', text: 'Launch' }] },
      { type: 'proscons', pros: ['Fast'], cons: ['Pricey'] },
      { type: 'cards', items: [{ title: 'Strengths', text: 'Brand' }] },
      { type: 'steps', items: [{ title: '', text: 'Just text' }] }
    ])
  })

  it('escapes the new blocks when saved as a page', () => {
    const html = reportHtml({ kind: '<b>', title: 'T', summary: '', theme: 'clean', blocks: [{ type: 'cards', items: [{ title: '<script>', text: 'x' }] }] }, '')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('report presets', () => {
  it('reads back as the kind and topic, not the instructions', () => {
    const swot = presetById('swot')!
    expect(shownMessage(presetPrompt(swot, 'Our bakery', false))).toBe('SWOT analysis: Our bakery')
    expect(shownMessage(presetPrompt(swot, '', true))).toBe('SWOT analysis: this page')
    expect(REPORT_PRESETS.every((preset) => REPORT_THEMES.some((theme) => theme.id === preset.theme))).toBe(true)
  })
})

describe('quizzes, sources and edits', () => {
  it('reads quiz blocks under their other names and keeps answers out of sight in saved pages', () => {
    const report = toReport('{"title":"T","blocks":[{"type":"flashcards","items":[{"q":"Capital of France?","a":"Paris"}]}]}')!
    expect(report.blocks).toEqual([{ type: 'quiz', items: [{ question: 'Capital of France?', answer: 'Paris' }] }])
    expect(reportHtml(report, '')).toContain('<details><summary>Capital of France?</summary><p>Paris</p></details>')
    expect(reportMarkdown(report)).toContain('Answer: Paris')
  })

  it('lists sources at the end of saved copies', () => {
    const report: Report = { title: 'T', summary: '', theme: 'clean', blocks: [{ type: 'paragraph', text: 'A claim [1]' }], sources: [{ n: 1, title: 'Bus <times>', url: 'https://example.com/bus' }] }
    expect(reportHtml(report, '')).toContain('<h2>Sources</h2><ol><li value="1"><span>Bus &lt;times&gt;</span>')
    expect(reportMarkdown(report)).toContain('## Sources\n\n1. Bus <times> <https://example.com/bus>')
  })

  it('swaps an edited report into the reply that wrote it, keeping the rest', () => {
    const one = { title: 'One', summary: '', theme: 'clean', blocks: [{ type: 'paragraph', text: 'a' }] } as Report
    const two = { title: 'Two', summary: '', theme: 'clean', blocks: [{ type: 'paragraph', text: 'b' }] } as Report
    const text = `Intro\n\n\`\`\`scterra-report\n${JSON.stringify(one)}\n\`\`\`\n\nMiddle\n\n\`\`\`scterra-report\n${JSON.stringify(two)}\n\`\`\`\n\nEnd`
    const edited = { ...two, blocks: [{ type: 'paragraph', text: 'changed' }] } as Report
    const next = replaceReport(text, two, edited)!
    const parts = splitReply(next, true)
    expect(parts.before).toBe('Intro')
    expect(parts.report).toEqual(one)
    expect(splitReply(parts.after, true)).toMatchObject({ before: 'Middle', after: 'End', report: edited })
    expect(replaceReport('No report here', one, two)).toBeNull()
  })
})
