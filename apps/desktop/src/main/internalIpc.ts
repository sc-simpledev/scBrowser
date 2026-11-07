import { readFile, writeFile } from 'node:fs/promises'
import { app, dialog, ipcMain, session, shell, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { buildSuggestions, DEFAULT_SETTINGS, highlightsReportPrompt, isCitationSource, isCitationTarget, isWatchInterval, MAX_HIGHLIGHTS, MAX_NOTE_CHARS, READING_SUMMARY_PROMPT, engineById, IDENTITY_FIELDS, isHttpUrl, isPrintChoice, type Identity, type DownloadAction, type InternalCommands, type PermissionDecision, type Skill } from '@scbrowser/shared'
import type { AiService } from './ai/service'
import type { BrowserCore } from './browserCore'
import type { SiteBlocker } from './blocker'
import type { AiStore, ProviderInput } from './ai/store'
import type { DownloadManager } from './downloads'
import type { ExtensionManager } from './extensions'
import { readBackground, removeBackground, saveBackground } from './internal/background'
import { isAssistantRequest, isTurns } from './ipc'
import { allowBasicPdf, fetchPdf, pdfSource } from './internal/pdf'
import { readFlags, setFlag } from './flags'
import { listPrinters, printWith } from './printing'
import { fetchSearchSuggestions } from './omnibox/searchSuggestions'
import { listProfiles, openProfile } from './profiles'
import { availableSources, readSource } from './import/browsers'
import { isPrivate } from './private'
import type { PrivacyService } from './privacy/service'
import type { PasswordEntry } from '@scbrowser/shared'
import { isReportSave, saveReport } from './reportExport'
import { isFileSave, isPreviewRequest, saveFile, storePreview } from './filePreview'
import type { Reporter } from './reporter'
import type { SettingsStore } from './settings'
import type { BookmarksRepo } from './storage/bookmarks'
import type { ChatsRepo } from './storage/chats'
import type { HistoryRepo } from './storage/history'
import type { PermissionsRepo } from './storage/permissions'
import type { SyncService } from './sync'
import type { TabManager } from './tabs/TabManager'
import type { UpdateService } from './updater'
import { copySecret } from './passwordFill'
import { LEAK_RANGE_URL } from './totp'
import iconPath from '../../build/icon.png?asset'
import { samePage } from './citations'
import { withHiddenPage } from './hiddenPage'
import { extractContext } from './ai/pageText'
import { trimPage, withContext } from '@scbrowser/ai'
import type { PasswordVault } from './passwords'
import type { VpnService } from './vpn'

import { endTask, taskList } from './tasks'

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
  core: BrowserCore
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
  passwords: PasswordVault
  updates: UpdateService
  /** The intro's tab takes over the window, or gives it back. */
  setIntro: (tabId: number | null) => void
}

const text = (value: unknown, max = 8192): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Expected a string')
  return value
}
const int = (value: unknown): number => {
  if (!Number.isInteger(value)) throw new Error('Expected an integer')
  return value as number
}

