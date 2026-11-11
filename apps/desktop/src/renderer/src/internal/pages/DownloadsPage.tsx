import { Download, FolderOpen, Pencil, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input } from '@scbrowser/ui'
import type { DownloadAction, DownloadInfo } from '@scbrowser/shared'
import { api, formatBytes } from '../api'
import { EmptyState } from '../EmptyState'

const POLL_MS = 1000

const status = (d: DownloadInfo) => {
  const progress = d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)} of ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes)
  if (d.state === 'progressing') return progress
  if (d.state === 'paused') return `Paused, ${progress}`
  if (d.state === 'completed') return formatBytes(d.receivedBytes)
  if (d.state === 'cancelled') return 'Cancelled'
  return 'Failed'
}

/** Renaming a finished file in place, with an optional name suggested by the AI from its name and address. */
function RenameForm({ download, onDone }: { download: DownloadInfo; onDone: () => void }) {
  const dot = download.filename.lastIndexOf('.')
  const [name, setName] = useState(dot > 0 ? download.filename.slice(0, dot) : download.filename)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extension = dot > 0 ? download.filename.slice(dot) : ''
  const fail = (failure: Error) => setError(failure.message.replace(/^.*Error: /, ''))
  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        void api().invoke('downloads:rename', download.id, `${name.trim()}${extension}`).then(onDone, fail)
      }}
    >
      <div className="flex items-center gap-1.5">
        <Input autoFocus aria-label={`New name for ${download.filename}`} className="min-w-0 flex-1" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onDone()} />
        {extension && <span className="text-xs text-text-faint">{extension}</span>}
        <IconButton
          size="md"
          label="Suggest a name with AI"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void api()
              .invoke('downloads:suggest-name', download.id)
              .then((suggested) => setName(suggested.slice(0, suggested.length - extension.length) || suggested), fail)
              .finally(() => setBusy(false))
          }}
        >
          <Sparkles size={14} strokeWidth={1.75} className="text-accent" />
        </IconButton>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Rename
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <span className={error ? 'text-xs text-danger' : 'text-xs text-text-faint'}>{error ?? (busy ? 'Asking your AI…' : 'The AI only sees the file’s name and address.')}</span>
    </form>
  )
}

export function DownloadsPage() {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])

  const load = useCallback(() => void api().invoke('downloads:list').then(setDownloads), [])
  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const act = (id: string, action: DownloadAction) => void api().invoke('downloads:action', id, action).then(load)
  const running = (d: DownloadInfo) => d.state === 'progressing' || d.state === 'paused'

  if (downloads.length === 0) return <EmptyState icon={Download} title="No downloads yet">Files you download appear here, with their progress.</EmptyState>

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button disabled={downloads.every(running)} onClick={() => void api().invoke('downloads:clear').then(load)}>
          Clear finished
        </Button>
        <Button variant="ghost" onClick={() => void api().invoke('browser:open', 'sc://settings/#browsing')}>
          Folders and rules
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {downloads.map((d) => (
          <li key={d.id} className="group flex min-h-14 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
            {renaming === d.id ? (
              <RenameForm
                download={d}
                onDone={() => {
                  setRenaming(null)
                  load()
                }}
              />
            ) : (
              <>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">{d.filename}</span>
                  <span className="truncate text-xs text-text-faint">{status(d)}</span>
                  {running(d) && d.totalBytes > 0 && (
                    <span className="h-0.5 overflow-hidden rounded-full bg-surface-active">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(d.receivedBytes / d.totalBytes) * 100}%` }} />
                    </span>
                  )}
                </div>
                {d.state === 'progressing' && <Button variant="ghost" onClick={() => act(d.id, 'pause')}>Pause</Button>}
                {d.state === 'paused' && <Button variant="ghost" onClick={() => act(d.id, 'resume')}>Resume</Button>}
                {running(d) && <Button variant="ghost" onClick={() => act(d.id, 'cancel')}>Cancel</Button>}
                {d.state === 'completed' && <Button onClick={() => act(d.id, 'open')}>Open</Button>}
                {d.state === 'completed' && (
                  <>
                    <IconButton label="Rename" onClick={() => setRenaming(d.id)}>
                      <Pencil size={14} strokeWidth={1.75} />
                    </IconButton>
                    <IconButton label="Show in folder" onClick={() => act(d.id, 'show')}>
                      <FolderOpen size={14} strokeWidth={1.75} />
                    </IconButton>
                  </>
                )}
                {!running(d) && (
                  <IconButton label="Remove from list" onClick={() => act(d.id, 'remove')}>
                    <X size={14} strokeWidth={1.75} />
                  </IconButton>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
