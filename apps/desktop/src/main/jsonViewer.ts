import type { WebContents } from 'electron'

const WORLD = 1023
/** Bigger documents stay as Chromium shows them: drawing a tree of them would hang the tab. */
export const MAX_JSON_CHARS = 8_000_000

/**
 * Pages that are JSON, shown as a tree that folds, with colours, Raw and Copy, as in Firefox. It
 * runs in an isolated world on the plain text Chromium already drew, and draws into a closed
 * shadow root, so the page can't reach it. Nothing is sent anywhere.
 */
const CSS = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .page { --bg: #ffffff; --bar: #f6f7f9; --text: #1b1d21; --muted: #6b7280; --line: #e4e6eb; --key: #7c3aed; --string: #0f7b46; --number: #1d4ed8; --literal: #b45309; --hover: #eef0f3; --accent: #0f766e;
      background: var(--bg); color: var(--text); min-height: 100vh; font: 13px/1.6 ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace; }
    @media (prefers-color-scheme: dark) {
      .page { --bg: #16181c; --bar: #1d2025; --text: #e6e8eb; --muted: #9aa1ab; --line: #2b2f36; --key: #c4b5fd; --string: #6ee7b7; --number: #93c5fd; --literal: #fcd34d; --hover: #23272d; --accent: #5eead4; }
    }
    .bar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--bar); border-bottom: 1px solid var(--line); font-family: system-ui, sans-serif; font-size: 12px; }
    .title { font-weight: 600; margin-right: 8px; }
    .size { color: var(--muted); margin-right: auto; }
    button { font: inherit; color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
    button:hover { background: var(--hover); }
    button[aria-pressed="true"] { background: var(--bg); border-color: var(--line); font-weight: 500; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .sep { width: 1px; height: 16px; background: var(--line); margin: 0 4px; }
    .tree { padding: 10px 16px 32px; }
    .raw { margin: 0; padding: 10px 16px 32px; white-space: pre-wrap; word-break: break-word; }
    details { padding-left: 16px; }
    details > summary { margin-left: -16px; list-style: none; cursor: pointer; border-radius: 4px; padding-left: 16px; position: relative; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before { content: ''; position: absolute; left: 4px; top: 0.6em; border: 4px solid transparent; border-left: 5px solid var(--muted); border-right: 0; transition: transform 120ms ease; }
    details[open] > summary::before { transform: rotate(90deg); transform-origin: 2px 4px; }
    details > summary:hover { background: var(--hover); }
    .row { padding-left: 16px; border-radius: 4px; }
    .row:hover { background: var(--hover); }
    .key { color: var(--key); }
    .string { color: var(--string); word-break: break-word; }
    .number { color: var(--number); }
    .literal { color: var(--literal); }
    .hint { color: var(--muted); }
    a { color: inherit; text-decoration: underline; text-decoration-color: var(--muted); text-underline-offset: 2px; }
`

const SCRIPT = String.raw`(() => {
  if (globalThis.__scJson) return 'shown'
  const type = (document.contentType || '').toLowerCase()
  if (!/^(application|text)\/([\w.+-]*\+)?json$/.test(type) && type !== 'application/json') return 'not json'
  const pre = document.body && document.body.querySelector(':scope > pre')
  if (!pre) return 'no text'
  const raw = pre.textContent || ''
  if (!raw.trim() || raw.length > ${MAX_JSON_CHARS}) return 'skipped'
  let data
  try { data = JSON.parse(raw) } catch { return 'invalid' }
  globalThis.__scJson = true

  const host = document.createElement('scterra-json')
  host.style.cssText = 'all: initial; display: block'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = ${JSON.stringify(CSS)}

  const page = document.createElement('div')
  page.className = 'page'
  const make = (tag, className, text) => {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }
  const bar = make('div', 'bar')
  bar.append(make('span', 'title', 'JSON'))
  const bytes = new Blob([raw]).size
  bar.append(make('span', 'size', bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : bytes > 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' bytes'))
  const prettyButton = make('button', '', 'Tree')
  const rawButton = make('button', '', 'Raw')
  const expandButton = make('button', '', 'Expand all')
  const collapseButton = make('button', '', 'Collapse all')
  const copyButton = make('button', '', 'Copy')
  bar.append(prettyButton, rawButton, make('span', 'sep'), expandButton, collapseButton, make('span', 'sep'), copyButton)

  const tree = make('div', 'tree')
  const rawView = make('pre', 'raw', JSON.stringify(data, null, 2))
  const isLink = (text) => /^https?:\/\/\S+$/.test(text)
  const keyLabel = (key) => (typeof key === 'number' ? make('span', 'hint', key + ': ') : make('span', 'key', JSON.stringify(key) + ': '))
  const value = (item) => {
    if (item === null) return make('span', 'literal', 'null')
    if (typeof item === 'string') {
      const span = make('span', 'string')
      if (isLink(item)) {
        const link = make('a', '', JSON.stringify(item))
        link.href = item
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        span.append(link)
      } else span.textContent = JSON.stringify(item)
      return span
    }
    if (typeof item === 'number') return make('span', 'number', String(item))
    return make('span', 'literal', String(item))
  }
  const summaryText = (item) => (Array.isArray(item) ? '[' + item.length + (item.length === 1 ? ' item]' : ' items]') : '{' + Object.keys(item).length + (Object.keys(item).length === 1 ? ' key}' : ' keys}'))
  // Children are drawn when their fold first opens, so a big document stays quick.
  const node = (key, item, depth) => {
    if (item === null || typeof item !== 'object') {
      const row = make('div', 'row')
      if (key !== null) row.append(keyLabel(key))
      row.append(value(item))
      return row
    }
    const fold = document.createElement('details')
    const summary = document.createElement('summary')
    if (key !== null) summary.append(keyLabel(key))
    summary.append(make('span', 'hint', summaryText(item)))
    fold.append(summary)
    let drawn = false
    const draw = () => {
      if (drawn) return
      drawn = true
      const entries = Array.isArray(item) ? item.map((child, index) => [index, child]) : Object.entries(item)
      for (const [childKey, child] of entries) fold.append(node(childKey, child, depth + 1))
    }
    fold.addEventListener('toggle', () => fold.open && draw())
    if (depth < 2) {
      fold.open = true
      draw()
    }
    return fold
  }
  tree.append(node(null, data, 0))

  const show = (pretty) => {
    tree.hidden = !pretty
    rawView.hidden = pretty
    prettyButton.setAttribute('aria-pressed', String(pretty))
    rawButton.setAttribute('aria-pressed', String(!pretty))
    expandButton.disabled = collapseButton.disabled = !pretty
  }
  prettyButton.onclick = () => show(true)
  rawButton.onclick = () => show(false)
  expandButton.onclick = () => {
    // Opening draws the next level, which has folds of its own; a few rounds reach most documents.
    for (let round = 0; round < 12; round++) {
      const closed = tree.querySelectorAll('details:not([open])')
      if (closed.length === 0 || closed.length > 20000) break
      for (const fold of closed) fold.open = true
    }
  }
  collapseButton.onclick = () => {
    for (const fold of tree.querySelectorAll('details')) fold.open = false
    const top = tree.querySelector('details')
    if (top) top.open = true
  }
  copyButton.onclick = () => {
    navigator.clipboard.writeText(raw).then(() => {
      copyButton.textContent = 'Copied'
      setTimeout(() => (copyButton.textContent = 'Copy'), 1500)
    }, () => {})
  }
  page.append(bar, tree, rawView)
  root.append(style, page)
  show(true)
  for (const child of [...document.body.children]) child.style.display = 'none'
  document.body.style.margin = '0'
  document.body.append(host)
  return 'shown'
})()`

/** Draws the viewer if the page is JSON. Resolves to what it did, for tests. */
export async function showJsonViewer(contents: WebContents): Promise<string> {
  const url = contents.getURL()
  if (!/^(https?|file):/i.test(url)) return 'not a web page'
  return String(await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT }]).catch(() => 'failed'))
}
