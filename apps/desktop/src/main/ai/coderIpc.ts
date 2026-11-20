import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dialog, Notification, shell, type BaseWindow, type WebContents } from 'electron'
import {
  CODE_CHAT_PREFIX,
  CODER_MAX_IMAGE_CHARS,
  CODER_MAX_IMAGES,
  CODER_MAX_MENTIONS,
  CODER_MAX_OPTIONS,
  CODER_MAX_QUESTIONS,
  CODER_MAX_TASK_CHARS,
  cleanTodo,
  isCoderEffort,
  isMcpServerName,
  type CoderAutomations,
  type CoderEvent,
  type CoderHooksView,
  type CoderRunOptions,
  type CoderWorktree,
  type InternalCommands,
  type McpServerConfig
} from '@scbrowser/shared'
import type { KeyValueRepo } from '../storage/kv'
import type { ChatsRepo } from '../storage/chats'
import type { SettingsStore } from '../settings'
import type { TabManager } from '../tabs/TabManager'
import { rememberNote, transcriptOf } from './coder'
import type { CoderBrowserHost } from './coder'
import { changeSummary, commit, COMMIT_MESSAGE_PROMPT, createWorktree, mergeWorktree, removeWorktree } from './coderGit'
import type { CoderMcp } from './coderMcp'
import type { CoderCloud } from './coderCloud'
import { githubClientId, type CoderGithub } from './coderGithub'
import { installAutomations } from './coderAutomations'
import { cloneRepo, deviceStart, deviceWait, projectSetup, type DeviceCode } from './coderSetup'
import { loadDefs, loadHooks, loadSkills, projectSettings, detectDiagnostics } from './coderProject'
import { globFiles } from './coderTools'
import type { CoderTrust } from './coderTrust'
import type { AiService } from './service'

type CoderChannel = Extract<keyof InternalCommands, `coder:${string}`>
export type CoderHandlers = { [C in CoderChannel]: (...args: unknown[]) => ReturnType<InternalCommands[C]> | Promise<Awaited<ReturnType<InternalCommands[C]>>> }

const WORKTREES_KEY = 'coder:worktrees'
/** What was installed on each repository, by owner/name. */
const AUTOMATIONS_KEY = 'coder:automations'
const MAX_CODE_CHAT_CHARS = 6_000_000
/** Events kept per session for showing a run that went on while another chat was on screen. */
const MAX_LOG = 4000

const text = (value: unknown, max = 8192): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Expected a string')
  return value
}

export interface CoderIpcServices {
  window: BaseWindow
  tabs: TabManager
  settings: SettingsStore
  chats: ChatsRepo
  kv: KeyValueRepo
  ai: AiService
  trust: CoderTrust
  mcp: CoderMcp | undefined
  browser: CoderBrowserHost
  github: CoderGithub
  cloud: CoderCloud
  /** Terra Code's own folder: checkpoints, worktrees, and the person's commands, agents and skills. */
  home: string
  /** The page that called, which must be sc://assistant. */
  coderOnly: () => WebContents
  /** Back to the window and the tab Terra Code is in, for a notification's click. */
  focus: (contents: WebContents) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** What the page sent with a task, checked piece by piece. */
function runOptions(value: unknown): CoderRunOptions {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new Error('Invalid options')
  const options: CoderRunOptions = {}
  if (value.turnId !== undefined) options.turnId = text(value.turnId, 64)
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > CODER_MAX_IMAGES) throw new Error('Too many pictures')
    options.images = value.images.map((image) => {
      const url = text(image, CODER_MAX_IMAGE_CHARS)
      if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(url)) throw new Error('Not a picture')
      return url
    })
  }
  if (value.mentions !== undefined) {
    if (!Array.isArray(value.mentions) || value.mentions.length > CODER_MAX_MENTIONS) throw new Error('Too many mentions')
    options.mentions = value.mentions.map((mention) => {
      if (isRecord(mention) && mention.kind === 'file') return { kind: 'file', path: text(mention.path, 1024) }
      if (isRecord(mention) && mention.kind === 'tab' && Number.isInteger(mention.tabId)) return { kind: 'tab', tabId: mention.tabId as number }
      throw new Error('Invalid mention')
    })
  }
  if (value.model !== undefined) {
    if (value.model === null) options.model = null
    else if (isRecord(value.model)) options.model = { providerId: text(value.model.providerId, 64), model: text(value.model.model, 300) }
    else throw new Error('Invalid model')
  }
  if (value.effort !== undefined) {
    if (value.effort !== null && !isCoderEffort(value.effort)) throw new Error('Invalid effort')
    options.effort = value.effort
  }
  if (value.mode !== undefined) {
    if (!['plan', 'ask', 'edits', 'review'].includes(value.mode as string)) throw new Error('Invalid mode')
    options.mode = value.mode as CoderRunOptions['mode']
  }
  return options
}

