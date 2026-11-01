import { app, dialog, ipcMain, shell, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { DEFAULT_SETTINGS, isHttpUrl, type DownloadAction, type InternalCommands, type PermissionDecision, type Skill } from '@scbrowser/shared'
import type { AiService } from './ai/service'
import type { SiteBlocker } from './blocker'
import type { AiStore, ProviderInput } from './ai/store'
import type { DownloadManager } from './downloads'
import type { ExtensionManager } from './extensions'
import { readBackground, removeBackground, saveBackground } from './internal/background'
import { isAssistantRequest, isTurns } from './ipc'
import { readFlags, setFlag } from './flags'
import { listProfiles, openProfile } from './profiles'
import { availableSources, readSource } from './import/browsers'
import type { PrivacyService } from './privacy/service'
import type { Reporter } from './reporter'
import type { SettingsStore } from './settings'
import type { BookmarksRepo } from './storage/bookmarks'
import type { ChatsRepo } from './storage/chats'
import type { HistoryRepo } from './storage/history'
import type { PermissionsRepo } from './storage/permissions'
import type { SyncService } from './sync'
import type { TabManager } from './tabs/TabManager'
import type { VpnService } from './vpn'

const CHANNEL = 'internal:call'
const ACTIONS: DownloadAction[] = ['pause', 'resume', 'cancel', 'open', 'show', 'remove']

interface InternalServices {
  window: BaseWindow
  tabs: TabManager
  settings: SettingsStore
  history: HistoryRepo
  bookmarks: BookmarksRepo
  downloads: DownloadManager
  permissions: PermissionsRepo
  onBookmarksChanged: () => void
  aiStore: AiStore
  ai: AiService
  chats: ChatsRepo
  privacy: PrivacyService
  extensions: ExtensionManager
  sync: SyncService
  reporter: Reporter
  blocker: SiteBlocker
  vpn: VpnService
}

const text = (value: unknown, max = 8192): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Expected a string')
  return value
}
const int = (value: unknown): number => {
  if (!Number.isInteger(value)) throw new Error('Expected an integer')
  return value as number
}

const optionalId = (value: unknown): string | null => (value === null ? null : text(value, 64))

function skillList(value: unknown): Skill[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Too many skills')
  return value.map((skill) => {
    const { id, name, prompt } = (skill ?? {}) as Record<string, unknown>
    return { id: text(id, 64), name: text(name, 80), prompt: text(prompt, 4000) }
  })
}

function providerInput(value: unknown): ProviderInput {
  const input = (value ?? {}) as Record<string, unknown>
  if (input.protocol !== 'anthropic' && input.protocol !== 'openai') throw new Error('Unknown protocol')
  if (!Array.isArray(input.models) || input.models.length > 200) throw new Error('Too many models')
  return {
    id: input.id === null ? null : text(input.id, 64),
    name: text(input.name, 128),
    protocol: input.protocol,
    baseUrl: text(input.baseUrl, 2048),
    models: input.models.map((model) => text(model, 256)),
    ...(input.apiKey === undefined ? {} : { apiKey: text(input.apiKey, 4096) }),
    ...(input.headers === undefined ? {} : { headers: text(input.headers, 8192) })
  }
}

export const isDefaultBrowser = () => app.isDefaultProtocolClient('https')

/** Only the top frame of a tab showing an sc:// page may call these. */
function isTrusted(event: IpcMainInvokeEvent, tabs: TabManager): boolean {
  const frame = event.senderFrame
  return !!frame && frame === event.sender.mainFrame && frame.url.startsWith('sc:') && tabs.owns(event.sender)
}

