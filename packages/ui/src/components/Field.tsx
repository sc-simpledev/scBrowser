import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { cx } from '../cx'

const control =
  'h-8 rounded-md border border-border bg-field px-2.5 text-sm text-text outline-none placeholder:text-text-faint ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return <input ref={ref} spellCheck={false} className={cx(control, className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref
) {
  return <select ref={ref} className={cx(control, className)} {...rest} />
})

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
        checked ? 'bg-accent' : 'bg-border-strong'
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-1 transition-transform',
          checked && 'translate-x-4'
        )}
      />
    </button>
  )
}
