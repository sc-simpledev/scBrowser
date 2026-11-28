import { Check, MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { Button, cx } from '@scbrowser/ui'
import type { CoderQuestion, CoderQuestionAnswer } from '@scbrowser/shared'

export interface QuestionCardProps {
  questions: CoderQuestion[]
  /** Undefined while waiting; null when closed without answering; else what was picked per question. */
  answers: CoderQuestionAnswer[] | null | undefined
  onAnswer: (answers: CoderQuestionAnswer[] | null) => void
  /** Who's asking, for the card's heading. */
  asker?: string
  /** The words of the button that closes it unanswered. */
  skipLabel?: string
}

/** A short line of what was answered, once it has been. */
function Answered({ questions, answers }: { questions: CoderQuestion[]; answers: CoderQuestionAnswer[] | null }) {
  return (
    <section aria-label="Your answers" className="flex flex-col gap-1 rounded-lg border border-border px-2.5 py-2 text-xs">
      {answers === null ? (
        <p className="flex items-center gap-2 text-text-muted">
          <MessageCircleQuestion aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          <span className="min-w-0 truncate">Skipped: {questions.map((question) => question.question).join(' · ')}</span>
        </p>
      ) : (
        questions.map((question, index) => (
          <p key={index} className="flex min-w-0 items-baseline gap-2">
            <Check aria-hidden size={12} strokeWidth={2} className="shrink-0 translate-y-0.5 text-success" />
            <span className="min-w-0 flex-1">
              <span className="text-text-muted">{question.question}</span> <span className="font-medium">{(answers[index] ?? []).join(', ') || 'Skipped'}</span>
            </span>
          </p>
        ))
      )}
    </section>
  )
}

/**
 * Questions the AI asks, each with choices and room to write something else. One at a time when
 * there are several, with their headers as tabs. Shared by Terra Code and the assistant's chat.
 */
export function QuestionCard({ questions, answers, onAnswer, asker = 'A question for you', skipLabel = 'Skip' }: QuestionCardProps) {
  const [tab, setTab] = useState(0)
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''))
  const [otherOn, setOtherOn] = useState<boolean[]>(() => questions.map((question) => question.options.length === 0))
  if (answers !== undefined) return <Answered questions={questions} answers={answers} />

  const question = questions[tab]!
  const many = questions.length > 1
  const answerFor = (index: number) => [...(picked[index] ?? []), ...(otherOn[index] && other[index]?.trim() ? [other[index]!.trim()] : [])]
  const has = (index: number) => answerFor(index).length > 0
  const last = tab === questions.length - 1
  const choose = (label: string) => {
    setPicked((current) => current.map((list, index) => (index !== tab ? list : question.multiSelect ? (list.includes(label) ? list.filter((one) => one !== label) : [...list, label]) : [label])))
    if (!question.multiSelect) setOtherOn((current) => current.map((on, index) => (index === tab ? false : on)))
  }
  const chooseOther = () => {
    setOtherOn((current) => current.map((on, index) => (index === tab ? (question.multiSelect ? !on : true) : on)))
    if (!question.multiSelect) setPicked((current) => current.map((list, index) => (index === tab ? [] : list)))
  }
  const submit = () => onAnswer(questions.map((_, index) => answerFor(index)))
  const next = () => (last ? submit() : setTab(tab + 1))
  const kind = question.multiSelect ? 'checkbox' : 'radio'

  return (
    <section role="group" aria-label={asker} className="flex flex-col gap-2.5 rounded-lg border border-border-strong bg-surface p-2.5">
      <div className="flex min-w-0 items-center gap-2 px-0.5 text-xs text-text-muted">
        <MessageCircleQuestion aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">{asker}</span>
        {many && (
          <span className="shrink-0 tabular-nums">
            {tab + 1} of {questions.length}
          </span>
        )}
      </div>
      {many && (
        <div role="tablist" aria-label="Questions" className="flex flex-wrap gap-1">
          {questions.map((one, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === tab}
              onClick={() => setTab(index)}
              className={cx('flex h-6 items-center gap-1.5 rounded-md border px-2 text-2xs transition-colors', index === tab ? 'border-border-strong bg-surface-hover font-medium text-text' : 'border-border text-text-muted hover:text-text')}
            >
              {has(index) && <Check aria-hidden size={10} strokeWidth={2.5} className="text-success" />}
              {one.header}
            </button>
          ))}
        </div>
      )}
      <p className="px-0.5 text-sm font-medium text-text">{question.question}</p>
      <div role={kind === 'radio' ? 'radiogroup' : 'group'} aria-label={question.question} className="flex flex-col gap-1">
        {question.options.map((option) => {
          const on = picked[tab]?.includes(option.label) ?? false
          return (
            <button
              key={option.label}
              type="button"
              role={kind}
              aria-checked={on}
              onClick={() => choose(option.label)}
              className={cx('flex min-w-0 items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover')}
            >
              <Mark kind={kind} on={on} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium text-text">{option.label}</span>
                {option.description && <span className="text-2xs text-text-muted">{option.description}</span>}
              </span>
            </button>
          )
        })}
        <div className={cx('flex min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-1.5 transition-colors', otherOn[tab] ? 'border-accent bg-accent-soft' : 'border-border')}>
          <button type="button" role={kind} aria-checked={otherOn[tab] ?? false} aria-label="Something else" onClick={chooseOther} className="flex shrink-0">
            <Mark kind={kind} on={otherOn[tab] ?? false} />
          </button>
          <input
            value={other[tab] ?? ''}
            aria-label="Your own answer"
            placeholder={question.options.length ? 'Something else…' : 'Your answer…'}
            onFocus={() => !otherOn[tab] && chooseOther()}
            onChange={(event) => {
              const value = event.target.value
              setOther((current) => current.map((text, index) => (index === tab ? value : text)))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && has(tab)) {
                event.preventDefault()
                next()
              }
            }}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-faint"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="ghost" onClick={() => onAnswer(null)}>
          {skipLabel}
        </Button>
        {many && !last && (
          <Button variant="ghost" onClick={submit} disabled={!questions.some((_, index) => has(index))}>
            Answer now
          </Button>
        )}
        <Button variant="primary" onClick={next} disabled={!has(tab)}>
          {last ? 'Answer' : 'Next'}
        </Button>
      </div>
    </section>
  )
}

function Mark({ kind, on }: { kind: 'radio' | 'checkbox'; on: boolean }) {
  return (
    <span aria-hidden className={cx('mt-px grid size-3.5 shrink-0 place-items-center border transition-colors', kind === 'radio' ? 'rounded-full' : 'rounded-sm', on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-surface')}>
      {on && (kind === 'radio' ? <span className="size-1.5 rounded-full bg-on-accent" /> : <Check size={9} strokeWidth={3} />)}
    </span>
  )
}
