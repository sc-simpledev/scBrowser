import { Loader, MessageSquareMore, Square, X } from 'lucide-react'
import { Button } from '@scbrowser/ui'
import { ANSWER_HEIGHT, type OmniboxAnswer } from '@scbrowser/shared'
import { ReplyContent } from '../shared/ReplyContent'

const act = (action: 'close' | 'continue' | 'stop') => void window.scbOverlay.invoke('overlay:answer-action', action)

/** The address bar's answer. Replies are untrusted, and links only open as new tabs through the main process. */
export function AnswerCard({ answer }: { answer: OmniboxAnswer }) {
  return (
    <section
      aria-label="Answer"
      tabIndex={-1}
      className="sc-glass-strong sc-tooltip flex flex-col overflow-hidden rounded-lg shadow-3"
      style={{ height: ANSWER_HEIGHT }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') act('close')
      }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        {answer.streaming && <Loader aria-hidden size={13} strokeWidth={2} className="shrink-0 animate-spin text-accent" />}
        <h2 className="min-w-0 flex-1 truncate font-medium">{answer.question}</h2>
        <button type="button" aria-label="Close" onClick={() => act('close')} className="grid size-6 shrink-0 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
          <X size={13} strokeWidth={2} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 select-text" role="log" aria-live="polite">
        {answer.error ? (
          <p role="alert" className="text-danger">
            {answer.error}
          </p>
        ) : answer.text ? (
          <ReplyContent text={answer.text} streaming={answer.streaming} onOpenLink={(href) => void window.scbOverlay.invoke('overlay:answer-link', href)} />
        ) : (
          <p className="text-text-faint">Thinking…</p>
        )}
      </div>
      {(answer.streaming || answer.canContinue) && (
        <footer className="flex h-10 shrink-0 items-center justify-end gap-2 border-t border-border px-1.5">
          {answer.streaming ? (
            <Button variant="ghost" onClick={() => act('stop')}>
              <Square aria-hidden size={11} strokeWidth={2} />
              Stop
            </Button>
          ) : (
            answer.text && (
              <Button variant="ghost" onClick={() => act('continue')}>
                <MessageSquareMore aria-hidden size={14} strokeWidth={1.75} />
                Continue in assistant
              </Button>
            )
          )}
        </footer>
      )}
    </section>
  )
}
