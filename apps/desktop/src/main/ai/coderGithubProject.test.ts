import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isGithubRepoName, matchPalette, VPN_PALETTE_IDS } from '@scbrowser/shared'
import { CoderGithub, shownRemote } from './coderGithub'
import { hasCommits, linkRepo, pushBranch } from './coderSetup'

let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'coder-github-project-')))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim()
const store = () => {
  const values = new Map<string, unknown>()
  return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => void values.set(key, value) }
}
const github = () => new CoderGithub({ kv: store(), access: () => 'read', seal: async (text) => text, unseal: async (text) => text, cliToken: async () => null })

describe('how a project stands with GitHub', () => {
  it('tells apart no folder, no git, no remote, another host and GitHub', async () => {
    const plain = join(root, 'plain')
    await mkdir(plain)
    expect((await github().project(null)).project).toBe('no-folder')
    expect((await github().project(plain)).project).toBe('not-git')
    git(plain, 'init')
    expect((await github().project(plain)).project).toBe('no-remote')
    git(plain, 'remote', 'add', 'origin', 'https://me:secret@gitlab.com/me/plain.git')
    expect(await github().project(plain)).toMatchObject({ project: 'other-remote', remote: 'https://gitlab.com/me/plain.git' })
    git(plain, 'remote', 'set-url', 'origin', 'git@github.com:me/plain.git')
    expect(await github().project(plain)).toMatchObject({ project: 'linked', repo: 'me/plain', folder: plain })
    const status = await github().status(plain)
    expect(status).toMatchObject({ source: null, project: 'linked', repo: 'me/plain' })
  })

  it('never shows a password from a remote', () => {
    expect(shownRemote('https://user:ghp_secret@example.com/a/b.git')).toBe('https://example.com/a/b.git')
    expect(shownRemote('git@example.com:a/b.git')).toBe('git@example.com:a/b.git')
  })

  it('checks repository names as GitHub does', () => {
    expect(isGithubRepoName('my-project.v2_final')).toBe(true)
    expect(isGithubRepoName('has space')).toBe(false)
    expect(isGithubRepoName('..')).toBe(false)
    expect(isGithubRepoName('')).toBe(false)
  })
})

describe('linking a folder to GitHub', () => {
  it('starts git where there is none, adds origin, and pushes the current branch when asked', async () => {
    const project = join(root, 'project')
    const remotes = join(root, 'remotes')
    await mkdir(project)
    await mkdir(join(remotes, 'me'), { recursive: true })
    git(join(remotes, 'me'), 'init', '--bare', 'project.git')
    const base = `file://${remotes}`

    await linkRepo(project, 'me/project', base)
    expect(git(project, 'remote', 'get-url', 'origin')).toBe(`${base}/me/project.git`)
    expect(await hasCommits(project)).toBe(false)

    await writeFile(join(project, 'a.txt'), 'one\n')
    git(project, 'add', '.')
    git(project, 'commit', '-m', 'First')
    expect(await hasCommits(project)).toBe(true)
    const branch = await pushBranch(project, null, base)
    expect(git(join(remotes, 'me', 'project.git'), 'log', '--format=%s', branch)).toBe('First')
    expect(git(project, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe(`origin/${branch}`)
  })

  it('never replaces an origin that is already there', async () => {
    const project = join(root, 'project')
    await mkdir(project)
    git(project, 'init')
    git(project, 'remote', 'add', 'origin', 'https://example.com/elsewhere.git')
    await expect(linkRepo(project, 'me/project')).rejects.toThrow(/already has a remote called origin/)
    expect(git(project, 'remote', 'get-url', 'origin')).toBe('https://example.com/elsewhere.git')
    await expect(linkRepo(project, 'not a name')).rejects.toThrow(/isn’t a repository name/)
  })
})

describe('the palette once the VPN is removed', () => {
  it('leaves out the VPN’s commands and nothing else', () => {
    const all = matchPalette('').map(({ id }) => id)
    const without = matchPalette('', { hidden: VPN_PALETTE_IDS }).map(({ id }) => id)
    expect(all).toContain('vpn')
    expect(without).not.toContain('vpn')
    expect(all.filter((id) => id !== 'vpn')).toEqual(without)
  })
})
