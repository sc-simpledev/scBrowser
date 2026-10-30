import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RadixTooltip.Provider delayDuration={500} skipDelayDuration={200}>
    {children}
  </RadixTooltip.Provider>
)

interface TooltipProps {
  label: string
  /** Keyboard shortcut shown after the label, e.g. "Ctrl T". */
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}

export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="sc-tooltip z-50 flex items-center gap-2 rounded-md bg-surface px-2 py-1 text-xs text-text shadow-2"
        >
          {label}
          {shortcut && <kbd className="font-sans text-2xs text-text-faint">{shortcut}</kbd>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
