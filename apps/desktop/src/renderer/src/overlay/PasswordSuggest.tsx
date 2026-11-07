import { KeyRound, LockKeyhole, Settings, Sparkles, UserRound } from 'lucide-react'
import { PASSWORD_SUGGEST, passwordSuggestHeight, type PasswordSuggestState } from '@scbrowser/shared'

const pick = (choice: string) => void window.scbOverlay.invoke('overlay:password-suggest', choice)

const ROW = 'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none'

/**
 * Hangs under a sign-in field the person has clicked. Usernames show; passwords never reach this
 * view, as the main process fills the page itself once a row is picked.
 */
export function PasswordSuggest({ suggest, x, y }: { suggest: PasswordSuggestState; x: number; y: number }) {
  const shown = suggest.logins.slice(0, PASSWORD_SUGGEST.maxRows)
  const row = { height: PASSWORD_SUGGEST.rowHeight }
  return (
    <div
      role="listbox"
      aria-label={`Saved passwords for ${suggest.host}`}
      className="sc-glass-strong sc-tooltip absolute flex flex-col overflow-hidden rounded-lg p-1 shadow-3"
      style={{ left: x, top: y, width: suggest.width, height: passwordSuggestHeight(suggest) }}
    >
      {suggest.locked ? (
        <button type="button" role="option" aria-selected={false} style={row} className={ROW} onClick={() => pick('unlock')}>
          <LockKeyhole aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-accent" />
          <span className="truncate">Unlock passwords to fill</span>
        </button>
      ) : (
        <>
          {shown.map((login) => (
            <button key={login.id} type="button" role="option" aria-selected={false} style={row} className={ROW} onClick={() => pick(`login:${login.id}`)}>
              <UserRound aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate">{login.username || 'No username'}</span>
              <span aria-hidden className="shrink-0 font-mono text-2xs tracking-widest text-text-faint">••••••</span>
            </button>
          ))}
          {suggest.generate && (
            <button type="button" role="option" aria-selected={false} style={row} className={ROW} onClick={() => pick('generate')}>
              <Sparkles aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-accent" />
              <span className="truncate">Use a strong password</span>
            </button>
          )}
        </>
      )}
      <div className="mt-auto flex shrink-0 items-center gap-1 border-t border-border pt-1" style={{ height: PASSWORD_SUGGEST.footer }}>
        <KeyRound aria-hidden size={12} strokeWidth={1.75} className="ml-2 shrink-0 text-text-faint" />
        <span className="min-w-0 flex-1 truncate text-2xs text-text-faint">scTerra passwords · {suggest.host}</span>
        <button type="button" aria-label="Manage passwords" title="Manage passwords" onClick={() => pick('manage')} className="grid size-6 shrink-0 place-items-center rounded-sm text-text-faint transition-colors hover:bg-surface-hover hover:text-text">
          <Settings aria-hidden size={12} strokeWidth={1.75} />
        </button>
        <button type="button" onClick={() => pick('close')} className="h-6 shrink-0 rounded-sm px-1.5 text-2xs text-text-faint transition-colors hover:bg-surface-hover hover:text-text">
          Close
        </button>
      </div>
    </div>
  )
}
