import { useCallback, useEffect, useState } from 'react'
import { Button } from '@scbrowser/ui'
import type { DownloadAction, DownloadInfo } from '@scbrowser/shared'
import { api, formatBytes } from '../api'

const POLL_MS = 1000

const status = (d: DownloadInfo) => {
  const progress = d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)} of ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes)
  if (d.state === 'progressing') return progress
  if (d.state === 'paused') return `Paused, ${progress}`
  if (d.state === 'completed') return formatBytes(d.receivedBytes)
  if (d.state === 'cancelled') return 'Cancelled'
  return 'Failed'
}

export function DownloadsPage() {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])

  const load = useCallback(() => void api().invoke('downloads:list').then(setDownloads), [])
  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const act = (id: string, action: DownloadAction) => void api().invoke('downloads:action', id, action).then(load)
  const running = (d: DownloadInfo) => d.state === 'progressing' || d.state === 'paused'

  if (downloads.length === 0) return <p className="text-text-muted">No downloads yet.</p>

  return (
    <>
      <div>
        <Button
          disabled={downloads.every(running)}
          onClick={() => void api().invoke('downloads:clear').then(load)}
        >
          Clear finished
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {downloads.map((d) => (
          <li key={d.id} className="flex min-h-14 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{d.filename}</span>
              <span className="truncate text-xs text-text-faint">{status(d)}</span>
              {running(d) && d.totalBytes > 0 && (
                <span className="h-0.5 overflow-hidden rounded-full bg-surface-active">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(d.receivedBytes / d.totalBytes) * 100}%` }}
                  />
                </span>
              )}
            </div>
            {d.state === 'progressing' && <Button variant="ghost" onClick={() => act(d.id, 'pause')}>Pause</Button>}
            {d.state === 'paused' && <Button variant="ghost" onClick={() => act(d.id, 'resume')}>Resume</Button>}
            {running(d) && <Button variant="ghost" onClick={() => act(d.id, 'cancel')}>Cancel</Button>}
            {d.state === 'completed' && <Button variant="ghost" onClick={() => act(d.id, 'open')}>Open</Button>}
            {d.state === 'completed' && <Button variant="ghost" onClick={() => act(d.id, 'show')}>Show in folder</Button>}
            {!running(d) && <Button variant="ghost" onClick={() => act(d.id, 'remove')}>Remove</Button>}
          </li>
        ))}
      </ul>
    </>
  )
}
