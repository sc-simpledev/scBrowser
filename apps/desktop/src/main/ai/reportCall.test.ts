import { describe, expect, it } from 'vitest'

import { splitReply } from '@scbrowser/shared'
import { reportCallText } from './reportCall'

describe('a report written as a tool call', () => {
  it('becomes the fenced block, piece by piece', () => {
    const call = reportCallText()
    const text = 'Here it is.' + call.delta(0, '{"title":"Plan",') + call.delta(0, '"blocks":[{"type":"divider"}]}') + call.whole({ title: 'Plan' }) + call.end()
    expect(text).toBe('Here it is.\n\n```scterra-report\n{"title":"Plan","blocks":[{"type":"divider"}]}\n```')
    expect(splitReply(text, true)).toMatchObject({ before: 'Here it is.', report: { title: 'Plan' } })
  })

  it('takes the whole call where a provider sends no pieces, and nothing when there was no call', () => {
    const call = reportCallText()
    expect(splitReply(call.whole({ title: 'Plan', blocks: [{ type: 'divider' }] }) + call.end(), true).report?.title).toBe('Plan')
    expect(reportCallText().end()).toBe('')
    expect(reportCallText().whole(null)).toBe('')
  })

  it('closes one report before a second starts', () => {
    const call = reportCallText()
    const text = call.delta(0, '{"title":"A","blocks":[{"type":"divider"}]}') + call.delta(1, '{"title":"B","blocks":[{"type":"divider"}]}') + call.end()
    expect(text.match(/```scterra-report/g)).toHaveLength(2)
    expect(splitReply(text, true)).toMatchObject({ report: { title: 'A' } })
  })
})
