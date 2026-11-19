import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCoderReply, type ChatMessage, type ToolSpec, type ToolUse } from '@scbrowser/ai'
import { type CoderEvent } from '@scbrowser/shared'
import { applyEvent, emptyState, sessionStats } from '../../renderer/src/internal/code/codeState'
import { Coder, describeCall, type ChatOptions } from './coder'

let root = ''
let home = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coder-helpers-'))
  home = await mkdtemp(join(tmpdir(), 'coder-helpers-home-'))
  await writeFile(join(root, 'a.txt'), 'hello\n')
  await writeFile(join(root, 'b.txt'), 'world\n')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const collect = (coder: Coder) => {
  const events: CoderEvent[] = []
  const emit = (event: CoderEvent) => {
    events.push(event)
    if (event.type === 'approval') coder.answer(event.id, 'allow')
  }
  return { events, emit }
}

type Turn = { text: string; uses?: ToolUse[]; blocks?: unknown[]; thought?: string }

/** A model that uses the provider's own tool calling, replying from a script. */
function nativeModel(script: (messages: ChatMessage[], system: string, tools: ToolSpec[]) => Turn) {
  const seen: { messages: ChatMessage[]; system: string; tools: string[]; options?: ChatOptions }[] = []
  const coder = new Coder({
    home,
    chat: async () => 'Done.',
    native: {
      available: () => true,
      chat: async (messages, system, tools, _signal, options) => {
        seen.push({ messages: structuredClone(messages), system, tools: tools.map((tool) => tool.name), options })
        const turn = script(messages, system, tools)
        if (turn.thought) options?.onReasoning?.(turn.thought)
        return { text: turn.text, uses: turn.uses ?? [], ...(turn.blocks ? { blocks: turn.blocks } : {}) }
      }
    },
    showReasoning: () => true
  })
  return { coder, seen }
}

describe('thinking and reasoning', () => {
  it('replays thinking blocks with the tool calls they led to, and shows the reasoning', async () => {
    const blocks = [{ type: 'thinking', thinking: 'Read a first.', signature: 'sig' }, { type: 'tool_use', id: 'u1', name: 'read', input: { path: 'a.txt' } }]
    const { coder, seen } = nativeModel((messages) => (messages.length === 1 ? { text: '', uses: [{ id: 'u1', name: 'read', input: { path: 'a.txt' } }], blocks, thought: 'Read a first.' } : { text: 'It says hello.' }))
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'what is in a', 'ask', emit)
    expect(seen[1]!.messages[1]!.blocks).toEqual(blocks)
    expect(seen[0]!.options?.reasoning).toBe(true)
    // Medium when nobody chose a level.
    expect(seen[0]!.options?.effort).toBe('medium')
    expect(events).toContainEqual(expect.objectContaining({ type: 'reasoning', text: 'Read a first.', final: true }))
  })
})

