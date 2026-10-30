import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { ChromeCommands, CommandChannel, PageRect } from '@scbrowser/shared'
import type { TabManager } from './tabs/TabManager'

type Handlers = { [C in CommandChannel]: (...args: Parameters<ChromeCommands[C]>) => ReturnType<ChromeCommands[C]> }
type Validators = { [C in CommandChannel]: (args: unknown[]) => args is Parameters<ChromeCommands[C]> }

const isId = (value: unknown): value is number => Number.isInteger(value)
const isRect = (value: unknown): value is PageRect =>
  typeof value === 'object' &&
  value !== null &&
  ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((value as Record<string, unknown>)[k]))

const idArg = (args: unknown[]): args is [number] => args.length === 1 && isId(args[0])

const validators: Validators = {
  'tabs:create': (args): args is [string?] => args.length === 0 || (args.length === 1 && typeof args[0] === 'string'),
  'tabs:close': idArg,
  'tabs:activate': idArg,
  'tabs:navigate': (args): args is [number, string] =>
    args.length === 2 && isId(args[0]) && typeof args[1] === 'string' && args[1].length <= 8192,
  'tabs:back': idArg,
  'tabs:forward': idArg,
  'tabs:reload': idArg,
  'tabs:stop': idArg,
  'tabs:snapshot': (args): args is [] => args.length === 0,
  'layout:page-rect': (args): args is [PageRect] => args.length === 1 && isRect(args[0])
}

/**
 * Registers the chrome UI command handlers. Only the chrome UI's own WebContents may call
 * them, and every argument list is validated before it reaches the TabManager.
 */
export function registerIpc(chromeUi: WebContents, tabs: TabManager): () => void {
  const handlers: Handlers = {
    'tabs:create': (url) => tabs.create(url),
    'tabs:close': (id) => tabs.close(id),
    'tabs:activate': (id) => tabs.activate(id),
    'tabs:navigate': (id, input) => tabs.navigate(id, input),
    'tabs:back': (id) => tabs.back(id),
    'tabs:forward': (id) => tabs.forward(id),
    'tabs:reload': (id) => tabs.reload(id),
    'tabs:stop': (id) => tabs.stop(id),
    'tabs:snapshot': () => tabs.snapshot(),
    'layout:page-rect': (rect) =>
      tabs.setPageRect({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height))
      })
  }

  const channels = Object.keys(handlers) as CommandChannel[]
  for (const channel of channels) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== chromeUi) throw new Error(`Rejected ${channel} from untrusted sender`)
      if (!validators[channel](args)) throw new Error(`Invalid arguments for ${channel}`)
      return (handlers[channel] as (...a: unknown[]) => unknown)(...args)
    })
  }
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel))
}
