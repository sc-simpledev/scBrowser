import { Copy, Eye, EyeOff, Globe, Pencil, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { generatePassword, MIN_MASTER_LENGTH, PASSWORD_LOCK_CHOICES, type PasswordEntry, type PasswordState, type PasswordSummary } from '@scbrowser/shared'
import { api } from '../api'

const cleanError = (error: Error) => error.message.replace(/^.*Error: /, '')
const strongPassword = () => generatePassword((values) => void crypto.getRandomValues(values as Uint32Array<ArrayBuffer>))
const siteName = (origin: string) => origin.replace(/^https:\/\//, '')

const CARD = 'flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-1'

/** The first time here, and the promise about what forgetting it means. */
function CreateVault({ reload }: { reload: () => void }) {
  const [master, setMaster] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (master !== again) return setProblem("Those passwords don't match.")
    setBusy(true)
    void api()
      .invoke('passwords:create', master)
      .then(reload)
      .catch((error: Error) => setProblem(cleanError(error)))
      .finally(() => setBusy(false))
  }
  return (
    <form aria-label="Set a master password" onSubmit={submit} className={CARD}>
      <div>
        <h2 className="font-semibold">Set a master password</h2>
        <p className="text-xs text-text-muted">It seals your saved logins on this computer. scTerra doesn't keep it, so if you forget it, your saved logins can't be recovered.</p>
      </div>
      <Input type="password" autoFocus aria-label="Master password" placeholder={`At least ${MIN_MASTER_LENGTH} characters`} value={master} onChange={(e) => setMaster(e.target.value)} />
      <Input type="password" aria-label="Repeat master password" placeholder="Repeat it" value={again} onChange={(e) => setAgain(e.target.value)} />
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div>
        <Button type="submit" variant="primary" disabled={busy || !master}>
          {busy ? 'Setting up…' : 'Create vault'}
        </Button>
      </div>
    </form>
  )
}

function UnlockVault({ reload }: { reload: () => void }) {
  const [master, setMaster] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setWrong(false)
    void api()
      .invoke('passwords:unlock', master)
      .then((opened) => {
        if (opened) reload()
        else setWrong(true)
      })
      .finally(() => setBusy(false))
  }
  return (
    <form aria-label="Unlock passwords" onSubmit={submit} className={CARD}>
      <h2 className="font-semibold">Unlock your passwords</h2>
      <Input type="password" autoFocus aria-label="Master password" placeholder="Master password" value={master} onChange={(e) => setMaster(e.target.value)} />
      {wrong && <p role="alert" className="text-xs text-danger">That isn't the master password.</p>}
      <div className="flex items-center justify-between gap-2">
        <Button type="submit" variant="primary" disabled={busy || !master}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
        <Button variant="ghost" onClick={() => setForgot(!forgot)}>
          Forgot it?
        </Button>
      </div>
      {forgot && (
        <div role="alert" className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-text-muted">
          <span>Nobody can recover it. You can only start again, which deletes every saved login.</span>
          <Button className="shrink-0 text-danger" onClick={() => void api().invoke('passwords:reset').then(reload)}>
            Delete all and start again
          </Button>
        </div>
      )}
    </form>
  )
}

function EntryForm({ initial, onDone }: { initial: PasswordEntry; onDone: (saved: boolean) => void }) {
  const [entry, setEntry] = useState(initial)
  const [show, setShow] = useState(!initial.id)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (patch: Partial<PasswordEntry>) => setEntry({ ...entry, ...patch })
  return (
    <form
      aria-label={initial.id ? 'Edit login' : 'New login'}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void api()
          .invoke('passwords:save', entry)
          .then(() => onDone(true))
          .catch((error: Error) => setProblem(cleanError(error)))
      }}
    >
      <Input autoFocus aria-label="Website" placeholder="https://example.com" value={entry.url} onChange={(e) => set({ url: e.target.value })} />
      <Input aria-label="Username" placeholder="Username or email" autoComplete="off" value={entry.username} onChange={(e) => set({ username: e.target.value })} />
      <div className="flex gap-1">
        <Input type={show ? 'text' : 'password'} aria-label="Password" placeholder="Password" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 font-mono" value={entry.password} onChange={(e) => set({ password: e.target.value })} />
        <IconButton label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
          {show ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
        </IconButton>
        <IconButton
          label="Make a strong password"
          onClick={() => {
            set({ password: strongPassword() })
            setShow(true)
          }}
        >
          <RefreshCw size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      <Input aria-label="Note" placeholder="Note (optional)" value={entry.note} onChange={(e) => set({ note: e.target.value })} />
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Save
        </Button>
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function LoginRow({ login, reload }: { login: PasswordSummary; reload: () => void }) {
  const [shown, setShown] = useState<string | null>(null)
  const [editing, setEditing] = useState<PasswordEntry | null>(null)
  const [copied, setCopied] = useState(false)
  if (editing) {
    return (
      <li className="py-1">
        <EntryForm
          initial={editing}
          onDone={(saved) => {
            setEditing(null)
            setShown(null)
            if (saved) reload()
          }}
        />
      </li>
    )
  }
  return (
    <li className="group flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
      <Globe aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-text-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{siteName(login.origin)}</div>
        <div className="truncate text-xs text-text-muted">{login.username || 'No username'}{login.note && ` · ${login.note}`}</div>
      </div>
      <span className="max-w-52 truncate font-mono text-xs text-text-muted select-text">{shown ?? '••••••••'}</span>
      <IconButton
        size="sm"
        label={shown === null ? 'Show password' : 'Hide password'}
        onClick={() => (shown === null ? void api().invoke('passwords:reveal', login.id).then(setShown) : setShown(null))}
      >
        {shown === null ? <Eye size={12} strokeWidth={1.75} /> : <EyeOff size={12} strokeWidth={1.75} />}
      </IconButton>
      <IconButton
        size="sm"
        label={copied ? 'Copied. Cleared in 30 seconds' : 'Copy password'}
        onClick={() =>
          void api().invoke('passwords:copy', login.id).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }
      >
        <Copy size={12} strokeWidth={1.75} />
      </IconButton>
      <IconButton
        size="sm"
        label="Edit login"
        onClick={() =>
          void api().invoke('passwords:reveal', login.id).then((password) => {
            setEditing({ id: login.id, url: login.origin, username: login.username, password, note: login.note })
          })
        }
      >
        <Pencil size={12} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="Delete login" onClick={() => void api().invoke('passwords:remove', login.id).then(reload)}>
        <X size={12} strokeWidth={2} />
      </IconButton>
    </li>
  )
}

function ChangeMaster({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <form
      aria-label="Change master password"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void api()
          .invoke('passwords:change-master', current, next)
          .then((changed) => (changed ? onDone() : setProblem("That isn't your current master password.")))
          .catch((error: Error) => setProblem(cleanError(error)))
      }}
    >
      <Input type="password" autoFocus aria-label="Current master password" placeholder="Current master password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input type="password" aria-label="New master password" placeholder={`New password, at least ${MIN_MASTER_LENGTH} characters`} value={next} onChange={(e) => setNext(e.target.value)} />
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div>
        <Button type="submit" disabled={!current || !next}>
          Change it
        </Button>
      </div>
    </form>
  )
}

