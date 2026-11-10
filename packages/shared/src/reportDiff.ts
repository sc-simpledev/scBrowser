import type { Report, ReportBlock } from './report'

export type BlockChange = 'added' | 'removed' | null

/**
 * What changed between two drafts of a report, block by block. The result holds every block of
 * the newer draft in order, with the blocks the older one had and lost put back where they were,
 * and says of each whether it is new, gone or unchanged. A reworded block shows as gone then new.
 */
export function diffReports(before: Report, after: Report): { blocks: ReportBlock[]; changes: BlockChange[] } {
  const a = before.blocks.map((block) => JSON.stringify(block))
  const b = after.blocks.map((block) => JSON.stringify(block))
  // Longest common run of blocks, by the usual table.
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const blocks: ReportBlock[] = []
  const changes: BlockChange[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      blocks.push(after.blocks[j]!)
      changes.push(null)
      i++
      j++
    } else if (i < a.length && (j === b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      blocks.push(before.blocks[i]!)
      changes.push('removed')
      i++
    } else {
      blocks.push(after.blocks[j]!)
      changes.push('added')
      j++
    }
  }
  return { blocks, changes }
}

/** How many blocks were added and removed, for a one-line summary. */
export const changeCounts = (changes: BlockChange[]) => ({ added: changes.filter((change) => change === 'added').length, removed: changes.filter((change) => change === 'removed').length })
