import { Copy, Eye, EyeOff, Globe, KeyRound, Pencil, RefreshCw, ShieldAlert, User, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { EMPTY_IDENTITY, generatePassword, IDENTITY_FIELDS, identityName, MIN_MASTER_LENGTH, PASSWORD_LOCK_CHOICES, passwordStrength, STRENGTH_LABELS, type Identity, type PasswordEntry, type PasswordState, type PasswordSummary } from '@scbrowser/shared'
import { api } from '../api'

const cleanError = (error: Error) => error.message.replace(/^.*Error: /, '')
const random = (values: Uint32Array) => void crypto.getRandomValues(values as Uint32Array<ArrayBuffer>)
const strongPassword = (length = 20, options: { symbols?: boolean; digits?: boolean } = {}) => generatePassword(random, length, options)
const siteName = (origin: string) => origin.replace(/^https:\/\//, '')

const CARD = 'flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-1'

/** The first time here: with a master password, or sealed by this computer's keychain alone. */
function CreateVault({ reload }: { reload: () => void }) {
  const [useMaster, setUseMaster] = useState(true)
  const [master, setMaster] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (useMaster && master !== again) return setProblem("Those passwords don't match.")
    setBusy(true)
    void api()
      .invoke('passwords:create', useMaster ? master : '')
      .then(reload)
      .catch((error: Error) => setProblem(cleanError(error)))
      .finally(() => setBusy(false))
  }
  const choice = (value: boolean, title: string, note: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${useMaster === value ? 'border-(--sc-accent)' : 'border-border'}`}>
      <input type="radio" name="vault-kind" className="mt-1 accent-(--sc-accent)" checked={useMaster === value} onChange={() => setUseMaster(value)} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-text-muted">{note}</span>
      </span>
    </label>
  )
  return (
    <form aria-label="Set up passwords" onSubmit={submit} className={CARD}>
      <div>
        <h2 className="font-semibold">Set up saved passwords</h2>
        <p className="text-xs text-text-muted">Choose how your logins are sealed on this computer. You can change this later.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {choice(true, 'Use a master password', "Asks for it to unlock. scTerra doesn't keep it, so if you forget it your logins can't be recovered.")}
        {choice(false, 'No master password', "Opens by itself, sealed by this computer's keychain, like Chrome. Anyone using your account can see them.")}
      </div>
      {useMaster && (
        <>
          <Input type="password" autoFocus aria-label="Master password" placeholder={`At least ${MIN_MASTER_LENGTH} characters`} value={master} onChange={(e) => setMaster(e.target.value)} />
          <Input type="password" aria-label="Repeat master password" placeholder="Repeat it" value={again} onChange={(e) => setAgain(e.target.value)} />
          {master && <StrengthMeter password={master} />}
        </>
      )}
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div>
        <Button type="submit" variant="primary" disabled={busy || (useMaster && !master)}>
          {busy ? 'Setting up…' : 'Create vault'}
        </Button>
      </div>
    </form>
  )
}

/** Four thin bars and a word, coloured from danger to success. */
function StrengthMeter({ password }: { password: string }) {
  const score = passwordStrength(password)
  const colour = score < 2 ? 'bg-danger' : score < 3 ? 'bg-(--sc-accent)' : 'bg-success'
  return (
    <div className="flex items-center gap-2" aria-label={`Strength: ${STRENGTH_LABELS[score]}`}>
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((bar) => (
          <span key={bar} className={`h-1 flex-1 rounded-full ${bar <= Math.max(1, score) ? colour : 'bg-border'}`} />
        ))}
      </div>
      <span className="w-16 text-right text-2xs text-text-muted">{STRENGTH_LABELS[score]}</span>
    </div>
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
  const [generator, setGenerator] = useState(false)
  const [length, setLength] = useState(20)
  const [symbols, setSymbols] = useState(true)
  const [digits, setDigits] = useState(true)
  const set = (patch: Partial<PasswordEntry>) => setEntry({ ...entry, ...patch })
  const regenerate = (next: { length?: number; symbols?: boolean; digits?: boolean } = {}) => {
    set({ password: strongPassword(next.length ?? length, { symbols: next.symbols ?? symbols, digits: next.digits ?? digits }) })
    setShow(true)
  }
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
            regenerate()
            setGenerator(true)
          }}
        >
          <RefreshCw size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      {entry.password && <StrengthMeter password={entry.password} />}
      {generator && (
        <div aria-label="Password generator" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted">
          <label className="flex items-center gap-2">
            Length {length}
            <input
              type="range"
              min={8}
              max={64}
              value={length}
              aria-label="Password length"
              className="w-32 accent-(--sc-accent)"
              onChange={(e) => {
                setLength(Number(e.target.value))
                regenerate({ length: Number(e.target.value) })
              }}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-(--sc-accent)" checked={digits} onChange={(e) => { setDigits(e.target.checked); regenerate({ digits: e.target.checked }) }} />
            Numbers
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-(--sc-accent)" checked={symbols} onChange={(e) => { setSymbols(e.target.checked); regenerate({ symbols: e.target.checked }) }} />
            Symbols
          </label>
        </div>
      )}
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
        <div className="flex items-center gap-1.5 truncate text-xs text-text-muted">
          <span className="truncate">{login.username || 'No username'}{login.note && ` · ${login.note}`}</span>
          {login.weak && <span className="shrink-0 rounded-sm border border-border px-1 text-2xs text-danger">Weak</span>}
          {login.reused && <span className="shrink-0 rounded-sm border border-border px-1 text-2xs text-danger">Reused</span>}
        </div>
      </div>
      <span className="max-w-52 truncate font-mono text-xs text-text-muted select-text">{shown ?? '••••••••'}</span>
      <IconButton
        size="sm"
        label={shown === null ? 'Show password' : 'Hide password'}
        onClick={() => (shown === null ? void api().invoke('passwords:reveal', login.id).then(setShown) : setShown(null))}
      >
        {shown === null ? <Eye size={12} strokeWidth={1.75} /> : <EyeOff size={12} strokeWidth={1.75} />}
      </IconButton>
      {login.username && (
        <IconButton size="sm" label="Copy username" onClick={() => void navigator.clipboard.writeText(login.username)}>
          <User size={12} strokeWidth={1.75} />
        </IconButton>
      )}
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

/** Addresses and contact details, offered from the key button and the menu in text fields. */
function Details() {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [editing, setEditing] = useState<Identity | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = useCallback(() => void api().invoke('autofill:list').then(setIdentities), [])
  useEffect(load, [load])
  return (
    <section aria-label="Addresses and details" className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Addresses and details</h2>
        <Button onClick={() => setEditing({ ...EMPTY_IDENTITY })}>Add</Button>
      </div>
      {editing && (
        <form
          aria-label={editing.id ? 'Edit details' : 'New details'}
          className="flex flex-col gap-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void api()
              .invoke('autofill:save', editing)
              .then(() => {
                setEditing(null)
                setProblem(null)
                load()
              })
              .catch((error: Error) => setProblem(cleanError(error)))
          }}
        >
          {IDENTITY_FIELDS.map(({ key, label }) => (
            <Input key={key} aria-label={label} placeholder={label} autoComplete="off" value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
          ))}
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {identities.length === 0 && !editing && <p className="px-2 py-1 text-text-muted">Nothing yet. Add your name and address to fill in forms from the key button.</p>}
      <ul>
        {identities.map((identity) => (
          <li key={identity.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
            <div className="min-w-0 flex-1">
              <div className="truncate">{identityName(identity)}</div>
              <div className="truncate text-xs text-text-muted">{[identity.address1, identity.city, identity.email].filter(Boolean).join(', ')}</div>
            </div>
            <IconButton size="sm" label="Edit details" onClick={() => setEditing(identity)}>
              <Pencil size={12} strokeWidth={1.75} />
            </IconButton>
            <IconButton size="sm" label="Delete details" onClick={() => void api().invoke('autofill:remove', identity.id!).then(load)}>
              <X size={12} strokeWidth={2} />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Adds a master password to a vault that opens by itself. */
function AddMaster({ onDone }: { onDone: () => void }) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <form
      aria-label="Add a master password"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (next !== again) return setProblem("Those passwords don't match.")
        void api()
          .invoke('passwords:set-master', next)
          .then(onDone)
          .catch((error: Error) => setProblem(cleanError(error)))
      }}
    >
      <Input type="password" autoFocus aria-label="New master password" placeholder={`At least ${MIN_MASTER_LENGTH} characters`} value={next} onChange={(e) => setNext(e.target.value)} />
      <Input type="password" aria-label="Repeat master password" placeholder="Repeat it" value={again} onChange={(e) => setAgain(e.target.value)} />
      {next && <StrengthMeter password={next} />}
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div>
        <Button type="submit" disabled={!next}>
          Add it
        </Button>
      </div>
    </form>
  )
}

/** Goes back to the keychain alone, after checking the current password. */
function RemoveMaster({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <form
      aria-label="Remove master password"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void api()
          .invoke('passwords:remove-master', current)
          .then((removed) => (removed ? onDone() : setProblem("That isn't your current master password.")))
          .catch((error: Error) => setProblem(cleanError(error)))
      }}
    >
      <p className="text-xs text-text-muted">Your logins will open by themselves, sealed by this computer's keychain. Anyone using your account will be able to see them.</p>
      <Input type="password" autoFocus aria-label="Current master password" placeholder="Current master password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div>
        <Button type="submit" className="text-danger" disabled={!current}>
          Remove it
        </Button>
      </div>
    </form>
  )
}

function Options({ reload, master }: { reload: () => void; master: boolean }) {
  const [minutes, setMinutes] = useState<number | null>(null)
  const [offer, setOffer] = useState(true)
  const [offerLocked, setOfferLocked] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [changing, setChanging] = useState<'change' | 'add' | 'remove' | null>(null)
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    void api().invoke('settings:get').then(({ passwordLockMinutes, passwordOfferSave, passwordOfferLocked }) => {
      setMinutes(passwordLockMinutes)
      setOffer(passwordOfferSave)
      setOfferLocked(passwordOfferLocked)
    })
  }, [])
  if (minutes === null) return null
  return (
    <section aria-label="Password options" className={CARD}>
      <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Options</h2>
      {master && <label className="flex items-center justify-between gap-3">
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
      </label>}
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
      {master && <label className="flex items-center justify-between gap-3">
        <span>
          Also offer while locked
          <span className="block text-xs text-text-muted">It can't check what's saved until you unlock, so it may ask about logins you already have. The login stays in memory for a minute at most.</span>
        </span>
        <input
          type="checkbox"
          checked={offerLocked}
          disabled={!offer}
          className="accent-(--sc-accent)"
          onChange={(e) => {
            setOfferLocked(e.target.checked)
            void api().invoke('settings:set', { passwordOfferLocked: e.target.checked })
          }}
        />
      </label>}
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
        {master ? (
          <>
            <Button onClick={() => setChanging(changing === 'change' ? null : 'change')}>Change master password</Button>
            <Button onClick={() => setChanging(changing === 'remove' ? null : 'remove')}>Remove master password</Button>
          </>
        ) : (
          <Button onClick={() => setChanging(changing === 'add' ? null : 'add')}>Add a master password</Button>
        )}
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
      {changing === 'change' && <ChangeMaster onDone={() => { setChanging(null); setNote('Master password changed.') }} />}
      {changing === 'add' && <AddMaster onDone={() => { setChanging(null); setNote('Master password added.'); reload() }} />}
      {changing === 'remove' && <RemoveMaster onDone={() => { setChanging(null); setNote('Master password removed.'); reload() }} />}
      {note && <p role="status" className="text-xs text-text-muted">{note}</p>}
    </section>
  )
}

export function PasswordsPage() {
  const [state, setState] = useState<PasswordState | null>(null)
  const [logins, setLogins] = useState<PasswordSummary[]>([])
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [health, setHealth] = useState<'all' | 'weak' | 'reused'>('all')

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
    return logins.filter(({ origin, username, note, weak, reused }) => `${origin} ${username} ${note}`.toLowerCase().includes(needle) && (health === 'all' || (health === 'weak' ? weak : reused)))
  }, [logins, filter, health])
  const weakCount = logins.filter((login) => login.weak).length
  const reusedCount = logins.filter((login) => login.reused).length

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
          {state.master && (
            <Button variant="ghost" onClick={() => void api().invoke('passwords:lock').then(reload)}>
              Lock
            </Button>
          )}
        </div>
        {logins.length > 0 && (
          <div role="group" aria-label="Password health" className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ['all', `All ${logins.length}`, null],
                ['weak', `Weak ${weakCount}`, weakCount],
                ['reused', `Reused ${reusedCount}`, reusedCount]
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={health === value}
                onClick={() => setHealth(value)}
                className={`flex h-6 items-center gap-1 rounded-sm border px-2 ${health === value ? 'border-(--sc-accent) text-text' : 'border-border text-text-muted hover:bg-surface-hover'}`}
              >
                {count !== null && count > 0 && <ShieldAlert aria-hidden size={11} strokeWidth={1.75} className="text-danger" />}
                {label}
              </button>
            ))}
            {weakCount + reusedCount === 0 && (
              <span className="ml-1 flex items-center gap-1 text-text-muted">
                <KeyRound aria-hidden size={11} strokeWidth={1.75} />
                No weak or reused passwords.
              </span>
            )}
          </div>
        )}
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
      <Details />
      <Options reload={reload} master={state.master} />
      <p className="text-xs text-text-faint">Logins and details stay on this computer, sealed with {state.master ? 'your master password' : "this computer's keychain"}, and aren't synced. To fill them in, use the key button in the toolbar or Ctrl Shift L.</p>
    </>
  )
}
