/**
 * The address bar's calculator: a small parser for sums like `7*8`, `2^10`, `(3+4)/2` or
 * `sqrt(2)`. It never calls `eval`. Anything it doesn't understand gives `null`, so ordinary
 * searches and addresses pass straight through.
 */

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 }

/** Long enough for real sums, short enough that nobody pastes a paragraph into the parser. */
const MAX_LENGTH = 200

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'name'; value: string }

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const number = /^(\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/i.exec(input.slice(i))
    if (number) {
      tokens.push({ type: 'num', value: Number(number[0]) })
      i += number[0].length
      continue
    }
    const name = /^[a-zπ]+/i.exec(input.slice(i))
    if (name) {
      const word = name[0].toLowerCase()
      const last = tokens.at(-1)
      // "7x8": an x between numbers means times.
      if (word === 'x' && last && (last.type === 'num' || last.value === ')')) tokens.push({ type: 'op', value: '*' })
      else tokens.push({ type: 'name', value: word })
      i += name[0].length
      continue
    }
    if (input.startsWith('**', i)) {
      tokens.push({ type: 'op', value: '^' })
      i += 2
      continue
    }
    const op = { '×': '*', '·': '*', '÷': '/', '−': '-', '–': '-' }[ch] ?? ch
    if (!'+-*/^%()'.includes(op)) return null
    tokens.push({ type: 'op', value: op })
    i++
  }
  return tokens
}

/** Recursive descent: sum → product → unary → power → atom. `^` binds right, and `-2^2` is -4. */
function parse(tokens: Token[]): number | null {
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (value: string) => peek()?.type === 'op' && peek()!.value === value

  const sum = (): number | null => {
    let left = product()
    while (left !== null && (isOp('+') || isOp('-'))) {
      const op = tokens[pos++]!.value
      const right = product()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  const product = (): number | null => {
    let left = unary()
    while (left !== null) {
      if (isOp('*') || isOp('/') || isOp('%')) {
        const op = tokens[pos++]!.value
        const right = unary()
        if (right === null) return null
        left = op === '*' ? left * right : op === '/' ? left / right : left % right
      } else if (peek()?.type === 'name' || isOp('(')) {
        // Written-together products: 2pi, 3(4+1), 2sqrt(9).
        const right = unary()
        if (right === null) return null
        left *= right
      } else break
    }
    return left
  }

  const unary = (): number | null => {
    if (isOp('-') || isOp('+')) {
      const negative = tokens[pos++]!.value === '-'
      const value = unary()
      return value === null ? null : negative ? -value : value
    }
    return power()
  }

  const power = (): number | null => {
    const base = atom()
    if (base === null || !isOp('^')) return base
    pos++
    const exponent = unary()
    return exponent === null ? null : base ** exponent
  }

  const atom = (): number | null => {
    const token = tokens[pos++]
    if (!token) return null
    if (token.type === 'num') return token.value
    if (token.type === 'op' && token.value === '(') {
      const value = sum()
      if (value === null || !isOp(')')) return null
      pos++
      return value
    }
    if (token.type === 'name') {
      if (token.value in CONSTANTS) return CONSTANTS[token.value]!
      const fn = FUNCTIONS[token.value]
      if (!fn) return null
      const arg = isOp('(') ? atom() : power()
      return arg === null ? null : fn(arg)
    }
    return null
  }

  const value = sum()
  return value !== null && pos === tokens.length ? value : null
}

/**
 * Works out a typed sum, or gives `null` for anything that isn't one. A lone number or
 * constant isn't a sum, so `42` and `e` stay searches; there must be an operator, a function
 * or a number times a constant (`2pi`).
 */
export function calculate(raw: string): number | null {
  const input = raw.trim().replace(/=\s*$/, '')
  if (!input || input.length > MAX_LENGTH) return null
  // Thousands separators (1,000,000) go; any other comma means this isn't a sum.
  const tokens = tokenize(input.replace(/(\d),(?=\d{3}(?!\d))/g, '$1'))
  if (!tokens || tokens.length < 2) return null
  const working =
    tokens.some((t) => (t.type === 'op' && t.value !== '(' && t.value !== ')') || (t.type === 'name' && t.value in FUNCTIONS)) ||
    // A number written against a constant, like 2pi.
    (tokens.some((t) => t.type === 'num') && tokens.some((t) => t.type === 'name'))
  if (!working) return null
  // A leading minus on one number ("-5") is just a number.
  if (tokens.length === 2 && tokens[0]!.type === 'op' && tokens[1]!.type === 'num') return null
  const value = parse(tokens)
  return value === null || Number.isNaN(value) ? null : value
}

/** Rounds away floating-point noise (0.1+0.2 shows 0.3) and keeps huge or tiny numbers readable. */
export function formatCalculation(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '-∞' : 'Not a number'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-9) return value.toPrecision(10).replace(/\.?0+e/, 'e').replace('e+', 'e')
  return String(Number(value.toPrecision(12)))
}