function mcpInput(value: unknown): McpServerConfig {
  if (!isRecord(value) || typeof value.name !== 'string' || !isMcpServerName(value.name)) throw new Error('Names are letters, numbers, - and _, up to 40.')
  const strings = (record: unknown) => (isRecord(record) ? Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => /^[A-Za-z_][A-Za-z0-9_-]{0,100}$/.test(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 4000).slice(0, 40)) : {})
  const enabled = value.enabled !== false
  if (value.type === 'http') return { name: value.name, type: 'http', url: text(value.url, 2048), headers: strings(value.headers), enabled }
  const args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === 'string' && arg.length <= 1000).slice(0, 60) : []
  return { name: value.name, type: 'stdio', command: text(value.command, 1000), args, env: strings(value.env), enabled }
}

/** The page's words for an event, for a notification while scTerra is in the background. */
function notice(event: CoderEvent): string | null {
  if (event.type === 'approval') return `Waiting for you: ${event.summary}`
  if (event.type === 'done' && event.reason === 'finished') return 'Finished.'
  if (event.type === 'done' && event.reason === 'step-limit') return 'Stopped at the step limit.'
  if (event.type === 'error') return event.message
  return null
}

/** Terra Code's channels, for sc://assistant only. */
export function coderHandlers(services: CoderIpcServices): CoderHandlers {
  const { window, tabs, settings, chats, kv, ai, trust, mcp, browser, github, cloud, home, coderOnly, focus } = services
  const logs = new Map<string, { turnId: string | null; task: string; events: CoderEvent[] }>()
  let lastSender: WebContents | null = null
  let fileCache: { folder: string; at: number; files: string[] } | null = null
  /** A device sign-in under way: its code, and how to stop waiting for it. */
  let device: { code: DeviceCode; stop: AbortController } | null = null

  const worktrees = () => (kv.get(WORKTREES_KEY) as Record<string, CoderWorktree & { project: string }> | undefined) ?? {}
  const worktreeOf = (id: string) => worktrees()[id] ?? null
  const setWorktree = (id: string, worktree: (CoderWorktree & { project: string }) | null) => {
    const all = worktrees()
    if (worktree) all[id] = worktree
    else delete all[id]
    kv.set(WORKTREES_KEY, all)
  }
  /** A session in a separate copy works there; any other in the chosen folder. */
  const folderFor = (id: string) => worktreeOf(id)?.path ?? settings.get().coderFolder
  const projectFolder = () => {
    const { coderFolder } = settings.get()
    if (!coderFolder) throw new Error('Choose a project folder first.')
    return coderFolder
  }

  /** Every Terra Code page in the window hears about every session, and picks out its own. */
  const broadcast = (event: CoderEvent) => {
    const log = logs.get(event.sessionId)
    if (log && event.type !== 'stream') {
      const last = log.events.at(-1)
      if (event.type === 'output' && last?.type === 'output' && last.id === event.id) log.events[log.events.length - 1] = { ...last, text: (last.text + event.text).slice(-40_000) }
      else log.events.push(event)
      if (log.events.length > MAX_LOG) log.events.splice(0, log.events.length - MAX_LOG)
    }
    for (const contents of tabs.allContents()) {
      if (!contents.isDestroyed() && /^sc:\/\/assistant(\/|$|\?|#)/.test(contents.getURL())) contents.send('coder:event', event)
    }
    const body = notice(event)
    if (body && settings.get().coderNotify && !window.isFocused() && Notification.isSupported()) {
      const shown = new Notification({ title: 'Terra Code', body: body.slice(0, 200), silent: event.type !== 'approval' })
      shown.on('click', () => lastSender && !lastSender.isDestroyed() && focus(lastSender))
      shown.show()
    }
  }

  const changedPaths = async (id: string) => (await ai.coder.changes(id)).map((change) => change.path)

  return {
    'coder:status': () => {
      coderOnly()
      return ai.coderStatus(settings.get().coderFolder)
    },
    'coder:pick-folder': async () => {
      coderOnly()
      const result = await dialog.showOpenDialog(window as Electron.BrowserWindow, { title: 'Choose a project folder', properties: ['openDirectory', 'createDirectory'] })
      const folder = result.canceled ? undefined : result.filePaths[0]
      if (!folder) return null
      settings.set({ coderFolder: folder })
      return folder
    },
    'coder:open-folder': () => {
      coderOnly()
      const { coderFolder } = settings.get()
      if (coderFolder) void shell.openPath(coderFolder)
    },
    'coder:run': (sessionId, task, options) => {
      const sender = coderOnly()
      lastSender = sender
      const id = text(sessionId, 64)
      const folder = folderFor(id)
      if (!folder) throw new Error('Choose a project folder first.')
      const checked = runOptions(options)
      const said = text(task, CODER_MAX_TASK_CHARS)
      logs.set(id, { turnId: checked.turnId ?? null, task: said, events: [] })
      // A run keeps going while another chat is on screen; its page catches up from the log when it's back.
      void ai.coder.run(id, folder, said, settings.get().coderMode, broadcast, savedCodeMessages(chats, id), checked)
    },
    'coder:steer': (sessionId, message) => {
      coderOnly()
      return ai.coder.steer(text(sessionId, 64), text(message, CODER_MAX_TASK_CHARS))
    },
    'coder:save': (sessionId, title, data) => {
      coderOnly()
      const { saveChats, coderFolder } = settings.get()
      if (saveChats && coderFolder) chats.saveCode(text(sessionId, 64), text(title, 20_000), coderFolder, text(data, MAX_CODE_CHAT_CHARS))
    },
    'coder:open': (sessionId) => {
      coderOnly()
      const saved = chats.getCode(text(sessionId, 64))
      if (saved && saved.folder !== settings.get().coderFolder) settings.set({ coderFolder: saved.folder })
      return saved
    },
    'coder:answer': (id, answer) => {
      coderOnly()
      if (answer !== 'allow' && answer !== 'always' && answer !== 'deny') throw new Error('Invalid answer')
      ai.coder.answer(text(id, 64), answer)
    },
    'coder:answer-question': (id, answers) => {
      coderOnly()
      if (answers === null) return ai.coder.answerQuestion(text(id, 64), null)
      if (!Array.isArray(answers) || answers.length > CODER_MAX_QUESTIONS) throw new Error('Invalid answers')
      const checked = answers.map((picked) => {
        if (!Array.isArray(picked) || picked.length > CODER_MAX_OPTIONS + 1) throw new Error('Invalid answers')
        return picked.map((one) => text(one, 2000).trim()).filter(Boolean)
      })
      ai.coder.answerQuestion(text(id, 64), checked)
    },
    'coder:todo': async (sessionId, items) => {
      coderOnly()
      const id = text(sessionId, 64)
      const checked = cleanTodo(items)
      if (!checked) throw new Error('Invalid checklist')
      await ai.coder.setTodo(id, folderFor(id) || projectFolder(), checked, broadcast)
    },
    'coder:github-status': () => {
      coderOnly()
      return github.status(settings.get().coderFolder || null)
    },
    'coder:github-use-cli': async () => {
      coderOnly()
      const status = await github.useCli(settings.get().coderFolder || null)
      // Connecting is the person saying yes to looking; acting stays their separate choice.
      if (settings.get().coderGithub === 'off') settings.set({ coderGithub: 'read' })
      return status
    },
    'coder:github-save-token': async (token) => {
      coderOnly()
      const status = await github.saveToken(text(token, 400), settings.get().coderFolder || null)
      if (settings.get().coderGithub === 'off') settings.set({ coderGithub: 'read' })
      return status
    },
    'coder:github-disconnect': () => {
      coderOnly()
      github.disconnect()
      settings.set({ coderGithub: 'off' })
      return github.status(settings.get().coderFolder || null)
    },
    'coder:github-device-start': async () => {
      coderOnly()
      const clientId = githubClientId()
      if (!clientId) throw new Error('Signing in with GitHub isn’t set up in this build.')
      device?.stop.abort()
      const code = await deviceStart(clientId)
      device = { code, stop: new AbortController() }
      void tabs.create(code.verification_uri, { afterId: tabs.active?.id })
      return { code: code.user_code, url: code.verification_uri }
    },
    'coder:github-device-wait': async () => {
      coderOnly()
      const pending = device
      if (!pending) throw new Error('Start signing in first.')
      const token = await deviceWait(githubClientId(), pending.code, pending.stop.signal)
      if (device === pending) device = null
      const status = await github.saveToken(token, settings.get().coderFolder || null)
      if (settings.get().coderGithub === 'off') settings.set({ coderGithub: 'read' })
      return status
    },
    'coder:github-repos': async (query) => {
      coderOnly()
      const words = text(query, 200).trim().toLowerCase()
      const repos = await github.call<{ full_name: string; description: string | null; private: boolean; pushed_at: string }[]>('GET', '/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member')
      return repos
        .filter((repo) => !words || repo.full_name.toLowerCase().includes(words) || (repo.description ?? '').toLowerCase().includes(words))
        .slice(0, 50)
        .map((repo) => ({ fullName: repo.full_name, description: repo.description ?? '', private: repo.private, pushedAt: repo.pushed_at }))
    },
    'coder:clone': async (fullName) => {
      coderOnly()
      const name = text(fullName, 200)
      if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error('That isn’t a repository name.')
      const picked = await dialog.showOpenDialog(window as Electron.BrowserWindow, { title: `Where should ${name.split('/')[1]} go?`, buttonLabel: 'Clone here', properties: ['openDirectory', 'createDirectory'] })
      const parent = picked.canceled ? undefined : picked.filePaths[0]
      if (!parent) return null
      const into = join(parent, name.split('/')[1]!)
      await cloneRepo(name, into, await github.token())
      settings.set({ coderFolder: into })
      return into
    },
    'coder:project-setup': async () => {
      coderOnly()
      const folder = settings.get().coderFolder
      if (!folder) return null
      return projectSetup(folder, trust.rules(folder).allow)
    },
    'coder:cloud-start': async (sessionId, task, options) => {
      coderOnly()
      const id = text(sessionId, 64)
      if (!isRecord(options) || typeof options.pr !== 'boolean') throw new Error('Invalid options')
      const checked = runOptions({ model: options.model, effort: options.effort })
      return cloud.start(id, folderFor(id) || projectFolder(), text(task, CODER_MAX_TASK_CHARS), { pr: options.pr, effort: checked.effort ?? null, model: checked.model ?? null })
    },
    'coder:cloud-runs': (sessionId, check) => {
      coderOnly()
      const id = text(sessionId, 64)
      return check === true ? cloud.check(id) : cloud.runs(id)
    },
    'coder:cloud-cancel': (sessionId, runId) => {
      coderOnly()
      return cloud.cancel(text(sessionId, 64), text(runId, 32))
    },
    'coder:cloud-fetch': (sessionId, runId) => {
      coderOnly()
      const id = text(sessionId, 64)
      return cloud.fetchBranch(id, text(runId, 32), folderFor(id) || projectFolder())
    },
    'coder:cloud-pr': async (sessionId, runId) => {
      coderOnly()
      const url = await cloud.pr(text(sessionId, 64), text(runId, 32))
      void tabs.create(url, { afterId: tabs.active?.id })
      return url
    },
    'coder:automations': async () => {
      coderOnly()
      const folder = settings.get().coderFolder
      const repo = folder ? await github.repo(folder) : null
      const saved = repo ? ((kv.get(AUTOMATIONS_KEY) as Record<string, { automations: CoderAutomations; prUrl: string }> | undefined)?.[repo] ?? null) : null
      return { repo, saved: saved?.automations ?? null, prUrl: saved?.prUrl ?? null }
    },
    'coder:automations-install': async (value) => {
      coderOnly()
      if (!isRecord(value) || typeof value.comments !== 'boolean' || !Array.isArray(value.schedules) || value.schedules.length > 10) throw new Error('Invalid choice')
      const schedules = value.schedules.map((one) => {
        if (!isRecord(one) || typeof one.cron !== 'string' || !/^[\d*,\- /]{9,40}$/.test(one.cron)) throw new Error('Invalid timetable')
        return { cron: one.cron, task: text(one.task, 4000).trim(), pr: one.pr !== false, label: text(one.label, 100) }
      })
      if (schedules.some((one) => !one.task)) throw new Error('Every scheduled task needs words.')
      if (github.access() !== 'write') throw new Error('Terra Code needs to look and act on GitHub to install this. Choose Look and act above.')
      const folder = projectFolder()
      const repo = await github.repo(folder)
      if (!repo) throw new Error('This project isn’t on GitHub: its git remote “origin” doesn’t point there.')
      const automations: CoderAutomations = { comments: value.comments, schedules }
      const prUrl = await installAutomations(github, repo, automations, await ai.cloudModel())
      kv.set(AUTOMATIONS_KEY, { ...((kv.get(AUTOMATIONS_KEY) as object | undefined) ?? {}), [repo]: { automations, prUrl } })
      void tabs.create(prUrl, { afterId: tabs.active?.id })
      return prUrl
    },
    'coder:note': async (sessionId, note) => {
      coderOnly()
      const id = text(sessionId, 64)
      await ai.coder.addNote(id, folderFor(id) || projectFolder(), text(note, 40_000))
    },
    'coder:cloud-events': (sessionId, runId) => {
      coderOnly()
      return cloud.events(text(sessionId, 64), text(runId, 32))
    },
    'coder:stop': (sessionId) => {
      coderOnly()
      ai.coder.stop(text(sessionId, 64))
    },
    'coder:reset': (sessionId) => {
      coderOnly()
      ai.coder.reset(text(sessionId, 64))
    },
    'coder:changes': (sessionId) => {
      coderOnly()
      return ai.coder.changes(text(sessionId, 64))
    },
    'coder:diff': (sessionId, path) => {
      coderOnly()
      return ai.coder.diff(text(sessionId, 64), text(path, 1024))
    },
    'coder:undo': (sessionId, path) => {
      coderOnly()
      return ai.coder.undo(text(sessionId, 64), path === undefined ? undefined : text(path, 1024))
    },
    'coder:review': (sessionId, path) => {
      coderOnly()
      return ai.coder.review(text(sessionId, 64), text(path, 1024))
    },
    'coder:decide': (sessionId, path, hunk, decision) => {
      coderOnly()
      if (decision !== 'accept' && decision !== 'reject') throw new Error('Invalid decision')
      return ai.coder.decide(text(sessionId, 64), text(path, 1024), hunk === null ? null : text(hunk, 64), decision)
    },
    'coder:stop-tool': (sessionId, toolId) => {
      coderOnly()
      ai.coder.stopTool(text(sessionId, 64), text(toolId, 64))
    },
    'coder:rewind': (sessionId, turnId, what) => {
      coderOnly()
      if (what !== undefined && what !== 'both' && what !== 'code' && what !== 'conversation') throw new Error('Invalid choice')
      return ai.coder.rewind(text(sessionId, 64), text(turnId, 64), what ?? 'both')
    },
    'coder:undo-step': (sessionId, toolId, redo) => {
      coderOnly()
      if (typeof redo !== 'boolean') throw new Error('Invalid choice')
      return ai.coder.undoStep(text(sessionId, 64), text(toolId, 64), redo)
    },
    'coder:activity': () => {
      coderOnly()
      return { running: ai.coder.runningSessions(), waiting: ai.coder.waitingSessions() }
    },
    'coder:compact': (sessionId) => {
      coderOnly()
      return ai.coder.compactNow(text(sessionId, 64), broadcast)
    },
    'coder:fork': async (sessionId) => {
      coderOnly()
      const from = text(sessionId, 64)
      const to = `${CODE_CHAT_PREFIX}${randomUUID()}`
      if (!(await ai.coder.fork(from, to))) return null
      const saved = chats.getCode(from)
      if (saved && settings.get().saveChats) {
        let title = 'Terra Code'
        try {
          const first = ((JSON.parse(saved.data) as { items?: { kind?: string; text?: string }[] }).items ?? []).find((item) => item.kind === 'task')
          if (first?.text) title = first.text
        } catch {
          // The title is only for the list.
        }
        chats.saveCode(to, `${title.slice(0, 200)} (copy)`, saved.folder, saved.data)
      }
      const worktree = worktreeOf(from)
      if (worktree) setWorktree(to, worktree)
      return to
    },
    'coder:export': async (title, markdown) => {
      coderOnly()
      const name = text(title, 200).replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 80) || 'Terra Code'
      const result = await dialog.showSaveDialog(window as Electron.BrowserWindow, { title: 'Save this session', defaultPath: `${name}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, text(markdown, MAX_CODE_CHAT_CHARS), 'utf8')
      return true
    },
    'coder:models': () => {
      coderOnly()
      return ai.coderModels()
    },
    'coder:setup': async () => {
      coderOnly()
      const folder = settings.get().coderFolder || null
      const [commands, agents, skills, hooks, servers, project] = await Promise.all([
        loadDefs(folder, home, 'commands'),
        loadDefs(folder, home, 'agents'),
        loadSkills(folder, home),
        loadHooks(folder, home),
        mcp?.views(folder) ?? Promise.resolve([]),
        folder ? projectSettings(folder) : Promise.resolve({ deny: [], diagnostics: null })
      ])
      const views: CoderHooksView[] = hooks.map((set) => ({ source: set.source, trusted: set.source === 'global' || (!!folder && trust.trusted(folder, 'hooks') === set.hash), hooks: set.hooks.map(({ event, command }) => ({ event, command })) }))
      const short = (list: { name: string; description: string; source: 'project' | 'global' }[]) => list.map(({ name, description, source }) => ({ name, description, source }))
      return {
        folder,
        home,
        rules: folder ? trust.rules(folder) : { allow: [], deny: [] },
        projectDeny: project.deny,
        commands: short(commands),
        agents: short(agents),
        skills: short(skills),
        mcp: servers,
        hooks: views,
        diagnostics: project.diagnostics ?? (folder ? await detectDiagnostics(folder) : null)
      }
    },
    'coder:set-rules': (rules) => {
      coderOnly()
      if (!isRecord(rules)) throw new Error('Invalid rules')
      const list = (value: unknown) => (Array.isArray(value) ? value.map((rule) => text(rule, 500)).slice(0, 200) : [])
      trust.setRules(projectFolder(), { allow: list(rules.allow), deny: list(rules.deny) })
    },
    'coder:remember': (note) => {
      coderOnly()
      const said = text(note, 2000).trim()
      if (!said) throw new Error('Write the note after /remember.')
      return rememberNote(projectFolder(), said)
    },
    'coder:files': async (query) => {
      coderOnly()
      const folder = projectFolder()
      const wanted = text(query, 300).toLowerCase()
      if (!fileCache || fileCache.folder !== folder || Date.now() - fileCache.at > 10_000) {
        const listed = await globFiles(folder, '**/*').catch(() => '')
        fileCache = { folder, at: Date.now(), files: listed.split('\n').filter((line) => line && !line.startsWith('…') && line !== 'No files match.') }
      }
      // Names that start with what's typed first, then paths that hold it, shortest first.
      const score = (path: string) => {
        const name = path.split('/').at(-1)!.toLowerCase()
        return name.startsWith(wanted) ? 0 : name.includes(wanted) ? 1 : path.toLowerCase().includes(wanted) ? 2 : 3
      }
      return fileCache.files.filter((path) => score(path) < 3).sort((a, b) => score(a) - score(b) || a.length - b.length).slice(0, 20)
    },
    'coder:tabs': () => {
      coderOnly()
      return browser.tabs()
    },
    'coder:job-stop': (sessionId, jobId) => {
      coderOnly()
      if (!Number.isInteger(jobId)) throw new Error('Invalid job')
      ai.coder.jobs.kill(text(sessionId, 64), jobId as number)
    },
    'coder:running': () => {
      coderOnly()
      return ai.coder.runningSessions()
    },
    'coder:replay': (sessionId) => {
      coderOnly()
      const id = text(sessionId, 64)
      const log = logs.get(id)
      return log ? { ...log, events: [...log.events], running: ai.coder.runningSessions().includes(id) } : null
    },
    'coder:mcp-save': async (server) => {
      coderOnly()
      if (!mcp) throw new Error('MCP servers aren’t available in this window.')
      await mcp.save(mcpInput(server))
    },
    'coder:mcp-remove': async (name) => {
      coderOnly()
      await mcp?.remove(text(name, 40))
    },
    'coder:mcp-trust': async (name, trusted) => {
      coderOnly()
      if (typeof trusted !== 'boolean') throw new Error('Invalid choice')
      await mcp?.trustProject(projectFolder(), text(name, 40), trusted)
    },
    'coder:mcp-restart': async (name) => {
      coderOnly()
      await mcp?.restart(settings.get().coderFolder || null, text(name, 40))
    },
    'coder:mcp-signin': async (name) => {
      coderOnly()
      if (!mcp) throw new Error('MCP servers aren’t available in this window.')
      await mcp.signIn(settings.get().coderFolder || null, text(name, 40))
    },
    'coder:mcp-signout': async (name) => {
      coderOnly()
      await mcp?.signOut(settings.get().coderFolder || null, text(name, 40))
    },
    'coder:hooks-trust': async (trusted) => {
      coderOnly()
      if (typeof trusted !== 'boolean') throw new Error('Invalid choice')
      const folder = projectFolder()
      const set = (await loadHooks(folder, home)).find((hooks) => hooks.source === 'project')
      trust.trust(folder, 'hooks', trusted && set ? set.hash : null)
    },
    'coder:worktree': async (sessionId) => {
      coderOnly()
      const id = text(sessionId, 64)
      const existing = worktreeOf(id)
      if (existing) return existing
      const project = projectFolder()
      const worktree = await createWorktree(project, home, id)
      setWorktree(id, { ...worktree, project })
      return worktree
    },
    'coder:worktree-info': (sessionId) => {
      coderOnly()
      const found = worktreeOf(text(sessionId, 64))
      return found && { path: found.path, branch: found.branch, base: found.base }
    },
    'coder:worktree-merge': async (sessionId) => {
      coderOnly()
      const found = worktreeOf(text(sessionId, 64))
      if (!found) throw new Error('This session isn’t in a separate copy.')
      return mergeWorktree(found.project, found)
    },
    'coder:worktree-remove': async (sessionId) => {
      coderOnly()
      const id = text(sessionId, 64)
      const found = worktreeOf(id)
      if (!found) return
      if (ai.coder.runningSessions().includes(id)) throw new Error('Stop Terra Code before removing its copy.')
      await removeWorktree(found.project, found)
      setWorktree(id, null)
      ai.coder.reset(id)
    },
    'coder:commit-message': async (sessionId) => {
      coderOnly()
      const id = text(sessionId, 64)
      const paths = await changedPaths(id)
      const summary = await changeSummary(folderFor(id), paths.length ? paths : null)
      const written = await ai.complete(COMMIT_MESSAGE_PROMPT, summary)
      return written.replace(/^```\w*\n?|```$/g, '').replace(/^["']|["']$/g, '').trim()
    },
    'coder:commit': async (sessionId, message, branch, all, force) => {
      coderOnly()
      const id = text(sessionId, 64)
      if (ai.coder.runningSessions().includes(id)) throw new Error('Stop Terra Code before committing.')
      const paths = all === true ? null : await changedPaths(id)
      if (paths && paths.length === 0) throw new Error('This session hasn’t changed anything to commit.')
      const done = await commit(folderFor(id), text(message, 10_000), paths, branch === null ? null : text(branch, 100).trim() || null, force === true)
      await ai.coder.keepAll(id)
      return done
    },
    'coder:pending': () => {
      coderOnly()
      return ai.takePendingCode()
    }
  }
}

/** Picks a saved Terra Code chat back up after a restart, from what its screen showed. */
function savedCodeMessages(chats: ChatsRepo, id: string) {
  const saved = chats.getCode(id)
  if (!saved) return undefined
  try {
    return transcriptOf((JSON.parse(saved.data) as { items?: unknown }).items)
  } catch {
    return undefined
  }
}
