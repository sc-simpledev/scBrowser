import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData, getVersion: () => '1.0.0' }, net: {} }))

const { canReplaceApp, SWAP_SCRIPT, zipForArch } = await import('./macUpdate')

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scb mac'update-"))
  userData = dir
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('zipForArch', () => {
  const files = [{ url: 'scTerra-1.0.0-arm64-mac.zip', sha512: 'a' }, { url: 'scTerra-1.0.0-x64-mac.zip', sha512: 'b' }, { url: 'scTerra-1.0.0-arm64-mac.dmg', sha512: 'c' }]
  it('picks the zip for this kind of Mac', () => {
    expect(zipForArch(files, 'arm64')?.sha512).toBe('a')
    expect(zipForArch(files, 'x64')?.sha512).toBe('b')
    expect(zipForArch(files.slice(1), 'arm64')).toBeUndefined()
  })
})

describe('canReplaceApp', () => {
  const bundle = () => {
    const path = join(dir, 'scTerra.app')
    mkdirSync(path)
    return path
  }
  it('takes a writable bundle', () => expect(canReplaceApp(bundle())).toBe(true))
  it('refuses the disk image, and a hidden read-only copy', () => {
    expect(canReplaceApp('/Volumes/scTerra/scTerra.app')).toBe(false)
    expect(canReplaceApp('/private/var/folders/x/AppTranslocation/y/d/scTerra.app')).toBe(false)
  })
  it('stops trying with a version that has failed, but not the next', () => {
    const path = bundle()
    writeFileSync(join(dir, 'mac-update-failed'), '1.0.0')
    expect(canReplaceApp(path, '1.0.0')).toBe(false)
    expect(canReplaceApp(path, '1.0.1')).toBe(true)
  })
})

// It only ever runs on a Mac, and Windows has no `/bin/sh` to try it with.
describe.skipIf(process.platform === 'win32')('the swap script', () => {
  /** Runs it for a process that's already gone, with `open` recorded rather than run. */
  const swap = (current: string, next: string, reopen = '1') => {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'open'), `#!/bin/sh\nprintf %s "$1" > "${join(dir, 'opened').replaceAll("'", "'")}"\n`)
    chmodSync(join(bin, 'open'), 0o755)
    const gone = spawnSync('true').pid
    return spawnSync('/bin/sh', ['-c', SWAP_SCRIPT, 'test', String(gone), current, next, reopen, join(dir, 'failed'), '1.0.0'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  }
  const app = (path: string, text: string) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'version'), text)
  }

  it('swaps in the new app, tidies up and reopens it', () => {
    const current = join(dir, 'scTerra.app')
    const next = join(dir, 'mac-update/unpacked/scTerra.app')
    app(current, 'old')
    app(next, 'new')
    swap(current, next)
    expect(readFileSync(join(current, 'version'), 'utf8')).toBe('new')
    expect(existsSync(join(dir, 'mac-update'))).toBe(false)
    expect(readFileSync(join(dir, 'opened'), 'utf8')).toBe(current)
    expect(existsSync(join(dir, 'failed'))).toBe(false)
  })

  it('puts the old app back and records it when the new one is missing', () => {
    const current = join(dir, 'scTerra.app')
    app(current, 'old')
    swap(current, join(dir, 'nothing/here/scTerra.app'))
    expect(readFileSync(join(current, 'version'), 'utf8')).toBe('old')
    expect(readFileSync(join(dir, 'failed'), 'utf8')).toBe('1.0.0')
    expect(readFileSync(join(dir, 'opened'), 'utf8')).toBe(current)
  })

  it("doesn't reopen when it was only quitting", () => {
    const current = join(dir, 'scTerra.app')
    const next = join(dir, 'mac-update/unpacked/scTerra.app')
    app(current, 'old')
    app(next, 'new')
    swap(current, next, '0')
    expect(readFileSync(join(current, 'version'), 'utf8')).toBe('new')
    expect(existsSync(join(dir, 'opened'))).toBe(false)
  })
})

describe('merge-mac-update', () => {
  const script = resolve(__dirname, '../../scripts/merge-mac-update.mjs')
  const yml = (version: string, arch: string) => `version: ${version}\nfiles:\n  - url: a-${arch}-mac.zip\n    sha512: ${arch}\n    size: 1\npath: a-${arch}-mac.zip\nsha512: ${arch}\nreleaseDate: x\n`

  it('lists both kinds of Mac', () => {
    writeFileSync(join(dir, 'a.yml'), yml('1.0.0', 'arm64'))
    writeFileSync(join(dir, 'b.yml'), yml('1.0.0', 'x64'))
    expect(spawnSync('node', [script, join(dir, 'out.yml'), join(dir, 'a.yml'), join(dir, 'b.yml')]).status).toBe(0)
    const merged = readFileSync(join(dir, 'out.yml'), 'utf8')
    expect(merged).toContain('a-arm64-mac.zip')
    expect(merged).toContain('a-x64-mac.zip')
    expect(merged.match(/^version:/gm)).toHaveLength(1)
  })

  it('refuses files from different versions', () => {
    writeFileSync(join(dir, 'a.yml'), yml('1.0.0', 'arm64'))
    writeFileSync(join(dir, 'b.yml'), yml('1.0.1', 'x64'))
    expect(spawnSync('node', [script, join(dir, 'out.yml'), join(dir, 'a.yml'), join(dir, 'b.yml')]).status).not.toBe(0)
  })
})
