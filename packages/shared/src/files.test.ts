import { describe, expect, it } from 'vitest'
import { applyEdits, conversationFiles, previewKind, safeFileName, shownFileMessage, splitFiles, reviseFilePrompt } from './files'

const file = (name: string, body: string) => `\`\`\`\`scterra-file name="${name}"\n${body}\n\`\`\`\``
const edit = (name: string, find: string, replace: string) => `\`\`\`\`scterra-edit name="${name}"\n<<<<<<< FIND\n${find}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\``

describe('splitFiles', () => {
  it('finds files between text, keeping code fences inside them', () => {
    const body = 'const a = 1\n```\nnot the end\n```\nconst b = 2'
    const segments = splitFiles(`Here you go.\n${file('app.js', body)}\nEnjoy.`)
    expect(segments.map((s) => s.kind)).toEqual(['text', 'file', 'text'])
    expect(segments[1]).toEqual({ kind: 'file', name: 'app.js', content: body, done: true })
  })

  it('shows a file still being written as not done', () => {
    const [, written] = splitFiles('Making it.\n````scterra-file name="index.html"\n<h1>Hi')
    expect(written).toEqual({ kind: 'file', name: 'index.html', content: '<h1>Hi', done: false })
  })

  it('reads edits, and leaves text alone when there are no files', () => {
    expect(splitFiles(edit('a.txt', 'old', 'new'))[0]).toEqual({ kind: 'edit', name: 'a.txt', edits: [{ find: 'old', replace: 'new' }], done: true })
    expect(splitFiles('Just words.')).toEqual([{ kind: 'text', text: 'Just words.' }])
  })
})

describe('applyEdits', () => {
  it('replaces exact text, and refuses a FIND that is missing or appears twice', () => {
    expect(applyEdits('a\nb\nc', [{ find: 'b', replace: 'B' }])).toEqual({ content: 'a\nB\nc' })
    expect(applyEdits('a', [{ find: 'zzz', replace: 'B' }])).toHaveProperty('error')
    expect(applyEdits('x x', [{ find: 'x', replace: 'y' }])).toHaveProperty('error')
  })

  it('forgives indentation that is slightly off', () => {
    expect(applyEdits('<div>\n    <p>Hi</p>\n</div>', [{ find: '  <p>Hi</p>', replace: '    <p>Hello</p>' }])).toEqual({ content: '<div>\n    <p>Hello</p>\n</div>' })
  })
})

describe('conversationFiles', () => {
  it('keeps each version, and reports an edit that failed without changing the file', () => {
    const turns = [
      { role: 'user', content: 'Make a page' },
      { role: 'assistant', content: `Made it.\n${file('index.html', '<h1>One</h1>')}` },
      { role: 'user', content: 'Change it' },
      { role: 'assistant', content: `Changed.\n${edit('index.html', '<h1>One</h1>', '<h1>Two</h1>')}\n${edit('index.html', 'missing', 'x')}` }
    ]
    const { files, changes } = conversationFiles(turns)
    expect(files.get('index.html')!.map((v) => [v.how, v.content])).toEqual([['created', '<h1>One</h1>'], ['edited', '<h1>Two</h1>']])
    expect(changes.get(3)!.map((c) => c.how)).toEqual(['edited', 'failed'])
  })
})

describe('file names and previews', () => {
  it('keeps names to a plain file', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('my game!.html')).toBe('my-game-.html')
    expect(safeFileName('')).toBe('file.txt')
    expect(safeFileName('.bashrc')).toBe('bashrc')
  })

  it('knows what can be previewed', () => {
    expect([previewKind('a.html'), previewKind('a.svg'), previewKind('a.md'), previewKind('a.js'), previewKind('a.py')]).toEqual(['html', 'svg', 'markdown', 'script', null])
  })

  it('shows a change request as what was asked', () => {
    expect(shownFileMessage(reviseFilePrompt('index.html', '<p>x</p>', 'make it blue'))).toBe('Change to index.html: make it blue')
  })
})
