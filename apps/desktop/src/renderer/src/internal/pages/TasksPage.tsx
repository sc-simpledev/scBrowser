import { useEffect, useState } from 'react'
import { Button } from '@scbrowser/ui'
import type { TaskList } from '@scbrowser/shared'
import { api } from '../api'

const REFRESH_MS = 2000
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
      <p className="px-1 text-text-muted">
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
