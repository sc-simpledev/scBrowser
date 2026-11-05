import { useEffect, useState, type ComponentProps } from 'react'
import { Button } from '@scbrowser/ui'

const CONFIRM_MS = 4000

/** For what can't be undone: the first press asks, and the second does it. It forgets after a few seconds. */
export function ConfirmButton({ onConfirm, confirmLabel = 'Are you sure?', children, ...rest }: Omit<ComponentProps<typeof Button>, 'onClick'> & { onConfirm: () => void; confirmLabel?: string }) {
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const timer = setTimeout(() => setAsking(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [asking])
  return (
    <Button
      {...rest}
      aria-live="polite"
      className={asking ? 'text-danger' : undefined}
      onBlur={() => setAsking(false)}
      onClick={() => {
        if (asking) onConfirm()
        setAsking(!asking)
      }}
    >
      {asking ? confirmLabel : children}
    </Button>
  )
}
