import { useEffect, useState } from 'react'
import { Bot, Cloud, Download, Newspaper, type LucideIcon } from 'lucide-react'
import { Button } from '@scbrowser/ui'
import type { BackgroundTask, TaskList } from '@scbrowser/shared'
import { api } from '../api'

const REFRESH_MS = 2000
const KIND_ICONS: Record<BackgroundTask['kind'], LucideIcon> = { brief: Newspaper, code: Bot, cloud: Cloud, download: Download }
const megabytes = (kilobytes: number) => `${Math.round(kilobytes / 1024).toLocaleString()} MB`

/** What each process is using. Only those holding web pages can be ended from here. */
export function TasksPage() {
  const [tasks, setTasks] = useState<TaskList | null>(null)
  useEffect(() => {
    const refresh = () => void api().invoke('tasks:list').then(setTasks)
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  if (!tasks) return null
  const total = tasks.rows.reduce((sum, row) => sum + row.memoryKb, 0)
  return (
    <div className="flex flex-col gap-2">
      {tasks.background.length > 0 && (
        <section aria-label="Working in the background" className="mb-3 flex flex-col gap-2">
          <h2 className="text-xs font-medium text-text-muted">Working in the background</h2>
          <ul className="overflow-hidden rounded-lg bg-surface shadow-1">
            {tasks.background.map((task, index) => {
              const Icon = KIND_ICONS[task.kind]
              return (
                <li key={index} className="border-t border-border first:border-t-0">
                  <button type="button" onClick={() => void api().invoke('browser:open', task.page)} className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-hover">
                    <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{task.name}</span>
                      <span className="truncate text-xs text-text-muted">{task.detail}</span>
                    </span>
                    <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <p className="text-text-muted">
        {megabytes(total)} in use{tasks.sleeping > 0 && `, with ${tasks.sleeping} ${tasks.sleeping === 1 ? 'tab' : 'tabs'} asleep`}
      </p>
      <div className="overflow-hidden rounded-lg bg-surface shadow-1">
        <table className="w-full table-fixed text-left">
          <thead className="text-2xs font-semibold text-text-faint">
            <tr>
              <th scope="col" className="px-3 py-2">Task</th>
              <th scope="col" className="w-24 px-3 py-2 text-right">Memory</th>
              <th scope="col" className="w-16 px-3 py-2 text-right">CPU</th>
              <th scope="col" className="w-24 px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {tasks.rows.map((row) => (
              <tr key={row.pid} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <span className="block truncate" title={row.name}>{row.name}</span>
                  <span className="block truncate text-xs text-text-muted">{row.kind}</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{megabytes(row.memoryKb)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.cpu.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right">
                  {row.canEnd && (
                    <Button variant="ghost" onClick={() => void api().invoke('tasks:end', row.pid)}>
                      End
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
