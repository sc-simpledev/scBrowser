/** Kinds of secret that are easy to recognise and costly to leak, by what they look like. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['a private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/],
  ['an AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['an AI provider key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['a Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/],
  ['a password in a connection address', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{6,}@[\w.-]+/i]
]

export interface FoundSecret {
  file: string
  line: number
  kind: string
}

/**
 * Lines a diff adds that look like secrets, as `git diff` writes it. Only added lines count, and
 * lines that obviously hold an example (placeholder words) are left alone.
 */
export function findSecrets(diff: string): FoundSecret[] {
  const found: FoundSecret[] = []
  let file = ''
  let line = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text.replace(/^\+\+\+ (b\/)?/, '').trim()
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (text.startsWith('+')) {
      const added = text.slice(1)
      if (!/example|placeholder|your[_-]?(api[_-]?)?key|xxxx|<[a-z_ -]+>/i.test(added)) {
        const kind = SECRET_PATTERNS.find(([, pattern]) => pattern.test(added))?.[0]
        if (kind && found.length < 20) found.push({ file, line, kind })
      }
      line++
    } else if (!text.startsWith('-')) line++
  }
  return found
}

/** What to tell the person about secrets found, or null with none. */
export function secretWarning(found: FoundSecret[]): string | null {
  if (found.length === 0) return null
  const where = found.slice(0, 5).map((one) => `${one.file}:${one.line} (${one.kind})`).join(', ')
  return `Possible secret${found.length === 1 ? '' : 's'} in what would be committed: ${where}${found.length > 5 ? `, and ${found.length - 5} more` : ''}. Take ${found.length === 1 ? 'it' : 'them'} out, or commit anyway if ${found.length === 1 ? 'it isn’t one' : 'they aren’t'}.`
}
