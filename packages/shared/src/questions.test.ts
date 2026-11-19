import { describe, expect, it } from 'vitest'
import { cleanTodo, questionAnswerText, todoChangeText } from './coder'
import { parseQuestions, questionAnswerMessage, QUESTION_FENCE, splitQuestion } from './questions'

describe('questions', () => {
  it('reads questions as models write them', () => {
    expect(parseQuestions({ questions: [{ question: 'Which?', header: 'Pick', options: ['A', { label: 'B', description: 'The second' }, 'A'], multiSelect: true }] })).toEqual([
      { question: 'Which?', header: 'Pick', options: [{ label: 'A', description: '' }, { label: 'B', description: 'The second' }], multiSelect: true }
    ])
    expect(parseQuestions('Tabs or spaces?')).toEqual([{ question: 'Tabs or spaces?', header: 'Tabs or', options: [], multiSelect: false }])
    expect(parseQuestions([{ question: '' }, 5])).toBeNull()
    expect(parseQuestions(Array.from({ length: 9 }, (_, i) => `Q${i}?`))).toHaveLength(4)
  })

  it('takes the question block off the end of a reply', () => {
    const reply = `I can plan either.\n\n\`\`\`${QUESTION_FENCE}\n{"questions":[{"question":"Which trip?","options":["Weekend","Week"]}]}\n\`\`\``
    const parts = splitQuestion(reply)
    expect(parts.text).toBe('I can plan either.')
    expect(parts.questions?.[0]?.options.map((o) => o.label)).toEqual(['Weekend', 'Week'])
    expect(splitQuestion(reply.slice(0, -4))).toEqual({ text: 'I can plan either.', questions: null, writing: true })
    // A block that can't be read stays as written.
    const broken = `Hm.\n\`\`\`${QUESTION_FENCE}\n{nope\n\`\`\``
    expect(splitQuestion(broken)).toEqual({ text: broken, questions: null, writing: false })
    expect(splitQuestion('Plain answer.')).toEqual({ text: 'Plain answer.', questions: null, writing: false })
  })

  it('words the answers for the model', () => {
    const qs = parseQuestions([{ question: 'Trip?', header: 'Trip', options: ['Weekend'] }, { question: 'Budget?', header: 'Budget', options: ['Low'] }])!
    expect(questionAnswerMessage(qs, [['Weekend'], []])).toBe('**Trip:** Weekend\n**Budget:** your call')
    expect(questionAnswerMessage(qs.slice(0, 1), [['Weekend', 'Somewhere warm']])).toBe('Weekend, Somewhere warm')
    expect(questionAnswerMessage(qs, null)).toContain('Go with what you think is best')
    expect(questionAnswerText(qs, [['Weekend']])).toBe('Trip?\n→ Weekend\n\nBudget?\n→ (skipped: decide yourself, and say what you assumed)')
  })
})

describe('the person’s checklist', () => {
  it('keeps only real steps, one under way at most', () => {
    expect(cleanTodo([{ text: ' A ', done: false, active: true }, { text: 'B', done: false, active: true }, { text: '  ', done: false }, { text: 'C', done: true, active: true }])).toEqual([
      { text: 'A', done: false, active: true },
      { text: 'B', done: false },
      { text: 'C', done: true }
    ])
    expect(cleanTodo([{ text: 'A' }])).toBeNull()
    expect(cleanTodo('nope')).toBeNull()
    expect(cleanTodo(Array.from({ length: 41 }, () => ({ text: 'x', done: false })))).toBeNull()
  })

  it('tells the model what it is now', () => {
    expect(todoChangeText([{ text: 'A', done: true }, { text: 'B', done: false, active: true }, { text: 'C', done: false }])).toContain('- [x] A\n- [~] B\n- [ ] C')
    expect(todoChangeText([])).toContain('cleared')
  })
})
