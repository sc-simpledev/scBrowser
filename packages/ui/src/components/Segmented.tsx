import { cx } from '../cx'

/**
 * A choice of a few options side by side, as in the scSpace style: a thin border round the set and
 * the chosen one filled near-black. `fill` stretches the options to share the width evenly.
 */
export function Segmented<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  disabled,
  fill = true,
  size = 'md'
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
  disabled?: boolean
  fill?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled} className={cx('flex gap-0.5 rounded-md border border-border bg-surface p-[3px]', disabled && 'opacity-50')}>
      {options.map(([option, text]) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cx(
            'rounded-sm px-3 font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
            fill && 'flex-1',
            value === option ? 'bg-text text-surface' : 'text-text-muted hover:bg-surface-hover hover:text-text'
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
