import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../cx'
import { Tooltip } from './Tooltip'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, also used as the tooltip. */
  label: string
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  size?: 'sm' | 'md'
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, side, size = 'md', className, children, ...rest },
  ref
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cx(
          'sc-no-drag inline-flex shrink-0 items-center justify-center rounded-md text-text-muted',
          'transition-colors hover:bg-surface-hover hover:text-text active:bg-surface-active',
          'disabled:pointer-events-none disabled:text-text-faint disabled:opacity-60',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
          size === 'md' ? 'size-8' : 'size-6',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
})