describe('helpers', () => {
  it('always offers the general agent, and runs helpers side by side', async () => {
    let inFlight = 0
    let most = 0
    const coder = new Coder({
      home,
      chat: async () => 'Done.',
      native: {
        available: () => true,
        chat: async (messages, system, tools) => {
          if (system.includes('research helper') || system.includes('helper agent')) {
            inFlight++
            most = Math.max(most, inFlight)
            await new Promise((done) => setTimeout(done, 30))
            inFlight--
            return { text: `Found it for: ${messages[0]!.content.slice(-6)}`, uses: [] }
          }
          if (messages.length === 1) {
            expect(tools.map((tool) => tool.name)).toContain('agent')
            return {
              text: '',
              uses: [
                { id: 'x1', name: 'explore', input: { task: 'find A' } },
                { id: 'x2', name: 'agent', input: { agent: 'general', task: 'find B' } }
              ]
            }
          }
          return { text: 'Both reported.', uses: [] }
        }
      }
    })
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'look around', 'ask', emit)
    expect(most).toBe(2)
    const runs = events.flatMap((event) => (event.type === 'agent' ? [event.run] : []))
    expect(runs.filter((run) => run.state === 'done').map((run) => run.name).sort()).toEqual(['explore', 'general'])
    expect(runs.at(-1)!.report).toContain('Found it')
  })

  it('marks a helper’s own steps as its own, and counts them', async () => {
    const coder = new Coder({
      home,
      chat: async () => 'Done.',
      native: {
        available: () => true,
        chat: async (messages, system) => {
          if (system.includes('helper agent')) return messages.length === 1 ? { text: '', uses: [{ id: 'h1', name: 'read', input: { path: 'b.txt' } }] } : { text: 'b says world.', uses: [] }
          return messages.length === 1 ? { text: '', uses: [{ id: 'm1', name: 'agent', input: { agent: 'general', task: 'read b' } }] } : { text: 'Done.', uses: [] }
        }
      }
    })
    const { events, emit } = collect(coder)
    await coder.run('s', root, 'read b with a helper', 'ask', emit)
    const parent = events.find((event): event is Extract<CoderEvent, { type: 'tool' }> => event.type === 'tool' && event.tool === 'agent')!
    const child = events.find((event): event is Extract<CoderEvent, { type: 'tool' }> => event.type === 'tool' && event.tool === 'read')!
    expect(child.agent).toBe(parent.id)
    const last = events.filter((event) => event.type === 'agent').at(-1) as Extract<CoderEvent, { type: 'agent' }>
    expect(last.run).toMatchObject({ id: parent.id, state: 'done', steps: 1, last: 'Read b.txt', report: 'b says world.' })
  })

  it('describes steps in a few words', () => {
    expect(describeCall({ tool: 'run', command: 'npm test' })).toBe('Run npm test')
    expect(describeCall({ tool: 'read', path: 'a.ts', offset: 1, limit: 10 })).toBe('Read a.ts')
    expect(describeCall({ tool: 'diagnostics' })).toBe('Diagnostics')
  })
})

describe('the checklist', () => {
  it('reads statuses, with one step under way at most', () => {
    const [call] = parseCoderReply('{"tool":"todo","items":[{"text":"a","status":"completed"},{"text":"b","status":"in_progress"},{"text":"c","status":"in-progress"},{"text":"d"}]}').calls
    expect(call).toEqual({ tool: 'todo', items: [{ text: 'a', done: true }, { text: 'b', done: false, active: true }, { text: 'c', done: false }, { text: 'd', done: false }] })
  })
})

describe('the screen', () => {
  const sid = { sessionId: 's' }
  it('keeps reasoning in the conversation once the step moves on', () => {
    let state = applyEvent(emptyState(), { ...sid, type: 'reasoning', text: 'Thinking about' })
    expect(state.reasoning).toBe('Thinking about')
    expect(state.items).toEqual([])
    // The reply arriving leaves it for its final event.
    state = applyEvent(state, { ...sid, type: 'stream', text: 'Read' })
    expect(state.items).toEqual([])
    state = applyEvent(state, { ...sid, type: 'tool', id: 't', tool: 'read', summary: 'Read a' })
    expect(state.reasoning).toBe('')
    expect(state.items[0]).toEqual({ kind: 'reasoning', text: 'Thinking about' })
    state = applyEvent(state, { ...sid, type: 'reasoning', text: 'Done thinking', final: true })
    expect(state.items.at(-1)).toEqual({ kind: 'reasoning', text: 'Done thinking' })
  })

  it('tracks helpers and stops any left running when the run ends', () => {
    const run = { id: 'a1', name: 'general', task: 't', state: 'running' as const, steps: 0, last: null, report: null, startedAt: 1, endedAt: null }
    let state = applyEvent({ ...emptyState(), working: true, runStartedAt: Date.now() - 5000 }, { ...sid, type: 'agent', run })
    state = applyEvent(state, { ...sid, type: 'agent', run: { ...run, steps: 2 } })
    expect(state.agents).toHaveLength(1)
    expect(state.agents[0]!.steps).toBe(2)
    state = applyEvent(state, { ...sid, type: 'done', reason: 'stopped' })
    expect(state.agents[0]!.state).toBe('failed')
    expect(state.lastRunMs).toBeGreaterThanOrEqual(5000)
  })

  it('counts what a session did', () => {
    const tool = (tool: 'run' | 'read' | 'edit' | 'todo', ok: boolean) => ({ kind: 'tool' as const, id: `${tool}${ok}`, tool, summary: '', ok, output: '' })
    expect(sessionStats([{ kind: 'task', text: 'x' }, tool('run', true), tool('read', true), tool('edit', false), tool('todo', true)])).toEqual({ messages: 1, tools: 3, commands: 1, reads: 1, edits: 1, failed: 1 })
  })
})
