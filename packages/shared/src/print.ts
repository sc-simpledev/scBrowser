/** A printer as the print dialog lists it. */
export interface PrinterChoice {
  name: string
  displayName: string
  isDefault: boolean
}

/** What the print dialog asks for. `pages` is what the person typed, like "1-3, 5", or empty for all. */
export interface PrintChoice {
  /** A printer's name, or 'pdf' to save as a PDF file. */
  destination: string
  pages: string
  copies: number
  landscape: boolean
  color: boolean
  twoSided: boolean
}

export const DEFAULT_PRINT: PrintChoice = { destination: '', pages: '', copies: 1, landscape: false, color: true, twoSided: false }

/** "1-3, 5" as ranges counted from 1, or null if it isn't a list of pages within the document. */
export function parsePageRanges(text: string, pageCount: number): { from: number; to: number }[] | null {
  const trimmed = text.trim()
  if (!trimmed) return [{ from: 1, to: pageCount }]
  const ranges: { from: number; to: number }[] = []
  for (const part of trimmed.split(/\s*,\s*/)) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!match) return null
    const from = Number(match[1])
    const to = match[2] === undefined ? from : Number(match[2])
    if (from < 1 || to < from || to > pageCount) return null
    ranges.push({ from, to })
  }
  return ranges
}

/** Every page number the ranges cover, in order, each once. */
export const pagesIn = (ranges: { from: number; to: number }[]): number[] =>
  [...new Set(ranges.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, index) => from + index)))].sort((a, b) => a - b)

export function isPrintChoice(value: unknown): value is PrintChoice {
  const v = value as Partial<PrintChoice> | null
  return (
    !!v &&
    typeof v.destination === 'string' &&
    v.destination.length <= 512 &&
    typeof v.pages === 'string' &&
    v.pages.length <= 200 &&
    Number.isInteger(v.copies) &&
    v.copies! >= 1 &&
    v.copies! <= 99 &&
    typeof v.landscape === 'boolean' &&
    typeof v.color === 'boolean' &&
    typeof v.twoSided === 'boolean'
  )
}
