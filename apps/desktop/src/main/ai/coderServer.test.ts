import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLOUD_EVENT_MARK, type CoderCloudRun } from '@scbrowser/shared'
import { CoderServer, parseServer, quoted, sshArgs, type SshRunner } from './coderServer'
import type { CloudTask } from './coderCloud'

let root = ''
let home = ''
beforeEach(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'coder-server-')))
  root = join(base, 'project')
  home = join(base, 'home')
  await Promise.all([mkdir(root), mkdir(home)])
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root })
  git('init', '-q', '-b', 'main')
  await writeFile(join(root, 'a.txt'), 'one\n')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first')
  // Uncommitted work and a new file: both should reach the server.
  await writeFile(join(root, 'a.txt'), 'one, edited\n')
  await writeFile(join(root, 'new.txt'), 'new\n')
})
afterEach(() => rm(join(root, '..'), { recursive: true, force: true }))

/**
 * A stand-in for ssh that runs the remote command here, in a home folder of its own, the way sshd
 * hands it to the login shell. Its options and host are checked, never used.
 */
function localSsh(seen: string[][]): SshRunner {
  return (args, input, timeoutMs, output) =>
    new Promise((resolve, reject) => {
      seen.push(args)
      let at = 0
      while (args[at] === '-o' || args[at] === '-p') at += 2
      const command = args[at + 1]!
      const child = spawn('sh', ['-c', command], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => child.kill(), timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => (output ? output.write(chunk) : (stdout += chunk.toString())))
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timer)
        output?.end()
        resolve({ code: code ?? 1, stdout, stderr })
      })
      if (typeof input === 'string') child.stdin.end(input)
      else if (input) input.pipe(child.stdin)
      else child.stdin.end()
    })
}

/** A runner that does what the real one does at the end, without a model: a step, a commit, a result. */
const STUB_RUNNER = `import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log(${JSON.stringify(CLOUD_EVENT_MARK)} + JSON.stringify({ type: 'tool', id: '1', tool: 'write', summary: 'Write hello.txt' }))
writeFileSync('hello.txt', 'key ' + (process.env.SCTERRA_AI_KEY ? 'arrived' : 'missing') + '\\n')
execFileSync('git', ['add', '-A'])
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', spec.title])
writeFileSync('../result.json', JSON.stringify({ ok: true, summary: 'Wrote hello.txt', pushed: false }))
`

const spec = (id: string): CloudTask => ({ id, task: 'Say hello', repo: 'project', base: 'main', branch: `scterra/say-hello-${id}`, trigger: '', pr: false, model: { protocol: 'openai', baseUrl: 'https://example.com/v1', model: 'm', needsKey: true, firstParty: false }, effort: null, title: 'Say hello', where: 'server', pushTo: null })

const run = (id: string): CoderCloudRun => ({ id, where: 'server', host: 'me@box', repo: 'project', base: 'main', trigger: '', branch: `scterra/say-hello-${id}`, task: 'Say hello', pr: false, state: 'working', runId: null, runUrl: null, prUrl: null, summary: null, startedAt: 0, endedAt: null, error: null, warning: null })

