import { app, shell, type WebContents } from 'electron'
import { appScheme, type AppLinkPromptState } from '@scbrowser/shared'
import type { PermissionsRepo } from './storage/permissions'

interface Pending {
  url: string
  /** A site that can be remembered as allowed, or null if it wasn't a website asking. */
  origin: string | null
  scheme: string
  contents: WebContents | null
  stopWatching: () => void
}

interface AppLinkHooks {
  show: (prompt: Omit<AppLinkPromptState, 'x' | 'y'> | null) => void
  notify: (text: string) => void
  activeContents: () => WebContents | undefined
}

const webOrigin = (url: string | null): string | null => {
  if (!url || !URL.canParse(url)) return null
  const { protocol, origin } = new URL(url)
  return /^https?:$/.test(protocol) ? origin : null
}

/** Links like `claude://` that belong to another app. Nothing opens without the person saying so. */
export class AppLinks {
  private pending: Pending | null = null

  constructor(
    private readonly repo: PermissionsRepo,
    private readonly hooks: AppLinkHooks
  ) {}

  /** `requester` is the page asking, or null when the person entered the address themselves. */
  request(url: string, requester: string | null, contents: WebContents | null): void {
    const scheme = appScheme(url)
    if (!scheme) return
    // A tab in the background can't put a question in front of the one being used.
    if (contents && contents !== this.hooks.activeContents()) return
    const appName = app.getApplicationNameForProtocol(url)
    if (!appName) {
      if (!contents) this.hooks.notify(`No app here opens ${scheme}: links`)
      return
    }
    const origin = webOrigin(requester)
    if (origin && this.repo.get(origin, `app:${scheme}`)) {
      void shell.openExternal(url).catch(() => undefined)
      return
    }
    this.dismiss()
    const stopWatching = this.watch(contents, origin)
    this.pending = { url, origin, scheme, contents, stopWatching }
    this.hooks.show({ url, scheme, appName, host: origin ? new URL(origin).host : null })
  }

  answer(choice: 'open' | 'always' | 'cancel'): void {
    const pending = this.pending
    this.dismiss()
    if (!pending || choice === 'cancel') return
    if (choice === 'always' && pending.origin) this.repo.set(pending.origin, `app:${pending.scheme}`, true)
    void shell.openExternal(pending.url).catch(() => undefined)
  }

  /** The question goes with the tab or site that asked it, so it can't sit over another one. */
  dismiss(): void {
    if (!this.pending) return
    this.pending.stopWatching()
    this.pending = null
    this.hooks.show(null)
  }

  /** Called when the person moves to another tab. */
  activeChanged(): void {
    if (this.pending?.contents && this.pending.contents !== this.hooks.activeContents()) this.dismiss()
  }

  private watch(contents: WebContents | null, origin: string | null): () => void {
    if (!contents) return () => undefined
    const navigated = (_event: unknown, url: string) => {
      if (webOrigin(url) !== origin) this.dismiss()
    }
    const destroyed = () => this.dismiss()
    contents.on('did-navigate', navigated)
    contents.once('destroyed', destroyed)
    return () => {
      if (contents.isDestroyed()) return
      contents.off('did-navigate', navigated)
      contents.off('destroyed', destroyed)
    }
  }
}
