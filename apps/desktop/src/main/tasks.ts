import { app, webContents } from 'electron'
import type { BackgroundTask, CoderCloudRun, TaskList, TaskRow } from '@scbrowser/shared'
import type { BrowserCore } from './browserCore'

const SYSTEM_NAMES: Record<string, string> = { Browser: 'scTerra', GPU: 'Graphics', Utility: 'Helper', Zygote: 'Helper', Sandbox: 'Helper' }
const isEndable = (url: string) => /^(https?|file):/i.test(url)

/** Which tabs run in which process. Several from one site can share. */
function tabsByProcess(core: BrowserCore): Map<number, { title: string; url: string }[]> {
  const found = new Map<number, { title: string; url: string }[]>()
  for (const { tabs } of core.windows) {
    for (const { contents, title, url } of tabs.taskInfo()) {
      const pid = contents.getOSProcessId()
      found.set(pid, [...(found.get(pid) ?? []), { title: title || url, url }])
    }
  }
  return found
}

/** The browser's own views by what they draw: the bars and sidebars, or the popups and menus over the page. */
const BROWSER_PARTS = ['Browser interface', 'Popups and menus']
const nameOf = (url: string, title: string) =>
  /^(chrome-extension|devtools):/.test(url) ? title || 'Extension' : /\/overlay\.html($|[?#])/.test(url) ? BROWSER_PARTS[1]! : BROWSER_PARTS[0]!

export function taskList(core: BrowserCore): TaskList {
  const byProcess = tabsByProcess(core)
  const others = new Map(
    webContents
      .getAllWebContents()
      .filter((contents) => !contents.isDestroyed())
      .map((contents) => [contents.getOSProcessId(), nameOf(contents.getURL(), contents.getTitle())] as const)
  )
  const rows = app.getAppMetrics().map((metric): TaskRow => {
    const tabs = byProcess.get(metric.pid)
    const memoryKb = metric.memory.workingSetSize
    const cpu = metric.cpu.percentCPUUsage
    if (tabs) return { pid: metric.pid, kind: 'Tab', name: tabs.map((tab) => tab.title).join(', '), memoryKb, cpu, canEnd: tabs.every((tab) => isEndable(tab.url)) }
    const other = others.get(metric.pid)
    if (other) return { pid: metric.pid, kind: BROWSER_PARTS.includes(other) ? 'Browser' : 'Extension', name: other, memoryKb, cpu, canEnd: false }
    return { pid: metric.pid, kind: 'System', name: metric.name || metric.serviceName || SYSTEM_NAMES[metric.type] || metric.type, memoryKb, cpu, canEnd: false }
  })
  return { rows: rows.toSorted((a, b) => b.memoryKb - a.memoryKb), sleeping: core.windows.reduce((sum, { tabs }) => sum + tabs.sleepingCount(), 0), background: backgroundTasks(core) }
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** Everything working away from the screen, in one list, like Claude Code's tasks pane. */
export function backgroundTasks(core: BrowserCore): BackgroundTask[] {
  const found: BackgroundTask[] = []
  const briefs = core.briefs?.state()
  for (const id of briefs?.running ?? []) {
    const schedule = briefs!.schedules.find((one) => one.id === id)
    found.push({ kind: 'brief', name: schedule?.title ?? 'A brief', detail: 'Being written now', page: 'sc://briefs/' })
  }
  let working = 0
  let waiting = 0
  for (const handle of core.windows) {
    const busy = handle.coderBusy?.()
    working += busy?.working ?? 0
    waiting += busy?.waiting ?? 0
  }
  if (working || waiting) found.push({ kind: 'code', name: 'Terra Code', detail: [working && `${plural(working, 'session')} working`, waiting && `${waiting} waiting for you`].filter(Boolean).join(', '), page: 'sc://assistant/?mode=code' })
  const runs = core.services.kv.get('coder:cloud') as Record<string, CoderCloudRun[]> | undefined
  for (const run of Object.values(runs ?? {}).flat()) {
    if (!['starting', 'queued', 'working'].includes(run.state)) continue
    found.push({ kind: 'cloud', name: run.task.split('\n')[0]!.slice(0, 120), detail: `${run.state === 'queued' ? 'Waiting to start' : 'Working'} ${run.where === 'server' ? `on ${run.host ?? 'your server'}` : 'on GitHub Actions'} · ${run.branch}`, page: 'sc://assistant/?mode=code' })
  }
  for (const download of core.downloads.list()) {
    if (download.state !== 'progressing' && download.state !== 'paused') continue
    const share = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : null
    found.push({ kind: 'download', name: download.filename, detail: download.state === 'paused' ? 'Paused' : share === null ? 'Downloading' : `Downloading, ${share}%`, page: 'sc://downloads/' })
  }
  return found
}

/** Only a process holding nothing but web pages: never the browser, its interface or its own pages. */
export function endTask(core: BrowserCore, pid: number): void {
  const tabs = tabsByProcess(core).get(pid)
  if (tabs?.every((tab) => isEndable(tab.url))) process.kill(pid)
}
