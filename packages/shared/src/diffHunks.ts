/** Splitting a file's changes into separate pieces, each of which can be kept or put back on its own. */

export interface DiffRange {
  /** Lines `beforeStart` up to `beforeEnd` were replaced by lines `afterStart` up to `afterEnd`. */
  beforeStart: number
  beforeEnd: number
  afterStart: number
  afterEnd: number
}

/** Above this many comparisons, a line-by-line match costs too much and the changed part is one piece. */
const MAX_CELLS = 4_000_000
const CONTEXT = 3

export function diffRanges(before: string[], after: string[]): DiffRange[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endA = before.length
  let endB = after.length
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA--
    endB--
  }
  if (start === endA && start === endB) return []
  const n = endA - start
  const m = endB - start
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return [{ beforeStart: start, beforeEnd: endA, afterStart: start, afterEnd: endB }]

  // Longest common subsequence, built from the end so it can be walked forwards.
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = before[start + i] === after[start + j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const ranges: DiffRange[] = []
  let open: DiffRange | null = null
  let i = 0
  let j = 0
  const close = () => {
    if (open) ranges.push(open)
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && before[start + i] === after[start + j]) {
      close()
      i++
      j++
      continue
    }
    open ??= { beforeStart: start + i, beforeEnd: start + i, afterStart: start + j, afterEnd: start + j }
    if (j < m && (i === n || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) open.afterEnd = start + ++j
    else open.beforeEnd = start + ++i
  }
  close()
  return ranges
}

/** A short stable name for a change: where it is and exactly what it does. */
function fingerprint(range: DiffRange, removed: string[], added: string[]): string {
  let hash = 5381
  for (const char of `${range.beforeStart}\0${removed.join('\n')}\0${added.join('\n')}`) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0
  return `${range.beforeStart}-${hash.toString(36)}`
}

export interface FileHunk {
  id: string
  line: number
  rows: string[]
  range: DiffRange
}

export function fileHunks(beforeText: string, afterText: string): FileHunk[] {
  const before = beforeText.split('\n')
  const after = afterText.split('\n')
  return diffRanges(before, after).map((range) => {
    const removed = before.slice(range.beforeStart, range.beforeEnd)
    const added = after.slice(range.afterStart, range.afterEnd)
    const lead = before.slice(Math.max(0, range.beforeStart - CONTEXT), range.beforeStart)
    const tail = before.slice(range.beforeEnd, range.beforeEnd + CONTEXT)
    return {
      id: fingerprint(range, removed, added),
      line: range.afterStart + 1,
      range,
      rows: [...lead.map((line) => `  ${line}`), ...removed.map((line) => `- ${line}`), ...added.map((line) => `+ ${line}`), ...tail.map((line) => `  ${line}`)]
    }
  })
}

/** The "before" text with one change kept, so it no longer counts as a change. */
export function acceptHunk(beforeText: string, afterText: string, range: DiffRange): string {
  const before = beforeText.split('\n')
  const after = afterText.split('\n')
  return [...before.slice(0, range.beforeStart), ...after.slice(range.afterStart, range.afterEnd), ...before.slice(range.beforeEnd)].join('\n')
}

/** The "after" text with one change put back as it was. */
export function rejectHunk(beforeText: string, afterText: string, range: DiffRange): string {
  const before = beforeText.split('\n')
  const after = afterText.split('\n')
  return [...after.slice(0, range.afterStart), ...before.slice(range.beforeStart, range.beforeEnd), ...after.slice(range.afterEnd)].join('\n')
}
