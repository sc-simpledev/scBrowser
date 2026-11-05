/**
 * A small highlighter for the code pane. It only splits text into pieces with a kind, which
 * are drawn as React text, so nothing in a file can become markup.
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'tag' | 'attr'

export interface Token {
  kind: TokenKind
  text: string
}

/** Past this, highlighting would be slow to draw and of little help. */
const MAX_HIGHLIGHT = 200_000

const C_LIKE = 'break case catch class const continue default delete do else enum export extends false finally for function if import in instanceof interface let new null return static super switch this throw true try type typeof undefined var void while yield async await of from as public private protected readonly implements package struct fn impl mut pub use mod match loop where self Self trait func go defer chan select map range nil int float string bool char long double short byte unsigned signed sizeof template typename namespace using include define'
const PYTHON = 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print self'
const SHELL = 'if then else elif fi for while do done case esac in function return export local echo exit set unset source sudo cd'
const SQL = 'select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit as and or not null primary key foreign references index distinct union all'

type Family = 'c' | 'python' | 'shell' | 'sql' | 'markup' | 'css' | 'data' | 'text'

const FAMILY: Record<string, Family> = {
  javascript: 'c', typescript: 'c', java: 'c', kotlin: 'c', swift: 'c', c: 'c', cpp: 'c', csharp: 'c', go: 'c', rust: 'c', php: 'c',
  python: 'python', ruby: 'python', shell: 'shell', yaml: 'shell', toml: 'shell', sql: 'sql',
  html: 'markup', svg: 'markup', xml: 'markup', css: 'css', json: 'data', markdown: 'text', text: 'text'
}

const words = (list: string) => new Set(list.split(' '))
const KEYWORDS: Partial<Record<Family, Set<string>>> = { c: words(C_LIKE), python: words(PYTHON), shell: words(SHELL), sql: words(SQL) }

const PATTERNS: Record<Family, RegExp> = {
  c: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-f]+\b)|([A-Za-z_$][\w$]*)/gi,
  python: /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_][\w]*)/g,
  shell: /(#[^\n]*)|("(?:\\.|[^"\\])*"?|'[^']*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w-]*)/g,
  sql: /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:''|[^'])*'?|"[^"]*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)/g,
  markup: /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][\w:-]*|\/?>)|("[^"]*"?|'[^']*'?)|(\s[A-Za-z_:][\w:.-]*(?==))/g,
  css: /(\/\*[\s\S]*?(?:\*\/|$))|("[^"]*"?|'[^']*'?)|(#[\da-f]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b)|([a-z-]+(?=\s*:))/gi,
  data: /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*"?)|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g,
  text: /$^/g
}

export function highlight(code: string, language: string): Token[] {
  const family = FAMILY[language] ?? 'text'
  if (family === 'text' || code.length > MAX_HIGHLIGHT) return [{ kind: 'plain', text: code }]
  const pattern = new RegExp(PATTERNS[family].source, PATTERNS[family].flags)
  const keywords = KEYWORDS[family]
  const tokens: Token[] = []
  let last = 0
  const push = (kind: TokenKind, text: string) => {
    if (!text) return
    const previous = tokens.at(-1)
    if (previous?.kind === kind) previous.text += text
    else tokens.push({ kind, text })
  }
  for (const match of code.matchAll(pattern)) {
    if (match[0] === '') continue
    push('plain', code.slice(last, match.index))
    last = match.index + match[0].length
    const [, first, second, third, fourth] = match
    let kind: TokenKind = 'plain'
    if (family === 'markup') kind = first ? 'comment' : second ? 'tag' : third ? 'string' : fourth ? 'attr' : 'plain'
    else if (family === 'css') kind = first ? 'comment' : second ? 'string' : third ? 'number' : fourth ? 'attr' : 'plain'
    else if (family === 'data') kind = first ? 'attr' : second ? 'string' : third ? 'number' : fourth ? 'keyword' : 'plain'
    else if (first) kind = 'comment'
    else if (second) kind = 'string'
    else if (third) kind = 'number'
    else if (fourth) kind = keywords?.has(family === 'sql' ? fourth.toLowerCase() : fourth) ? 'keyword' : 'plain'
    push(kind, match[0])
  }
  push('plain', code.slice(last))
  return tokens
}
