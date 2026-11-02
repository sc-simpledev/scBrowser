import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button, Input } from '@scbrowser/ui'
import { AUTH_POPUP, type AuthPopupState } from '@scbrowser/shared'

/** A site's own sign-in box. What's typed goes to that site, and nothing here is saved. */
export function AuthPopup({ auth, x, y }: { auth: AuthPopupState; x: number; y: number }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const cancel = () => void window.scbOverlay.invoke('overlay:auth', auth.requestId, null)

  return (
    <form
      role="dialog"
      aria-label="Sign in"
      className="sc-glass-strong sc-tooltip absolute flex flex-col gap-2 rounded-lg p-3 shadow-3"
      style={{ left: x, top: y, width: AUTH_POPUP.width, height: AUTH_POPUP.height }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        void window.scbOverlay.invoke('overlay:auth', auth.requestId, { username, password })
      }}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">Sign in to {auth.host}</div>
        {auth.realm && <div className="truncate text-xs text-text-muted">“{auth.realm}”</div>}
      </div>
      {auth.insecure && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <TriangleAlert aria-hidden size={12} strokeWidth={2} className="shrink-0" />
          This connection isn't encrypted
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Username
        <Input autoFocus autoComplete="off" spellCheck={false} aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Password
        <Input type="password" autoComplete="off" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <div className="mt-auto flex justify-end gap-2">
        <Button onClick={cancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </div>
    </form>
  )
}