function Options({ reload }: { reload: () => void }) {
  const [minutes, setMinutes] = useState<number | null>(null)
  const [offer, setOffer] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    void api().invoke('settings:get').then(({ passwordLockMinutes, passwordOfferSave }) => {
      setMinutes(passwordLockMinutes)
      setOffer(passwordOfferSave)
    })
  }, [])
  if (minutes === null) return null
  return (
    <section aria-label="Password options" className={CARD}>
      <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Options</h2>
      <label className="flex items-center justify-between gap-3">
        Lock after
        <Select
          aria-label="Lock after"
          className="w-44"
          value={minutes}
          onChange={(e) => {
            const passwordLockMinutes = Number(e.target.value)
            setMinutes(passwordLockMinutes)
            void api().invoke('settings:set', { passwordLockMinutes })
          }}
        >
          {PASSWORD_LOCK_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice === 0 ? 'Only when closed' : `${choice} minutes unused`}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center justify-between gap-3">
        Offer to save when you sign in
        <input
          type="checkbox"
          checked={offer}
          className="accent-(--sc-accent)"
          onChange={(e) => {
            setOffer(e.target.checked)
            void api().invoke('settings:set', { passwordOfferSave: e.target.checked })
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setNote(null)
            void api().invoke('passwords:import').then((count) => {
              if (count === null) return
              setNote(`Imported ${count} ${count === 1 ? 'login' : 'logins'}.`)
              reload()
            }).catch((error: Error) => setNote(cleanError(error)))
          }}
        >
          Import from CSV
        </Button>
        <Button onClick={() => setExporting(!exporting)}>Export to CSV</Button>
        <Button onClick={() => setChanging(!changing)}>Change master password</Button>
      </div>
      {exporting && (
        <div role="alert" className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-text-muted">
          <span>The file holds every password in plain text, and anyone who opens it can read them. Delete it when you're done.</span>
          <Button
            className="shrink-0"
            onClick={() => {
              setExporting(false)
              void api().invoke('passwords:export').then((saved) => saved && setNote('Exported. Delete the file when you’re done.'))
            }}
          >
            Export anyway
          </Button>
        </div>
      )}
      {changing && <ChangeMaster onDone={() => { setChanging(false); setNote('Master password changed.') }} />}
      {note && <p role="status" className="text-xs text-text-muted">{note}</p>}
    </section>
  )
}

