import { spawn } from 'node:child_process'
import { commandEnv } from './coderTools'

/**
 * The person's own status line command, given the session as JSON on its input like Claude Code's
 * statusLine. Its first line, without colour codes, or null if it printed nothing within 3 s.
 */
export function runStatusLine(command: string, cwd: string, json: string): Promise<string | null> {
  return new Promise((done) => {
    const shell = process.platform === 'win32' ? { file: 'cmd.exe', args: ['/d', '/s', '/c', command] } : { file: '/bin/sh', args: ['-c', command] }
    let out = ''
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const line = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).map((one) => one.trim()).find(Boolean)
      done(line ? line.slice(0, 300) : null)
    }
    const child = spawn(shell.file, shell.args, { cwd, env: commandEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    const timer = setTimeout(() => {
      child.kill()
      finish()
    }, 3000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (out.length < 4000) out += chunk.toString('utf8')
    })
    child.on('error', finish)
    child.on('close', finish)
    child.stdin.on('error', () => undefined)
    child.stdin.end(json)
  })
}
