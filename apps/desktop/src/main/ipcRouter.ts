import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

type Listener = (event: IpcMainInvokeEvent, ...args: never[]) => unknown

const routes = new Map<string, Map<WebContents, Listener>>()

/**
 * Electron allows one handler per channel in a process, but every window has its own browser UI
 * and overlay asking on the same channels. Each call goes to the one registered for its sender,
 * and anything else is refused, which also makes this the check that the sender is ours.
 */
export function route(owner: WebContents, channel: string, listener: Listener): void {
  let owners = routes.get(channel)
  if (!owners) {
    const created = new Map<WebContents, Listener>()
    owners = created
    routes.set(channel, created)
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const handler = created.get(event.sender)
      if (!handler) throw new Error(`Rejected ${channel} from untrusted sender`)
      return handler(event, ...(args as never[]))
    })
  }
  owners.set(owner, listener)
}

export function unroute(owner: WebContents): void {
  for (const owners of routes.values()) owners.delete(owner)
}
