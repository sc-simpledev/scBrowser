import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from '../cx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

const variants = {
  primary: 'bg-text text-surface hover:opacity-85',
  secondary: 'bg-surface text-text shadow-1 hover:bg-surface-hover',
  ghost: 'text-text-muted hover:bg-surface-hover hover:text-text'
} as const

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'sc-no-drag inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className
      )}
      {...rest}
    />
  )
})
