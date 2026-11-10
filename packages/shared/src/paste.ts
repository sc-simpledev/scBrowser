const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' }

/** Pages and learning sites sometimes hand over their escaped text, like `people&#39;s`. */
const ENTITY = /&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]{2,8});/gi

function decode(entity: string): string | null {
  if (entity.startsWith('#x') || entity.startsWith('#X')) return safeCode(Number.parseInt(entity.slice(2), 16))
  if (entity.startsWith('#')) return safeCode(Number.parseInt(entity.slice(1), 10))
  return NAMED[entity.toLowerCase()] ?? null
}

const safeCode = (code: number) => (Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : null)

/**
 * Tidies text pasted into a message box: escaped characters are written out, invisible characters
 * and non-breaking spaces go, and runs of blank lines shrink to one. Code (anything with a tag or a
 * fence) keeps its entities, as those are probably meant.
 */
export function cleanPasted(text: string): string {
  const looksLikeCode = /```|<\/?[a-z][\w-]*[\s>]/i.test(text)
  let out = looksLikeCode ? text : text.replace(ENTITY, (whole, entity: string) => decode(entity) ?? whole)
  out = out
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  return out
}
