import { describe, expect, it } from 'vitest'
import { CODER_PLAN_TOOLS, CODER_TOOLS, extraToolsPrompt, githubToolSpec, parseCoderReply, toCall } from './coder'

describe('the ask tool', () => {
  it('reads our form and other agents’', () => {
    expect(toCall({ tool: 'ask', questions: [{ question: 'Which?', header: 'Which', options: [{ label: 'A' }, { label: 'B' }] }] })).toEqual({
      tool: 'ask',
      questions: [{ question: 'Which?', header: 'Which', options: [{ label: 'A', description: '' }, { label: 'B', description: '' }], multiSelect: false }]
    })
    // Claude Code's name, with one question and its options beside it.
    expect(toCall({ tool: 'AskUserQuestion', question: 'Tabs?', options: ['Yes', 'No'], multiSelect: true })).toMatchObject({ tool: 'ask', questions: [{ question: 'Tabs?', multiSelect: true, options: [{ label: 'Yes' }, { label: 'No' }] }] })
    expect(toCall({ tool: 'ask', questions: [] })).toBeNull()
  })

  it('is offered in every mode, as it changes nothing', () => {
    expect(CODER_TOOLS.some((tool) => tool.name === 'ask')).toBe(true)
    expect(CODER_PLAN_TOOLS.some((tool) => tool.name === 'ask')).toBe(true)
  })

  it('comes through the text protocol', () => {
    const { calls } = parseCoderReply('Let me check.\n```tool\n{"tool":"ask","questions":[{"question":"Which?","options":["A","B"]}]}\n```')
    expect(calls[0]?.tool).toBe('ask')
  })
})

describe('the github tool', () => {
  it('takes paths and whole addresses, and refuses anything else', () => {
    expect(toCall({ tool: 'github', method: 'get', path: 'https://api.github.com/repos/a/b/issues?state=open' })).toEqual({ tool: 'github', method: 'GET', path: '/repos/a/b/issues?state=open', body: null })
    expect(toCall({ tool: 'github', path: 'repos/a/b/pulls/3/files' })).toMatchObject({ method: 'GET', path: '/repos/a/b/pulls/3/files' })
    expect(toCall({ tool: 'github', method: 'POST', path: '/repos/a/b/issues', body: '{"title":"x"}' })).toMatchObject({ body: { title: 'x' } })
    expect(toCall({ tool: 'github', method: 'GET', path: '/repos/../../etc' })).toBeNull()
    expect(toCall({ tool: 'github', method: 'TRACE', path: '/user' })).toBeNull()
    expect(toCall({ tool: 'github', method: 'GET', path: '/user repos' })).toBeNull()
  })

  it('is described with only GET when it may only look', () => {
    expect((githubToolSpec('a/b', false).parameters as { properties: { method: { enum: string[] } } }).properties.method.enum).toEqual(['GET'])
    expect(githubToolSpec('a/b', true).description).toContain('This project is a/b on GitHub')
    expect(extraToolsPrompt({ agents: [], skills: [], mcp: [], github: { repo: 'a/b', write: false } })).toContain('Only GET works')
    expect(extraToolsPrompt({ agents: [], skills: [], mcp: [] })).toBe('')
  })
})
