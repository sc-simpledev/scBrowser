import type { AssistantMessage } from './ai'

/**
 * Pieces of the assistant that came from Claude Code: a status line with the chat's tokens, a
 * context meter with /compact, saving an answer as a note, and memory the model may suggest.
 */

/** The fenced block a reply may end with to offer one thing to remember, which the page turns into a button. */
export const REMEMBER_FENCE = 'scterra-remember'

/** Told to the model only when memory is on: it may offer one lasting fact, and nothing is kept without the person's click. */
export const REMEMBER_INSTRUCTIONS = `\n\nIf, in this message, the person tells you something lasting about themselves or how they like answers (a preference, their job, a constraint such as "I'm vegetarian" or "use metric units") that isn't in your notes yet, you may offer to remember it: end your reply with a fenced block marked ${REMEMBER_FENCE} holding one short sentence about them, such as\n\`\`\`${REMEMBER_FENCE}\nPrefers metric units.\n\`\`\`\nOnly for something they'd want remembered next time, at most once per reply, and never for anything sensitive (health, money, passwords, other people's details). Most replies have none.`

/** A reply without its remember block, and the sentence it offered, if any. */
export function splitRemember(text: string): { text: string; remember: string | null } {
  const match = new RegExp('\\n*```' + REMEMBER_FENCE + '\\s*\\n([\\s\\S]*?)\\n?```\\s*$').exec(text)
  if (!match) {
    // Still arriving: hide a block that has started but not finished.
    const open = text.lastIndexOf('```' + REMEMBER_FENCE)
    return open === -1 ? { text, remember: null } : { text: text.slice(0, open).trimEnd(), remember: null }
  }
  const remember = match[1]!.replace(/\s+/g, ' ').trim().slice(0, 300)
  return { text: text.slice(0, match.index).trimEnd(), remember: remember || null }
}

/** `/compact`, alone, sums up a long chat to make room. */
export const isCompactCommand = (text: string) => /^\/compact\s*$/i.test(text.trim())

export const CHAT_COMPACT_PROMPT = `You sum up a conversation between a person and their AI assistant so it can carry on with less to read. The assistant will see only your summary in place of these messages, so it must stand on its own.

Keep: what the person wants and why, facts and decisions they gave, what the assistant found or answered (with numbers, names and links where they matter), anything left to do, and the person's preferences for how they're answered. Leave out greetings and repetition. Write it as short paragraphs or a list, in the person's language, at most about 400 words.`

/** The messages a chat sends once it has been summed up: the summary first, then what came after it. */
export function withSummary<T extends AssistantMessage>(messages: T[], summary: { text: string; upTo: number } | null): (T | AssistantMessage)[] {
  if (!summary || summary.upTo <= 0) return messages
  return [{ role: 'user', content: `(Earlier in this chat, summed up to make room:)\n${summary.text}` }, { role: 'assistant', content: 'Understood. I’ll carry on from there.' }, ...messages.slice(summary.upTo)]
}

/**
 * Roughly how many tokens a model can read at once, for the context meter. Providers rarely say,
 * so this goes by the model's name, and says "about" on screen.
 */
export function contextWindowFor(model: string | null): number {
  const name = (model ?? '').toLowerCase()
  if (/\[1m\]|1m\b/.test(name)) return 1_000_000
  if (/claude|anthropic|opus|sonnet|haiku|fable/.test(name)) return 200_000
  if (/gemini/.test(name)) return 1_000_000
  if (/gpt-5|o3|o4/.test(name)) return 400_000
  if (/gpt-4\.1/.test(name)) return 1_000_000
  if (/gpt-4o|gpt-4-turbo|deepseek|qwen|mistral|llama|grok/.test(name)) return 128_000
  if (name === 'scterra-chat') return 200_000
  return 128_000
}

/** 1234 as 1.2k, 1_234_567 as 1.2M. */
export function shortCount(count: number): string {
  if (count < 1000) return String(Math.round(count))
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/** A note's file name: the date, then the first words of the question. */
export function noteFileName(title: string, date: Date): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const words = title
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return `${day} ${words || 'Note'}.md`
}

/** An answer as a Markdown note, the way Obsidian and similar apps keep them: a little front matter, the question, the answer. */
export function noteMarkdown(answer: string, { question, page, date }: { question: string | null; page: { title: string; url: string } | null; date: Date }): string {
  const lines = ['---', `created: ${date.toISOString()}`, ...(page ? [`source: "${page.url.replace(/"/g, '%22')}"`] : []), 'tags: [scterra]', '---', '']
  if (question) lines.push(`> ${question.replace(/\n+/g, ' ').slice(0, 500)}`, '')
  if (page) lines.push(`From [${page.title.replace(/[[\]]/g, '')}](${page.url})`, '')
  lines.push(answer.trim(), '')
  return lines.join('\n')
}