export function registerInternalIpc(services: InternalServices): () => void {
  const { window, tabs, settings, history, bookmarks, downloads, permissions, onBookmarksChanged, aiStore, ai, chats, privacy, extensions, sync, reporter, blocker, vpn } = services

  // Set for each call, so replies go back to the page that asked.
  let caller: WebContents | null = null

  const handlers: { [C in keyof InternalCommands]: (...args: unknown[]) => ReturnType<InternalCommands[C]> | Promise<Awaited<ReturnType<InternalCommands[C]>>> } = {
    'settings:get': () => ({ ...DEFAULT_SETTINGS, ...settings.get() }),
    'settings:set': (patch) => {
      const previous = settings.get().newTab
      settings.set(patch)
      // The picture stays on disk only while it's in use.
      if (previous.imageVersion > 0 && settings.get().newTab.imageVersion === 0) void removeBackground()
    },
    'settings:pick-download-dir': async () => {
      const result = await dialog.showOpenDialog(window as Electron.BrowserWindow, { properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    'history:list': (query, limit, offset) => history.list(text(query, 1024), Math.min(int(limit), 500), int(offset)),
    'history:delete': (url) => history.delete(text(url)),
    'history:clear': () => history.clear(),
    'bookmarks:list': () => bookmarks.list(),
    'bookmarks:rename': (id, title) => {
      bookmarks.rename(int(id), text(title, 1024))
      onBookmarksChanged()
    },
    'bookmarks:remove': (id) => {
      bookmarks.remove(int(id))
      onBookmarksChanged()
    },
    'bookmarks:edit': (id, title, url) => {
      const address = text(url)
      if (!/^(https?|file):/i.test(address)) throw new Error('Use a web address.')
      bookmarks.edit(int(id), text(title, 1024), address)
      onBookmarksChanged()
    },
    'bookmarks:set-group': (id, groupId) => {
      bookmarks.setGroup(int(id), groupId === null ? null : int(groupId))
      onBookmarksChanged()
    },
    'bookmarks:groups': () => bookmarks.groups(),
    'bookmarks:add-group': (name) => {
      const id = bookmarks.addGroup(text(name, 80))
      onBookmarksChanged()
      return id
    },
    'bookmarks:rename-group': (id, name) => {
      bookmarks.renameGroup(int(id), text(name, 80))
      onBookmarksChanged()
    },
    'bookmarks:remove-group': (id) => {
      bookmarks.removeGroup(int(id))
      onBookmarksChanged()
    },
    'downloads:list': () => downloads.list(),
    'downloads:action': (id, action) => {
      if (!ACTIONS.includes(action as DownloadAction)) throw new Error('Unknown download action')
      downloads.act(text(id, 64), action as DownloadAction)
    },
    'downloads:clear': () => downloads.clearFinished(),
    'permissions:list': (): PermissionDecision[] => permissions.list(),
    'permissions:revoke': (origin, permission) => permissions.revoke(text(origin, 2048), text(permission, 32)),
    'browser:is-default': () => isDefaultBrowser(),
    'browser:set-default': () => {
      if (!app.isPackaged) return
      app.setAsDefaultProtocolClient('http')
      app.setAsDefaultProtocolClient('https')
      // Windows only lets people change this themselves in system settings.
      if (process.platform === 'win32') void shell.openExternal('ms-settings:defaultapps')
    },
    'browser:open': (url) => {
      const target = text(url)
      if (/^(https?|sc):/i.test(target)) tabs.create(target, { afterId: tabs.active?.id })
    },
    'browser:version': () => ({
      app: app.getVersion(),
      chromium: process.versions.chrome ?? '',
      electron: process.versions.electron ?? ''
    }),
    'ai:state': () => aiStore.state(),
    'ai:save-provider': (input) => aiStore.save(providerInput(input)),
    'ai:remove-provider': (id) => aiStore.remove(text(id, 64)),
    'ai:models': (id) => ai.models(text(id, 64)),
    'ai:set-role': (role, ref) => {
      const { providerId, model } = (ref ?? {}) as Record<string, unknown>
      if (role !== 'chat' && role !== 'fast') throw new Error('Unknown role')
      aiStore.setRole(role, { providerId: text(providerId, 64), model: text(model, 256) })
    },
    'ai:set-site': (host, disabled) => aiStore.setSiteDisabled(text(host, 512), disabled === true),
    'chats:clear': () => chats.clear(),
    'chats:list': () => chats.list(),
    'chats:get': (id) => chats.get(text(id, 64)),
    'chats:save': (id, turns) => {
      if (!isTurns(turns)) throw new Error('Invalid chat')
      if (settings.get().saveChats) chats.save(text(id, 64), turns)
    },
    'chats:delete': (id) => chats.delete(text(id, 64)),
    'ai:status': () => aiStore.status(),
    'ai:send': (streamId, request) => {
      if (!isAssistantRequest(request)) throw new Error('Invalid request')
      const sender = caller
      void ai.send(text(streamId, 64), request, (event) => {
        if (sender && !sender.isDestroyed()) sender.send('ai:event', event)
      })
    },
    'ai:cancel': (streamId) => ai.cancel(text(streamId, 64)),
    'ai:take-prompt': () => ai.takePendingPrompt(),
    'extensions:list': () => extensions.list(),
    'extensions:add': async () => {
      const result = await dialog.showOpenDialog(window as Electron.BrowserWindow, { properties: ['openDirectory'] })
      const path = result.canceled ? undefined : result.filePaths[0]
      return path ? extensions.add(path) : null
    },
    'extensions:remove': (id) => extensions.remove(text(id, 64)),
    'history:ask': async (query) => {
      const search = await ai.parseHistorySearch(text(query, 500)).catch(() => null)
      return search && history.searchTerms(search.terms, search.after, search.before)
    },
    'ai:enable-hosted': () => aiStore.enableHosted(),
    'ai:save-skills': (skills) => aiStore.saveSkills(skillList(skills)),
    'profiles:list': () => listProfiles(),
    'profiles:open': (name) => openProfile(text(name, 40)),
    'import:sources': () => availableSources(),
    'import:run': (id) => {
      const { bookmarks: imported, history: visits } = readSource(text(id, 32))
      const result = { bookmarks: bookmarks.importMany(imported), history: history.importMany(visits) }
      onBookmarksChanged()
      return result
    },
    'flags:get': () => readFlags(),
    'flags:set': (id, enabled) => setFlag(text(id, 32), enabled === true),
    'browser:restart': () => {
      app.relaunch()
      app.quit()
    },
    'privacy:off-hosts': () => privacy.offHosts(),
    'privacy:toggle-site': (host) => privacy.toggleSite(text(host, 512)),
    'privacy:allow-http': (url) => privacy.allowHttp(text(url)),
    'newtab:pick-background': async () => {
      const result = await dialog.showOpenDialog(window as Electron.BrowserWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }]
      })
      const path = result.canceled ? undefined : result.filePaths[0]
      if (!path) return null
      await saveBackground(path)
      return Date.now()
    },
    'newtab:background': () => readBackground(),
    'newtab:top-sites': (limit) => history.top(Math.min(int(limit), 24)).filter((entry) => isHttpUrl(entry.url)),
    'newtab:go': (input) => {
      const id = caller && tabs.tabIdFor(caller)
      if (id) tabs.navigate(id, text(input))
    },
    'extensions:open-store': () => void tabs.create('https://chromewebstore.google.com/', { afterId: tabs.active?.id }),
    'sync:status': () => sync.status(),
    'sync:pick-folder': async () => {
      const result = await dialog.showOpenDialog(window as Electron.BrowserWindow, { properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    'sync:enable': (folder, passphrase) => sync.enable(text(folder, 4096), text(passphrase, 1024)),
    'sync:disable': () => sync.disable(),
    'sync:run': () => sync.run(),
    'reports:list': () => reporter.list(),
    'reports:clear': () => reporter.clear(),
    'blocker:message': () => blocker.message(),
    'blocker:proceed': (url) => {
      const address = text(url)
      const id = caller && tabs.tabIdFor(caller)
      if (!id || !/^https?:\/\//i.test(address)) throw new Error('Invalid address')
      blocker.pass(address)
      tabs.navigate(id, address)
    },
    'blocker:leave': () => {
      const id = caller && tabs.tabIdFor(caller)
      if (id) tabs.navigate(id, '')
    },
    'vpn:state': () => vpn.state(),
    'vpn:add': (links, groupId) => vpn.add(text(links, 4_000_000), optionalId(groupId)),
    'vpn:subscribe': (url, name) => vpn.subscribe(text(url), text(name, 80)),
    'vpn:refresh': (groupId) => vpn.refresh(text(groupId, 64)),
    'vpn:add-group': (name) => vpn.addGroup(text(name, 80)),
    'vpn:rename-group': (id, name) => vpn.renameGroup(text(id, 64), text(name, 80)),
    'vpn:remove-group': (id) => vpn.removeGroup(text(id, 64)),
    'vpn:move': (id, groupId) => vpn.moveToGroup(text(id, 64), optionalId(groupId)),
    'vpn:remove': (id) => vpn.remove(text(id, 64)),
    'vpn:select': (id) => vpn.select(text(id, 64)),
    'vpn:set-enabled': (enabled) => vpn.setEnabled(enabled === true),
    'vpn:ping': (ids) => {
      if (!Array.isArray(ids) || ids.length > 20_000) throw new Error('Too many connections')
      return vpn.ping(ids.map((id) => text(id, 64)))
    }
  }

  ipcMain.handle(CHANNEL, (event, channel: unknown, ...args: unknown[]) => {
    if (!isTrusted(event, tabs)) throw new Error('Rejected internal call from untrusted page')
    if (typeof channel !== 'string' || !Object.hasOwn(handlers, channel)) throw new Error('Unknown internal channel')
    caller = event.sender
    return handlers[channel as keyof InternalCommands](...args)
  })
  return () => ipcMain.removeHandler(CHANNEL)
}
