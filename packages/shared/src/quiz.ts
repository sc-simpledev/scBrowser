import type { Report } from './report'

/**
 * Spaced repetition for report quizzes, in Leitner boxes: a question you know moves up a box and
 * waits longer before it comes back, one you miss goes back to the first box and comes back today.
 */
export interface CardProgress {
  box: number
  /** When it's next worth asking, in milliseconds since 1970. */
  due: number
}

export type QuizProgress = Record<string, CardProgress>

/** Days to wait after a right answer in each box. Box 0 is new. */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35, 90]
const DAY = 86_400_000
export const MAX_QUIZ_CARDS = 3000

/** A short stable key for a question, so its progress follows it into new drafts of the report. */
export function cardKey(question: string): string {
  const text = question.toLowerCase().replace(/\s+/g, ' ').trim()
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return `q${a.toString(36)}${b.toString(36)}`
}

export function schedule(previous: CardProgress | undefined, knew: boolean, now: number): CardProgress {
  if (!knew) return { box: 1, due: now }
  const box = Math.min(BOX_DAYS.length - 1, (previous?.box ?? 0) + 1)
  return { box, due: now + BOX_DAYS[box]! * DAY }
}

export const isDue = (progress: CardProgress | undefined, now: number) => !progress || progress.due <= now

/** Due ones first (the longest overdue first), then new ones, then the rest by when they're due. */
export function orderCards<T extends { question: string }>(cards: T[], progress: QuizProgress, now: number): T[] {
  const rank = (card: T) => {
    const saved = progress[cardKey(card.question)]
    if (!saved) return [1, 0]
    return saved.due <= now ? [0, saved.due] : [2, saved.due]
  }
  return [...cards].sort((x, y) => {
    const [a, b] = [rank(x), rank(y)]
    return a[0]! - b[0]! || a[1]! - b[1]!
  })
}

/** "Tomorrow", "in 3 days", for when a question comes back. */
export function dueLabel(due: number, now: number): string {
  const days = Math.round((due - now) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export const quizCardsOf = (report: Report) => report.blocks.flatMap((block) => (block.type === 'quiz' ? block.items : []))

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * A printable worksheet: each question with lines to write on, and the answers on a page of their
 * own at the end. Like a saved report, it has no scripts and reaches nothing outside itself.
 */
export function quizWorksheetHtml(report: Report, css: string): string {
  const cards = quizCardsOf(report)
  const lines = (count: number) => '<div class="line"></div>'.repeat(count)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(report.title)}: practice questions</title>
<style>
${css}
body { margin: 0; padding: 40px 24px; background: #fff; color: #1f2328; font-family: var(--sc-font-sans); font-size: 14px; }
.sheet { max-width: 720px; margin: 0 auto; }
.sheet h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.02em; }
.sheet .meta { display: flex; gap: 24px; margin: 18px 0 28px; color: #5f6670; }
.sheet .meta span { flex: 1; border-bottom: 1px solid #c9ced4; padding-bottom: 4px; }
.sheet ol { padding-left: 22px; margin: 0; }
.sheet li { margin-bottom: 22px; break-inside: avoid; }
.sheet .q { font-weight: 600; margin-bottom: 10px; }
.sheet .line { height: 26px; border-bottom: 1px solid #d9dde1; }
.sheet .answers { break-before: page; }
.sheet .answers h2 { font-size: 18px; margin: 0 0 16px; }
.sheet .answers li { margin-bottom: 10px; }
.sheet .answers .q { font-weight: 600; margin: 0; }
.sheet .answers .a { color: #3d434a; }
</style>
</head>
<body>
<main class="sheet">
<h1>${escape(report.title)}</h1>
<div style="color:#5f6670">Practice questions</div>
<div class="meta"><span>Name</span><span>Date</span><span>Score&nbsp;&nbsp;&nbsp;&nbsp;/ ${cards.length}</span></div>
<ol>${cards.map((card) => `<li><div class="q">${escape(card.question)}</div>${lines(Math.min(6, Math.max(2, Math.ceil(card.answer.length / 70) + 1)))}</li>`).join('')}</ol>
<section class="answers"><h2>Answers</h2><ol>${cards.map((card) => `<li><p class="q">${escape(card.question)}</p><p class="a">${escape(card.answer)}</p></li>`).join('')}</ol></section>
</main>
</body>
</html>
`
}

/** One field of a CSV row: quoted when it holds a comma, a quote or a line break. */
const csvField = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

/**
 * A report's practice questions as question,answer rows, which Anki, Quizlet and spreadsheets all
 * import. There is no header row, as Anki would take it for a card.
 */
export const quizCsv = (report: Report): string => quizCardsOf(report).map((card) => `${csvField(card.question)},${csvField(card.answer)}`).join('\r\n') + '\r\n'