export function PasswordsPage() {
  const [state, setState] = useState<PasswordState | null>(null)
  const [logins, setLogins] = useState<PasswordSummary[]>([])
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)

  const reload = useCallback(() => {
    void api().invoke('passwords:state').then((next) => {
      setState(next)
      if (next.unlocked) void api().invoke('passwords:list').then(setLogins)
      else setLogins([])
    })
  }, [])
  useEffect(reload, [reload])
  // It can lock itself while this page is open.
  useEffect(() => {
    const timer = setInterval(() => void api().invoke('passwords:state').then((next) => setState((old) => (old?.unlocked === next.unlocked ? old : next))), 5000)
    return () => clearInterval(timer)
  }, [])

  const shown = useMemo(() => {
    const needle = filter.toLowerCase()
    return logins.filter(({ origin, username }) => `${origin} ${username}`.toLowerCase().includes(needle))
  }, [logins, filter])

  if (!state) return null
  if (!state.available) return <p className="text-text-muted">Private windows don't use saved passwords.</p>
  if (!state.exists) return <CreateVault reload={reload} />
  if (!state.unlocked) return <UnlockVault reload={reload} />

  return (
    <>
      <section aria-label="Logins" className={CARD}>
        <div className="flex items-center gap-2">
          <Input aria-label="Find a login" placeholder="Find a login" className="min-w-0 flex-1" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button onClick={() => setAdding(true)}>Add login</Button>
          <Button variant="ghost" onClick={() => void api().invoke('passwords:lock').then(reload)}>
            Lock
          </Button>
        </div>
        {adding && (
          <EntryForm
            initial={{ url: '', username: '', password: strongPassword(), note: '' }}
            onDone={(saved) => {
              setAdding(false)
              if (saved) reload()
            }}
          />
        )}
        {logins.length === 0 && !adding && <p className="px-2 py-1 text-text-muted">No logins yet. Sign in to a site and scTerra will offer to save it, or add one here.</p>}
        <ul>
          {shown.map((login) => (
            <LoginRow key={login.id} login={login} reload={reload} />
          ))}
        </ul>
      </section>
      <Options reload={reload} />
      <p className="text-xs text-text-faint">Logins stay on this computer, sealed with your master password, and aren't synced. To fill one in, use the key button in the toolbar or Ctrl Shift L.</p>
    </>
  )
}
