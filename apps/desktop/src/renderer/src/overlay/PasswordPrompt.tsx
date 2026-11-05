import { KeyRound } from 'lucide-react'
import { Button } from '@scbrowser/ui'
import { PASSWORD_POPUP, type PasswordPromptState } from '@scbrowser/shared'

const answer = (choice: 'save' | 'never' | 'dismiss') => void window.scbOverlay.invoke('overlay:password-answer', choice)

/** Asked after someone signs in. The password itself stays in the main process. */
export function PasswordPrompt({ prompt, x, y }: { prompt: PasswordPromptState; x: number; y: number }) {
  return (
    <div role="dialog" aria-label="Save password" className="sc-glass-strong sc-tooltip absolute flex flex-col gap-2.5 rounded-lg p-3 shadow-3" style={{ left: x, top: y, width: PASSWORD_POPUP.width, height: PASSWORD_POPUP.height }}>
      <div className="flex min-w-0 items-start gap-2.5">
        <KeyRound aria-hidden size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="truncate font-medium">{prompt.update ? 'Update the saved password?' : 'Save this password?'}</div>
          <div className="truncate text-xs text-text-muted">
            {prompt.host}
            {prompt.username && ` · ${prompt.username}`}
          </div>
        </div>
      </div>
      <div className="mt-auto flex justify-end gap-1.5">
        {!prompt.update && !prompt.needs && (
          <Button variant="ghost" onClick={() => answer('never')}>
            Never here
          </Button>
        )}
        <Button variant="ghost" onClick={() => answer('dismiss')}>
          Not now
        </Button>
        <Button variant="primary" onClick={() => answer('save')}>
          {prompt.needs === 'unlock' ? 'Unlock and save' : prompt.needs === 'setup' ? 'Set up and save' : prompt.update ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
