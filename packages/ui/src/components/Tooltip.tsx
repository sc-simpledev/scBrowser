import * as RadixTooltip from '@radix-ui/react-tooltip'
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent
} from 'react'

export interface TooltipAnchor {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Lets an app draw tooltips somewhere other than an in-document portal — scTerra
 * draws them in a view stacked above web pages. Without a host, Radix is used.
 */
export interface TooltipHost {
  show: (anchor: TooltipAnchor, label: string, shortcut?: string) => void
  hide: () => void
}

const TooltipHostContext = createContext<TooltipHost | null>(null)

const SHOW_DELAY_MS = 500
/** Moving between buttons within this window shows the next tooltip immediately. */
const SKIP_DELAY_MS = 300

let lastHiddenAt = 0

export const TooltipProvider = ({ host = null, children }: { host?: TooltipHost | null; children: ReactNode }) => (
  <TooltipHostContext.Provider value={host}>
    <RadixTooltip.Provider delayDuration={SHOW_DELAY_MS} skipDelayDuration={SKIP_DELAY_MS}>
      {children}
    </RadixTooltip.Provider>
  </TooltipHostContext.Provider>
)

interface TooltipProps {
  label: string
  /** Keyboard shortcut shown after the label, e.g. "Ctrl T". */
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}

type TriggerProps = Record<string, ((event: SyntheticEvent<HTMLElement>) => void) | undefined>

function HostedTooltip({ host, label, shortcut, children }: TooltipProps & { host: TooltipHost }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shown = useRef(false)

  const hide = () => {
    clearTimeout(timer.current)
    if (shown.current) {
      shown.current = false
      lastHiddenAt = Date.now()
      host.hide()
    }
  }
  const scheduleShow = (element: HTMLElement) => {
    clearTimeout(timer.current)
    const show = () => {
      const { x, y, width, height } = element.getBoundingClientRect()
      shown.current = true
      host.show({ x, y, width, height }, label, shortcut)
    }
    if (Date.now() - lastHiddenAt < SKIP_DELAY_MS) show()
    else timer.current = setTimeout(show, SHOW_DELAY_MS)
  }

  useEffect(() => hide, [])

  if (!isValidElement(children)) return <>{children}</>
  const child = children as ReactElement<TriggerProps>
  const chain =
    (name: string, handler: (event: SyntheticEvent<HTMLElement>) => void) => (event: SyntheticEvent<HTMLElement>) => {
      child.props[name]?.(event)
      handler(event)
    }

  return cloneElement(child, {
    onPointerEnter: chain('onPointerEnter', (e) => scheduleShow(e.currentTarget)),
    onPointerLeave: chain('onPointerLeave', hide),
    onPointerDown: chain('onPointerDown', hide),
    onFocus: chain('onFocus', (e) => {
      if (e.currentTarget.matches(':focus-visible')) scheduleShow(e.currentTarget)
    }),
    onBlur: chain('onBlur', hide)
  })
}

export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps) {
  const host = useContext(TooltipHostContext)
  if (host) {
    return (
      <HostedTooltip host={host} label={label} shortcut={shortcut}>
        {children}
      </HostedTooltip>
    )
  }
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content side={side} sideOffset={6}>
          <TooltipBubble label={label} shortcut={shortcut} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

/** The tooltip's visuals, shared by the Radix and hosted renderers. */
export function TooltipBubble({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <div className="sc-tooltip flex items-center gap-2 whitespace-nowrap rounded-md bg-surface px-2 py-1 text-xs text-text shadow-2">
      {label}
      {shortcut && <kbd className="font-sans text-2xs text-text-faint">{shortcut}</kbd>}
    </div>
  )
}
