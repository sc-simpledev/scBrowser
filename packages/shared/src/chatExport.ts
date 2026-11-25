import { ASSISTANT_NAME, type SavedTurn } from './ai'
import { splitQuestion } from './questions'
import { reportMarkdown, shownMessage, splitReply } from './report'

/** A reply as plain Markdown: reports written out, questions as a list, nothing left as raw JSON. */
function replyMarkdown(content: string): string {
  const { text, questions } = splitQuestion(content)
  const parts: string[] = []
  let rest = text
  // A reply can hold more than one report; each is written out where it was.
  for (let guard = 0; rest && guard < 20; guard++) {
    const { before, after, report } = splitReply(rest, true)
    if (!report) {
      parts.push(rest.trim())
      break
    }
    if (before.trim()) parts.push(before.trim())
    parts.push(reportMarkdown(report).trim())
    rest = after
  }
  if (questions) {
    parts.push(
      questions
        .map((question) => `**${question.question}**\n${question.options.map((option) => `- ${option.label}${option.description ? `: ${option.description}` : ''}`).join('\n')}`)
        .join('\n\n')
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

/** A short name for a chat, from its first message. */
export function chatTitle(turns: Pick<SavedTurn, 'role' | 'content'>[]): string {
  const first = turns.find((turn) => turn.role === 'user')
  const line = first ? shownMessage(first.content).replace(/\s+/g, ' ').trim() : ''
  if (!line) return 'Chat'
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line
}

/** A conversation as a Markdown document, for "Save chat". */
export function chatMarkdown(turns: Pick<SavedTurn, 'role' | 'content' | 'pageTitle'>[], savedAt: Date): string {
  const lines = [`# ${chatTitle(turns)}`, '', `_Saved from scTerra on ${savedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}_`]
  for (const turn of turns) {
    if (!turn.content.trim()) continue
    if (turn.role === 'user') {
      lines.push('', '## You', '', shownMessage(turn.content).trim())
    } else {
      lines.push('', `## ${ASSISTANT_NAME}`, ...(turn.pageTitle ? ['', `_About: ${turn.pageTitle}_`] : []), '', replyMarkdown(turn.content))
    }
  }
  return `${lines.join('\n')}\n`
}

/** A file name for a saved chat, safe on every system. */
export const chatFileName = (turns: Pick<SavedTurn, 'role' | 'content'>[]) =>
  `${chatTitle(turns).replace(/…$/, '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Chat'}.md`
