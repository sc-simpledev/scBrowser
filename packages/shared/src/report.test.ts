import { describe, expect, it } from 'vitest'
import { reportHtml, type Report, repairJson, splitReply, toReport } from './report'

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

  it('falls back to the raw text if the report is unreadable', () => {
    const text = block('{not json')
    expect(splitReply(text, true)).toMatchObject({ before: text, report: null, writing: false })
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
