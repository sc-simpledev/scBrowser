import type { AuthInfo, AuthenticationResponseDetails, WebContents } from 'electron'
import type { TabId } from '@scbrowser/shared'

export interface AuthPrompt {
  requestId: number
  host: string
  realm: string
  insecure: boolean
}

interface Pending {
  prompt: AuthPrompt
  tabId: TabId | null
  respond: (username?: string, password?: string) => void
}

interface HttpAuthOptions {
  tabIdFor: (contents: WebContents) => TabId | null
  activeTabId: () => TabId | null
  onPromptChanged: (prompt: AuthPrompt | null) => void
}

/** Sites and proxies asking for a password. Nothing is stored, so Chromium asks again next session. */
export class HttpAuthService {
  private readonly pending: Pending[] = []
  private nextRequestId = 1

  constructor(private readonly options: HttpAuthOptions) {}

  ask(contents: WebContents, details: AuthenticationResponseDetails, info: AuthInfo, respond: Pending['respond']): void {
    const address = new URL(details.url)
    const entry: Pending = {
      prompt: {
        requestId: this.nextRequestId++,
        host: info.isProxy ? `Proxy ${info.host}:${info.port}` : address.host,
        realm: info.realm,
        insecure: !info.isProxy && address.protocol === 'http:'
      },
      tabId: this.options.tabIdFor(contents),
      respond
    }
    this.pending.push(entry)
    // Leaving the page drops the question, so it can't appear over a different site.
    const abandon = () => {
      this.drop(entry)
      contents.off('did-navigate', abandon)
    }
    contents.once('did-navigate', abandon)
    contents.once('destroyed', abandon)
    this.refresh()
  }

  answer(requestId: number, login: { username: string; password: string } | null): void {
    const entry = this.pending.find((p) => p.prompt.requestId === requestId)
    if (!entry) return
    this.drop(entry)
    if (login) entry.respond(login.username, login.password)
    else entry.respond()
  }

  refresh(): void {
    const active = this.options.activeTabId()
    this.options.onPromptChanged(this.pending.find((p) => p.tabId === active)?.prompt ?? null)
  }

  private drop(entry: Pending): void {
    const index = this.pending.indexOf(entry)
    if (index !== -1) this.pending.splice(index, 1)
    this.refresh()
  }
}
