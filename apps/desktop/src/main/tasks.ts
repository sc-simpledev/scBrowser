import { app, webContents } from 'electron'
import type { TaskList, TaskRow } from '@scbrowser/shared'
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

export function taskList(core: BrowserCore): TaskList {
  const byProcess = tabsByProcess(core)
  const others = new Map(
    webContents
      .getAllWebContents()
      .filter((contents) => !contents.isDestroyed())
      .map((contents) => [contents.getOSProcessId(), /^(chrome-extension|devtools):/.test(contents.getURL()) ? (contents.getTitle() || 'Extension') : 'Browser interface'] as const)
  )
  const rows = app.getAppMetrics().map((metric): TaskRow => {
    const tabs = byProcess.get(metric.pid)
    const memoryKb = metric.memory.workingSetSize
    const cpu = metric.cpu.percentCPUUsage
    if (tabs) return { pid: metric.pid, kind: 'Tab', name: tabs.map((tab) => tab.title).join(', '), memoryKb, cpu, canEnd: tabs.every((tab) => isEndable(tab.url)) }
    const other = others.get(metric.pid)
    if (other) return { pid: metric.pid, kind: other === 'Browser interface' ? 'Browser' : 'Extension', name: other, memoryKb, cpu, canEnd: false }
    return { pid: metric.pid, kind: 'System', name: metric.name || metric.serviceName || SYSTEM_NAMES[metric.type] || metric.type, memoryKb, cpu, canEnd: false }
  })
  return { rows: rows.toSorted((a, b) => b.memoryKb - a.memoryKb), sleeping: core.windows.reduce((sum, { tabs }) => sum + tabs.sleepingCount(), 0) }
}

/** Only a process holding nothing but web pages: never the browser, its interface or its own pages. */
export function endTask(core: BrowserCore, pid: number): void {
  const tabs = tabsByProcess(core).get(pid)
  if (tabs?.every((tab) => isEndable(tab.url))) process.kill(pid)
}
