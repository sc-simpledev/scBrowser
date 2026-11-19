import { CODER_MAX_OPTIONS, CODER_MAX_QUESTIONS, type CoderQuestion, type CoderQuestionAnswer } from './coder'

/** The fenced block a chat reply asks its questions in, at its end. */
export const QUESTION_FENCE = 'scterra-question'

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const words = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)

/** Questions as models write them: one or several, a bare string, options as words or objects. */
export function parseQuestions(value: unknown): CoderQuestion[] | null {
  const unwrapped = isObject(value) && !('question' in value) && ('questions' in value || 'items' in value) ? (value.questions ?? value.items) : value
  const list = Array.isArray(unwrapped) ? unwrapped : isObject(unwrapped) || typeof unwrapped === 'string' ? [unwrapped] : []
  const questions = list.slice(0, CODER_MAX_QUESTIONS).flatMap((entry): CoderQuestion[] => {
    const one = typeof entry === 'string' ? { question: entry } : isObject(entry) ? entry : null
    if (!one) return []
    const question = words(one.question ?? one.text ?? one.prompt, 600)
    if (!question) return []
    const raw = Array.isArray(one.options) ? one.options : Array.isArray(one.choices) ? one.choices : []
    const seen = new Set<string>()
    const options = raw.slice(0, CODER_MAX_OPTIONS).flatMap((option) => {
      const label = typeof option === 'string' ? words(option, 120) : isObject(option) ? words(option.label ?? option.text ?? option.value, 120) : null
      if (!label || seen.has(label)) return []
      seen.add(label)
      return [{ label, description: isObject(option) ? (words(option.description ?? option.hint, 300) ?? '') : '' }]
    })
    const header = (words(one.header ?? one.title, 40) ?? question.split(/\s+/).slice(0, 2).join(' ')).replace(/[?:]+$/, '').slice(0, 24)
    const multiSelect = one.multiSelect === true || one.multi_select === true || one.multiple === true
    return [{ question, header, options, multiSelect }]
  })
  return questions.length ? questions : null
}

export interface QuestionParts {
  /** The reply without its question block. */
  text: string
  questions: CoderQuestion[] | null
  /** The block is still arriving. */
  writing: boolean
}

/** Takes a reply's question block off its end, where the model asks before going on. */
export function splitQuestion(reply: string): QuestionParts {
  const match = new RegExp('(?:^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*' + QUESTION_FENCE + '[ \\t]*\\r?\\n').exec(reply)
  if (!match) return { text: reply, questions: null, writing: false }
  const fence = match[1]!
  const start = match.index + match[0].length
  const close = new RegExp('\\n[ \\t]*' + fence[0] + '{' + fence.length + ',}[ \\t]*(?=\\r?\\n|$)').exec(reply.slice(start))
  const before = reply.slice(0, match.index).trimEnd()
  if (!close) return { text: before, questions: null, writing: true }
  let questions: CoderQuestion[] | null = null
  try {
    questions = parseQuestions(JSON.parse(reply.slice(start, start + close.index)))
  } catch {
    questions = null
  }
  const after = reply.slice(start + close.index + close[0].length).trim()
  // A block that can't be read stays as the text it was, rather than vanishing.
  if (!questions) return { text: reply, questions: null, writing: false }
  return { text: after ? `${before}\n\n${after}` : before, questions, writing: false }
}

/** The person's answers as the message that goes back to the model, and shows in the conversation. */
export function questionAnswerMessage(questions: CoderQuestion[], answers: CoderQuestionAnswer[] | null): string {
  if (!answers) return 'I’d rather not choose. Go with what you think is best, and say what you picked.'
  if (questions.length === 1) {
    const picked = answers[0] ?? []
    return picked.length ? picked.join(', ') : 'I’d rather not choose. Go with what you think is best.'
  }
  return questions.map((question, index) => `**${question.header || question.question}:** ${(answers[index] ?? []).join(', ') || 'your call'}`).join('\n')
}

/** For models without tool calling: how to ask, as text. */
export const QUESTION_INSTRUCTIONS = `When you can't give a good answer without a choice only the person can make (which of a few options they mean, their preference, details you can't find out), ask instead of guessing: write a short sentence, then end your reply with one fenced block tagged ${QUESTION_FENCE} holding only JSON, which shows them buttons to pick from:
\`\`\`${QUESTION_FENCE}
{"questions":[{"question":"Which trip should I plan?","header":"Trip","options":[{"label":"A weekend","description":"Two nights, nearby"},{"label":"A week","description":"Seven nights, further away"}],"multiSelect":false}]}
\`\`\`
Up to 4 questions, each with 2 to 6 short options; they can also write their own answer. Ask only when it matters, not for things you can reasonably assume, and never more than once in a row.`