describe('runs on the person’s own server', () => {
  it('reads only addresses ssh can’t take for options', () => {
    expect(parseServer('me@box.example.com')).toEqual({ host: 'me@box.example.com', port: null })
    expect(parseServer('box:2222')).toEqual({ host: 'box', port: 2222 })
    expect(parseServer('homelab')).toEqual({ host: 'homelab', port: null })
    expect(parseServer('-oProxyCommand=touch /tmp/x')).toBeNull()
    expect(parseServer('me@-oProxyCommand')).toBeNull()
    expect(parseServer('me@box; rm -rf ~')).toBeNull()
    expect(parseServer('box:99999')).toBeNull()
    expect(parseServer('')).toBeNull()
    // Never a password prompt, and new hosts are accepted once rather than asked about.
    expect(sshArgs({ host: 'box', port: 2222 })).toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-p', '2222', 'box'])
    expect(quoted(`it's`)).toBe(`'it'\\''s'`)
  })

  it('checks the server for git and Node', async () => {
    const server = new CoderServer({ runner: async () => STUB_RUNNER, ssh: localSsh([]) })
    const check = await server.check('me@box')
    expect(check.ok).toBe(true)
    expect(check.node).toMatch(/^v\d+/)
    expect(check.message).toMatch(/^Ready: me@box has Node/)
    expect((await server.check('-bad')).ok).toBe(false)
  })

  it('sends the folder as it is, runs there, and brings the branch back', async () => {
    const seen: string[][] = []
    const server = new CoderServer({ runner: async () => STUB_RUNNER, ssh: localSsh(seen) })
    const target = { host: 'me@box', port: null }
    const started = await server.start(target, root, spec('ab12cd34'), JSON.stringify({ apiKey: 'sk-secret', headers: {} }))
    expect(started.warning).toMatch(/uncommitted changes too/)
    // The key went in through the script, never on ssh's command line.
    expect(seen.flat().join(' ')).not.toContain('sk-secret')
    // The person's own index and files are untouched.
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toContain('new.txt')
    expect(execFileSync('git', ['for-each-ref', 'refs/scterra'], { cwd: root, encoding: 'utf8' })).toBe('')

    let status = await server.status(target, run('ab12cd34'))
    for (let tries = 0; status.state === 'working' && tries < 50; tries++) {
      await new Promise((done) => setTimeout(done, 100))
      status = await server.status(target, run('ab12cd34'))
    }
    expect(status).toMatchObject({ state: 'done', summary: 'Wrote hello.txt', pushed: false })
    expect(status.live).toEqual(['Write hello.txt'])
    expect((await server.events(target, run('ab12cd34'), 's1')).map((event) => event.type)).toEqual(['tool'])
    // The key file never touched the server's disk.
    expect(await readFile(join(home, '.scterra/runs/ab12cd34/task.json'), 'utf8')).not.toContain('sk-secret')

    const said = await server.fetch(target, run('ab12cd34'), root)
    expect(said).toMatch(/^Fetched scterra\/say-hello-ab12cd34 from me@box/)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'scterra/say-hello-ab12cd34'], { cwd: root, encoding: 'utf8' })
    expect(files.trim()).toBe('hello.txt')
    expect(execFileSync('git', ['show', 'scterra/say-hello-ab12cd34:hello.txt'], { cwd: root, encoding: 'utf8' })).toBe('key arrived\n')
    // The uncommitted edit and the new file came along, as the commit under the run's.
    expect(execFileSync('git', ['show', 'scterra/say-hello-ab12cd34~1:a.txt'], { cwd: root, encoding: 'utf8' })).toBe('one, edited\n')
    expect(execFileSync('git', ['show', 'scterra/say-hello-ab12cd34~1:new.txt'], { cwd: root, encoding: 'utf8' })).toBe('new\n')
  })

  it('says a run that died stopped, and why', async () => {
    const dir = join(home, '.scterra/runs/dead0001')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'pid'), '999999\n')
    await writeFile(join(dir, 'events.log'), `${CLOUD_EVENT_MARK}${JSON.stringify({ type: 'error', message: 'scTerra AI stopped with an error: The AI service had a problem.' })}\n`)
    const server = new CoderServer({ runner: async () => STUB_RUNNER, ssh: localSsh([]) })
    const status = await server.status({ host: 'box', port: null }, run('dead0001'))
    expect(status.state).toBe('failed')
    expect(status.error).toBe('It stopped: scTerra AI stopped with an error: The AI service had a problem.')
    expect((await server.status({ host: 'box', port: null }, run('gone0001'))).error).toMatch(/is gone/)
  })

  it('turns ssh’s refusals into sentences', async () => {
    const refusing: SshRunner = async () => ({ code: 255, stdout: '', stderr: 'me@box: Permission denied (publickey).\n' })
    const server = new CoderServer({ runner: async () => STUB_RUNNER, ssh: refusing })
    expect((await server.check('me@box')).message).toMatch(/didn’t accept this computer’s SSH key/)
  })
})
