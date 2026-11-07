import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdit, clip, commandEnv, inside, lineDiff, listFiles, readLines, runCommand, searchFiles, ToolError } from './coderTools'

let root = ''
let outside = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'coder-'))
  outside = await mkdtemp(join(tmpdir(), 'coder-out-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1\nexport const b = 2\n')
  await writeFile(join(root, 'node_modules', 'x.js'), 'export const a = 1\n')
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(outside, join(root, 'escape'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('coder tools', () => {
  it('keeps paths inside the project, through links too', async () => {
    await expect(inside(root, '../x')).rejects.toBeInstanceOf(ToolError)
    await expect(inside(root, '/etc/passwd')).rejects.toBeInstanceOf(ToolError)
    await expect(inside(root, 'escape/secret.txt')).rejects.toBeInstanceOf(ToolError)
    await expect(inside(root, 'escape/new/file.txt')).rejects.toBeInstanceOf(ToolError)
    expect(await inside(root, 'src/new/b.ts')).toContain('src')
  })

  it('lists, reads and searches, skipping dependency folders', async () => {
    const list = await listFiles(root, '.')
    expect(list).toContain('src/')
    expect(list).toContain('node_modules/ (skipped)')
    expect(await readLines(root, 'src/a.ts', 2, 1)).toContain('    2  export const b = 2')
    const hits = await searchFiles(root, '.', 'const a')
    expect(hits).toBe('src/a.ts:1: export const a = 1')
  })

  it('edits one exact place, forgiving indentation', () => {
    expect(applyEdit('a\nb\nc', 'b', 'B')).toBe('a\nB\nc')
    expect(applyEdit('  if (x) {\n    y()\n  }', 'if (x) {\n  y()\n}', 'if (x) {\n  z()\n}')).toBe('if (x) {\n  z()\n}')
    expect(() => applyEdit('a a', 'a', 'b')).toThrow(/more than one/)
    expect(() => applyEdit('a', 'zzz', 'b')).toThrow(/not found/)
  })

  it('shows only the changed lines with a little around them', () => {
    expect(lineDiff('1\n2\n3\n4\n5\n6\n7\n8', '1\n2\n3\n4\nfive\n6\n7\n8')).toBe('@@ line 2 @@\n  2\n  3\n  4\n- 5\n+ five\n  6\n  7\n  8')
  })

  it('keeps the end of long output', () => {
    const out = clip('a'.repeat(100) + 'END', 20)
    expect(out.endsWith('END')).toBe(true)
  })

  it("drops an AppImage's own libraries from commands", () => {
    const env = commandEnv({ APPDIR: '/tmp/.mount_x', LD_LIBRARY_PATH: '/tmp/.mount_x/usr/lib:/opt/lib', PATH: '/tmp/.mount_x/bin:/usr/bin', ELECTRON_RUN_AS_NODE: '1', HOME: '/home/a' })
    expect(env).toEqual({ LD_LIBRARY_PATH: '/opt/lib', PATH: '/usr/bin', HOME: '/home/a' })
  })

  it.skipIf(process.platform === 'win32')('runs a command in the project folder and reports failure', async () => {
    const ok = await runCommand(root, 'cat src/a.ts', new AbortController().signal)
    expect(ok.ok).toBe(true)
    expect(ok.output).toContain('export const a = 1')
    const bad = await runCommand(root, 'exit 3', new AbortController().signal)
    expect(bad).toMatchObject({ ok: false })
    expect(bad.output).toContain('exit code 3')
    const slow = await runCommand(root, 'sleep 5', new AbortController().signal, 300)
    expect(slow.output).toContain('stopped after')
    expect(await readFile(join(root, 'src', 'a.ts'), 'utf8')).toContain('const b')
  })
})