/** Through the browser's own session, so it takes the VPN like a page would. Padding hides how many matches came back. */
async function fetchLeakRange(prefix: string): Promise<string> {
  const response = await session.defaultSession.fetch(`${LEAK_RANGE_URL}${prefix}`, { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`The leak check service answered ${response.status}. Try again later.`)
  return response.text()
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

type Dispatch = (event: IpcMainInvokeEvent, channel: unknown, args: unknown[]) => unknown
/** One per window. A page's calls go to the window holding its tab. */
const dispatchers = new Map<TabManager, Dispatch>()

export function registerInternalIpc(services: InternalServices): () => void {
  const { core, window, tabs, settings, history, bookmarks, downloads, permissions, onBookmarksChanged, aiStore, ai, chats, privacy, extensions, sync, reporter, blocker, vpn, passwords, updates, setIntro } = services

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
      if (!/^(https?|file|javascript):/i.test(address)) throw new Error('Use a web address.')
      bookmarks.edit(int(id), text(title, 1024), address)
      onBookmarksChanged()
    },
    'bookmarks:set-group': (id, groupId) => {
      bookmarks.setGroup(int(id), groupId === null ? null : int(groupId))
      onBookmarksChanged()
    },
    'bookmarks:groups': () => bookmarks.groups(),
    'bookmarks:move-group': (id, parentId) => {
      bookmarks.moveGroup(int(id), parentId === null ? null : int(parentId))
      onBookmarksChanged()
    },
    'bookmarks:add-group': (name, parentId) => {
      const id = bookmarks.addGroup(text(name, 80), parentId === null ? null : int(parentId))
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
    'tasks:list': () => taskList(core),
    'tasks:end': (pid) => endTask(core, int(pid)),
    'apps:list': () => core.webApps.list(),
    'apps:open': (url) => {
      const address = text(url)
      if (/^https?:/i.test(address)) core.openWindow({ kind: 'app', urls: [address] })
    },
    'apps:remove': (id) => core.webApps.remove(text(id, 64)),
    'spelling:languages': () => (process.platform === 'darwin' ? [] : session.defaultSession.availableSpellCheckerLanguages),
    'permissions:list': (): PermissionDecision[] => permissions.list(),
    'permissions:revoke': (origin, permission) => permissions.revoke(text(origin, 2048), text(permission, 64)),
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
    'browser:is-private': () => isPrivate,
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
    'ai:send': async (streamId, request) => {
      if (!isAssistantRequest(request)) throw new Error('Invalid request')
      const sender = caller
      // Tabs picked for research may be asleep, and a page has to be loaded to be read.
      await Promise.all(request.extraTabIds.map((id) => (tabs.contentsFor(id) ? undefined : tabs.wakeInBackground(id))))
      void ai.send(
        text(streamId, 64),
        request,
        (event) => {
          if (sender && !sender.isDestroyed()) sender.send('ai:event', event)
        },
        { files: !!sender && sender.getURL().startsWith('sc://assistant') }
      )
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
    'extensions:set-enabled': (id, enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Expected true or false')
      return extensions.setEnabled(text(id, 64), enabled)
    },
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
    'newtab:suggest': async (query) => {
      const input = text(query, 1024)
      const { searchEngine, searchSuggestions, suggestionSources } = settings.get()
      const engine = engineById(searchEngine)
      const phrases = searchSuggestions ? await fetchSearchSuggestions(input, engine).catch(() => []) : []
      return buildSuggestions(input, {
        history: history.search(input),
        bookmarks: bookmarks.list(),
        tabs: [],
        activeTabId: null,
        searchSuggestions: phrases,
        engine,
        assistantReady: false,
        sources: suggestionSources.filter((source) => source === 'history' || source === 'bookmarks')
      })
    },
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
    'passwords:state': () => passwords.state(),
    'autofill:list': () => passwords.identities(),
    'autofill:save': (input) => {
      const given = (input ?? {}) as Record<string, unknown>
      return passwords.saveIdentity({
        ...(given.id === undefined ? {} : { id: text(given.id, 64) }),
        ...(Object.fromEntries(IDENTITY_FIELDS.map(({ key }) => [key, text(given[key], 512)])) as Omit<Identity, 'id'>)
      })
    },
    'autofill:remove': (id) => passwords.removeIdentity(text(id, 64)),
    'passwords:create': (master) => passwords.create(text(master, 1024)),
    'passwords:set-master': (next) => passwords.setMaster(text(next, 1024)),
    'passwords:remove-master': (current) => passwords.removeMaster(text(current, 1024)),
    'passwords:unlock': (master) => passwords.unlock(text(master, 1024)),
    'passwords:lock': () => passwords.lock(),
    'passwords:change-master': (current, next) => passwords.changeMaster(text(current, 1024), text(next, 1024)),
    'passwords:reset': () => passwords.reset(),
    'passwords:list': () => passwords.list(),
    'passwords:reveal': (id) => passwords.reveal(text(id, 64)),
    'passwords:save': (entry) => {
      const { id, url, username, password, note, totp } = (entry ?? {}) as Partial<PasswordEntry>
      return passwords.saveEntry({
        ...(id === undefined ? {} : { id: text(id, 64) }),
        url: text(url, 2048),
        username: text(username, 1024),
        password: text(password, 4096),
        note: text(note, 1024),
        ...(totp === undefined ? {} : { totp: text(totp, 2048) })
      })
    },
    'passwords:remove': (id) => passwords.remove(text(id, 64)),
    'passwords:copy': (id) => copySecret(passwords.reveal(text(id, 64))),
    'passwords:totp': (id) => passwords.totp(text(id, 64)),
    'passwords:copy-totp': (id) => copySecret(passwords.totp(text(id, 64)).code),
    'passwords:check-leaks': () => passwords.checkLeaks(fetchLeakRange),
    'passwords:leak-status': () => passwords.leakStatus(),
    'passwords:import': async () => {
      const picked = await dialog.showOpenDialog(window as Electron.BrowserWindow, { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })
      const path = picked.filePaths[0]
      if (picked.canceled || !path) return null
      return passwords.importCsv(await readFile(path, 'utf8'))
    },
    'passwords:export': async () => {
      const result = await dialog.showSaveDialog(window as Electron.BrowserWindow, { defaultPath: 'scTerra passwords.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, passwords.exportCsv(), { mode: 0o600 })
      return true
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
    'vpn:set-enabled': (enabled) => (enabled === true ? vpn.turnOn() : vpn.setEnabled(false)),
    'vpn:set-route': async (scope, method) => {
      settings.set({ vpnScope: scope === 'computer' ? 'computer' : 'browser', vpnMethod: method === 'tun' ? 'tun' : 'proxy' })
      if (vpn.summary().enabled) await vpn.setEnabled(true)
    },
    'vpn:ping': (ids) => {
      if (!Array.isArray(ids) || ids.length > 20_000) throw new Error('Too many connections')
      void vpn.ping(ids.map((id) => text(id, 64)), settings.get().vpnPingTimeout)
    },
    'vpn:ping-stop': () => vpn.stopPing(),
    'vpn:ping-progress': () => vpn.pingProgress(),
    'files:preview': (...args) => {
      if (!isPreviewRequest(args)) throw new Error('Invalid file')
      return storePreview(...args)
    },
    'files:save': (...args) => {
      if (!isFileSave(args)) throw new Error('Invalid file')
      return saveFile(window, ...args)
    },
    'report:save': (...args) => {
      if (!isReportSave(args)) throw new Error('Invalid report')
      return saveReport(window, ...args)
    },
    'tabs:research-list': () =>
      tabs
        .snapshot()
        .tabs.filter((tab) => /^(https?|file):/i.test(tab.url))
        .map(({ id, title, url, isSleeping }) => ({ id, title, url, isSleeping })),
    'ai:open-source': (source, target) => {
      if (!isCitationSource(source) || !isCitationTarget(target)) throw new Error('Invalid source')
      core.openSource(source, target)
    },
    'watch:list': () => (core.watcher?.list() ?? []).map(({ lastText: _text, ...watch }) => watch),
    'watch:check': (id) => core.watcher?.check(text(id, 64)),
    'watch:remove': (id) => core.watcher?.remove(text(id, 64)),
    'watch:set-interval': (id, everyMinutes) => {
      if (!isWatchInterval(everyMinutes)) throw new Error('Invalid interval')
      core.watcher?.setInterval(text(id, 64), everyMinutes)
    },
    'watch:seen': (id) => core.watcher?.markSeen(id === null ? undefined : text(id, 64)),
    'archive:list': () => core.archive.list(),
    'archive:restore': (id) => {
      const found = core.archive.take(text(id, 64))
      if (found && /^(https?|file):/i.test(found.url)) tabs.create(found.url, { container: found.container })
    },
    'archive:remove': (id) => void core.archive.take(text(id, 64)),
    'archive:clear': () => core.archive.clear(),
    'highlights:list': () => core.highlights?.list() ?? [],
    'highlights:note': (id, note) => core.highlights?.setNote(text(id, 64), text(note, MAX_NOTE_CHARS)),
    'highlights:remove': (id) => core.highlights?.remove(text(id, 64)),
    'highlights:open': (id) => {
      const found = core.highlights?.list().find((highlight) => highlight.id === text(id, 64))
      if (found && /^(https?|file):/i.test(found.url)) core.openSource({ tabId: null, url: found.url }, { quote: found.text, seconds: null })
    },
    'highlights:report': (ids) => {
      if (!Array.isArray(ids) || ids.length > MAX_HIGHLIGHTS) throw new Error('Too many highlights')
      const wanted = new Set(ids.map((id) => text(id, 64)))
      const chosen = (core.highlights?.list() ?? []).filter((highlight) => wanted.has(highlight.id))
      const tab = caller && tabs.tabIdFor(caller)
      if (chosen.length === 0 || !tab) return
      ai.setPendingPrompt(highlightsReportPrompt(chosen))
      tabs.navigate(tab, 'sc://assistant')
    },
    'mini-apps:keep': (name, content) => {
      if (!isFileSave([name, content])) throw new Error('Invalid file')
      // Only sc://assistant writes files, so only it can keep one.
      if (!caller?.getURL().startsWith('sc://assistant')) throw new Error('Only the assistant can keep apps.')
      return core.miniApps.keep(name as string, content as string).name
    },
    'mini-apps:list': () => core.miniApps.list().map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    'mini-apps:open': (id) => core.miniApps.launch(text(id, 64), process.platform === 'darwin' ? undefined : iconPath),
    'mini-apps:remove': (id) => core.miniApps.remove(text(id, 64)),
    'reading:list': () => core.readingList?.list() ?? [],
    'reading:open': (id) => {
      const item = core.readingList?.get(text(id, 64))
      if (!item || !/^(https?|file):/i.test(item.url)) return
      core.readingList!.patch(item.id, { readAt: item.readAt ?? Date.now() })
      tabs.create(item.url, { afterId: tabs.active?.id })
    },
    'reading:set-read': (id, read) => core.readingList?.patch(text(id, 64), { readAt: read === true ? Date.now() : null }),
    'reading:remove': (id) => core.readingList?.remove(text(id, 64)),
    'reading:summarise': async (id) => {
      const item = core.readingList?.get(text(id, 64))
      if (!item) throw new Error("That page isn't on the list any more.")
      if (URL.canParse(item.url) && aiStore.disabledHosts().includes(new URL(item.url).host)) throw new Error('AI is off for this site.')
      // A tab already showing it saves loading it again.
      const open = tabs.allContents().find((contents) => samePage(contents.getURL(), item.url))
      const page = open ? await extractContext(open) : await withHiddenPage(item.url, extractContext)
      if (!page?.text.trim()) throw new Error("Couldn't find an article on that page.")
      const [message] = withContext([{ role: 'user', content: 'Summarise this article.' }], [{ ...page, ...trimPage(page.text, 60_000) }], null)
      const summary = (await ai.complete(READING_SUMMARY_PROMPT, message!.content)).trim()
      if (!summary) throw new Error('The AI sent back nothing.')
      core.readingList?.patch(item.id, { summary: summary.slice(0, 4000), ...(page.title && !item.title ? { title: page.title } : {}) })
      return summary
    },
    'updates:state': () => updates.state(),
    'updates:check': () => updates.check(),
    'updates:install': () => updates.install(),
    'welcome:finish': () => {
      const id = caller && tabs.tabIdFor(caller)
      setIntro(null)
      if (id) tabs.navigate(id, '')
    },
    'welcome:replay': () => {
      const id = caller && tabs.tabIdFor(caller)
      if (!id) return
      tabs.navigate(id, 'sc://welcome')
      setIntro(id)
    },
    'pdf:load': async () => {
      const address = caller && pdfSource(caller)
      return address ? fetchPdf(caller!.session, address) : null
    },
    'pdf:save': () => {
      const address = caller && pdfSource(caller)
      if (address) caller!.downloadURL(address)
    },
    'pdf:print': async (choice, pageCount) => {
      const contents = caller
      if (!contents || !tabs.tabIdFor(contents)) return null
      if (choice !== undefined && !isPrintChoice(choice)) throw new Error('Not a print choice')
      const pages = typeof pageCount === 'number' && Number.isInteger(pageCount) && pageCount > 0 && pageCount < 100_000 ? pageCount : 1
      return printWith(contents, window, pages, choice)
    },
    'pdf:printers': () => (caller ? listPrinters(caller) : []),
    'pdf:basic': () => {
      const address = caller && pdfSource(caller)
      if (address) {
        allowBasicPdf(address)
        void caller!.loadURL(address)
      }
    }
  }

  const dispatch: Dispatch = (event, channel, args) => {
    if (typeof channel !== 'string' || !Object.hasOwn(handlers, channel)) throw new Error('Unknown internal channel')
    caller = event.sender
    return handlers[channel as keyof InternalCommands](...args)
  }
  if (dispatchers.size === 0) {
    ipcMain.handle(CHANNEL, (event, channel: unknown, ...args: unknown[]) => {
      const owner = [...dispatchers].find(([windowTabs]) => isTrusted(event, windowTabs))
      if (!owner) throw new Error('Rejected internal call from untrusted page')
      return owner[1](event, channel, args)
    })
  }
  dispatchers.set(tabs, dispatch)
  return () => {
    dispatchers.delete(tabs)
    if (dispatchers.size === 0) ipcMain.removeHandler(CHANNEL)
  }
}
