import type { PermissionRequest, Session, WebContents } from 'electron'
import type { PermissionPrompt, SitePermission, TabId } from '@scbrowser/shared'
import type { PermissionsRepo } from './storage/permissions'

interface Pending {
  prompt: PermissionPrompt
  tabId: TabId | null
  respond: (allow: boolean) => void
}

/** Harmless capabilities that pages get without being asked. */
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock'])

/** Maps Chromium's permission names to the ones shown to people; null means not promptable. */
export function toSitePermissions(permission: string, mediaTypes: readonly string[] = []): SitePermission[] | null {
  switch (permission) {
    case 'media': {
      const wanted: SitePermission[] = []
      if (mediaTypes.includes('video')) wanted.push('camera')
      if (mediaTypes.includes('audio')) wanted.push('microphone')
      return wanted.length > 0 ? wanted : null
    }
    case 'geolocation':
      return ['location']
    case 'notifications':
      return ['notifications']
    case 'clipboard-read':
      return ['clipboard']
    case 'midi':
    case 'midiSysex':
      return ['midi']
    default:
      return null
  }
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

interface PermissionServiceOptions {
  tabIdFor: (contents: WebContents) => TabId | null
  /** Each window shows the question belonging to its own open tab. */
  windows: () => { activeTabId: TabId | null; show: (prompt: PermissionPrompt | null) => void }[]
  /** A page tried to open another app. Refused here, then asked about and opened separately. */
  onExternal: (contents: WebContents, url: string, requester: string) => void
}

export class PermissionService {
  private readonly pending: Pending[] = []
  private nextRequestId = 1

  constructor(
    private readonly repo: PermissionsRepo,
    private readonly options: PermissionServiceOptions
  ) {}

  /** Applies these rules to a session; containers each have their own. */
  attach(session: Session): void {
    const { repo, options } = this
    session.setPermissionRequestHandler((contents, permission, respond, details) => {
      if (ALWAYS_ALLOWED.has(permission)) return respond(true)
      if (permission === 'openExternal') {
        respond(false)
        const { externalURL } = details as PermissionRequest & { externalURL?: string }
        if (externalURL) options.onExternal(contents, externalURL, details.requestingUrl)
        return
      }
      const mediaTypes = (details as PermissionRequest & { mediaTypes?: string[] }).mediaTypes
      const wanted = toSitePermissions(permission, mediaTypes)
      const origin = originOf(details.requestingUrl)
      if (!wanted || !origin || !/^https?:/.test(origin)) return respond(false)

      const decisions = wanted.map((p) => repo.get(origin, p))
      if (decisions.includes(false)) return respond(false)
      if (decisions.every((d) => d === true)) return respond(true)

      const entry: Pending = {
        prompt: { requestId: this.nextRequestId++, origin, permissions: wanted },
        tabId: options.tabIdFor(contents),
        respond
      }
      this.pending.push(entry)
      contents.once('destroyed', () => this.drop(entry))
      this.refresh()
    })

    session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
      const wanted = toSitePermissions(permission, details.mediaType ? [details.mediaType] : [])
      const origin = originOf(requestingOrigin)
      if (!wanted || !origin) return true
      const decisions = wanted.map((p) => repo.get(origin, p))
      // Notifications send without a further request, so they need an explicit yes.
      if (permission === 'notifications') return decisions.every((d) => d === true)
      return !decisions.includes(false)
    })
  }

  decide(requestId: number, allow: boolean): void {
    const entry = this.pending.find((p) => p.prompt.requestId === requestId)
    if (!entry) return
    for (const permission of entry.prompt.permissions) this.repo.set(entry.prompt.origin, permission, allow)
    this.drop(entry)
    entry.respond(allow)
  }

  /** Re-evaluates which prompt to show, e.g. after switching tabs. */
  refresh(): void {
    for (const { activeTabId, show } of this.options.windows()) show(this.pending.find((p) => p.tabId === activeTabId)?.prompt ?? null)
  }

  private drop(entry: Pending): void {
    const index = this.pending.indexOf(entry)
    if (index !== -1) this.pending.splice(index, 1)
    this.refresh()
  }
}
