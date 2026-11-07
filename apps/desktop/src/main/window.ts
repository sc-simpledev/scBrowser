import { randomFillSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, Menu, nativeTheme, shell, type Rectangle } from 'electron'
import { NATIVE_THEME } from '@scbrowser/ui/native-theme'
import iconPath from '../../build/icon.png?asset'
import {
  belongsToSite,
  effectiveUrl,
  MAX_HIDDEN_PER_SITE,
  MAX_SIDEBAR_SITES,
  siteOf,
  engineById,
  isJavascriptUrl,
  isTypedAppUrl,
  javascriptUrlCode,
  AUTH_POPUP,
  generatePassword,
  identityName,
  originOf,
  PASSWORD_POPUP,
  PASSWORD_SUGGEST,
  passwordSuggestHeight,
  BOOKMARK_POPUP,
  CLEANUP_POPUP,
  DEFAULT_WORKSPACE,
  suggestCleanup,
  TOAST_POPUP,
  WORKSPACE_POPUP,
  byPing,
  errorPageUrl,
  isReaderUrl,
  summarisePromptFor,
  isNewTabUrl,
  sleepMinutes,
  type Bookmark,
  type PermissionPrompt,
  type Workspace,
  type WorkspaceEdit
} from '@scbrowser/shared'
import type { BrowserActions } from './actions'
import { AiError, GROUP_TABS_PROMPT, groupTabsMessage, parseTabCleanup, parseTabGroups, TAB_CLEANUP_PROMPT } from '@scbrowser/ai'
import { rewriteSelection, togglePageGoogleTranslation, togglePageTranslation } from './ai/pageTools'
import { AiService } from './ai/service'
import type { BrowserCore, BrowserWindowHandle, Send, WindowOptions } from './browserCore'
import { uniquePath } from './downloads'
import { HttpAuthService, type AuthPrompt } from './httpAuth'
import { registerInternalIpc } from './internalIpc'
import { registerIpc } from './ipc'
import { attachPageMenu } from './menus'
import { Overlay } from './overlay'
import { extractArticle } from './ai/pageText'
import { storeArticle } from './internal/reader'
import { currentProfile, DEFAULT_PROFILE } from './profiles'
import { loadExtraSessions, loadSession } from './session'
import { AppLinks } from './appLinks'
import { attachShortcuts } from './shortcuts'
import { fetchIcon } from './siteIcons'
import { isPrivate, openPrivateWindow } from './private'
import { readFlags } from './flags'
import { darkenPage } from './forceDark'
import { rejectCookieBanner, watchConsentFrames } from './cookieBanners'
import { applySiteTweaks, pickElement } from './siteTweaks'
import { LinkPreview } from './linkPreview'
import { SidebarSites } from './sidebarSites'
import { copySecret, fillDetails, fillLogin, fillNewPassword, hasLoginForm, nextLoginField, watchForSignIn, type LoginFieldFocus } from './passwordFill'
import { TabManager } from './tabs/TabManager'

const TABSTRIP_HEIGHT = 40 // keep in sync with --sc-tabstrip-height
const SLEEP_CHECK_MS = Number(process.env.SCB_E2E && process.env.SCB_SLEEP_CHECK_MS) || 60_000
const VPN_MENU_ROWS = 15
const WINDOW_KEY = 'window'
const ZOOM_KEY = 'site-zoom'
const WELCOME_KEY = 'welcome:done'
const WELCOME_URL = 'sc://welcome'
const INTRO_COLORS = { dark: { color: '#000000', symbolColor: '#ffffff' }, light: { color: '#f4f7f8', symbolColor: '#111111' } }
/** How long a just-used login waits to be saved before it's forgotten. */
const RECENT_NAME_MS = 10 * 60_000
const LOGIN_PROMPT_MS = Number(process.env.SCB_E2E && process.env.SCB_LOGIN_HOLD_MS) || 60_000
const CLIPBOARD_WAIT_MS = 2000
const CAPTURE_RETRY_MS = 200
const CAPTURE_ATTEMPTS = 15
const APP_TITLE = isPrivate ? 'scTerra (Private)' : currentProfile() === DEFAULT_PROFILE ? 'scTerra' : `scTerra (${currentProfile()})`

const APP_WINDOW_SIZE = { width: 1100, height: 760 }
const CASCADE = 32
/** A new window opens a little down and across, so both can be seen. */
const cascaded = ({ x, y, width, height }: Rectangle): Rectangle => ({ x: x + CASCADE, y: y + CASCADE, width, height })

const zoomSite = (url: string) => (URL.canParse(url) ? new URL(url).host || url : url)

const nativeColors = () => (nativeTheme.shouldUseDarkColors ? NATIVE_THEME.dark : NATIVE_THEME.light)

interface SavedWindow {
  bounds: Rectangle
  maximized: boolean
}

export function createBrowserWindow(core: BrowserCore, options: WindowOptions = {}): BrowserWindowHandle {
  const { kv, settings, history, bookmarks, aiStore } = core.services
  const { privacy, downloads, blocker, vpn, sync, passwords, updates, extensions, permissionService } = core
  const kind = options.kind ?? 'browser'
  const isApp = kind === 'app'
  const colors = nativeColors()
  const savedWindow = isApp ? undefined : (kv.get(WINDOW_KEY) as SavedWindow | undefined)
  const openBrowsers = core.windows.filter((handle) => handle.kind === 'browser')
  const window = new BrowserWindow({
    ...(options.restore?.bounds ?? (isApp ? APP_WINDOW_SIZE : openBrowsers.length > 0 ? cascaded(openBrowsers.at(-1)!.window.getNormalBounds()) : (savedWindow?.bounds ?? { width: 1320, height: 860 }))),
    minWidth: 520,
    minHeight: 360,
    show: false,
    title: 'scTerra',
    // A Mac takes the icon from the app bundle; elsewhere the window carries its own.
    ...(process.platform === 'darwin' ? {} : { icon: iconPath }),
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.foreground, height: TABSTRIP_HEIGHT },
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const chromeUi = window.webContents

  const send: Send = (channel, ...payload) => {
    if (!chromeUi.isDestroyed()) chromeUi.send(channel, ...payload)
  }
  const publishBookmarks = () => core.publishBookmarks()
  const siteColours = readFlags().includes('site-colours')
  const forceDark = readFlags().includes('force-dark-pages')
  const pageColours = new WeakMap<Electron.WebContents, string | null>()
  /** Cookie banners are left alone where the person turned tracking protection off. */
  const rejectsBanners = (url: string) => settings.get().rejectCookieBanners && /^https?:/i.test(url) && !privacy.isOff(new URL(url).host)
  const translatedInto = new WeakMap<Electron.WebContents, string>()
  const publishSiteColour = () => {
    if (!siteColours) return
    const contents = tabs.active && tabs.contentsFor(tabs.active.id)
    const color = contents ? pageColours.get(contents) : null
    send('ui:site-colour', color && /^#[0-9a-f]{6,8}$/i.test(color) ? color : null)
  }
  const focusOmnibox = () => {
    chromeUi.focus()
    send('ui:focus-omnibox')
  }
  const tabs = new TabManager(window, {
    otherWindow: isApp ? (url, container) => core.browser().tabs.create(url, { container }) : undefined,
    appOrigin: isApp && options.urls?.[0] ? new URL(options.urls[0]).origin : undefined,
    closeWhenEmpty: () => isApp || core.otherBrowserWindowsOpen(),
    devToolsWidth: () => settings.get().devToolsWidth,
    quietMedia: () => settings.get().performanceMode,
    onDevToolsWidth: (devToolsWidth) => settings.set({ devToolsWidth }),
    onDevToolsCreated: (contents) => {
      attachShortcuts(contents, actions)
      overlay.raise()
    },
    onChange: (snapshot) => {
      // Tabs can still report in while the window is being torn down.
      if (window.isDestroyed()) return
      send('tabs:changed', snapshot)
      if (suggestFor && !tabs.shownBounds(suggestFor.contents)) closeSuggest()
      if (!isApp) core.saver.schedule()
      overlay.updateTabSearch(tabs.searchRows())
      const active = snapshot.tabs.find((t) => t.id === snapshot.activeId)
      window.setTitle(isApp ? active?.title || APP_TITLE : `${active?.title ? `${active.title} — ` : ''}${APP_TITLE}`)
    },
    onTabCreated: (contents) => {
      attachShortcuts(contents, actions)
      attachPageMenu(contents, actions, window, (page, params) => extensions.menuItems(page, params))
      extensions.addTab(contents, window)
      contents.on('input-event', (_event, input) => {
        if (input.type === 'mouseMove') overlay.clearTooltip()
        // Typing, scrolling or clicking elsewhere puts the list of logins away. A click into a login field brings it back.
        else if (suggestFor?.contents === contents && (input.type === 'keyDown' || input.type === 'mouseDown' || input.type === 'mouseWheel')) closeSuggest()
      })
      if (vpn.summary().enabled) contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      contents.on('did-finish-load', () => {
        watchTab(contents)
        watchLoginFields(contents)
        void autoFillPassword(contents)
      })
      contents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && suggestFor?.contents === contents) closeSuggest()
      })
      watchConsentFrames(contents, () => rejectsBanners(contents.getURL()))
      if (siteColours) {
        contents.on('did-change-theme-color', (_event, color) => {
          pageColours.set(contents, color)
          publishSiteColour()
        })
      }
      overlay.raise()
    },
    onTabClosed: () => {
      permissionService.refresh()
      httpAuth.refresh()
    },
    // Only focus, not a new selection: the person may already be typing.
    onNewTabLoaded: () => {
      if (!chromeUi.isDestroyed()) chromeUi.focus()
    },
    onAppLink: (contents, url, requester) => appLinks.request(url, requester, contents),
    onPreviewLink: (url, target, container) => {
      if (!settings.get().linkPreview || isApp) return false
      openPreview(url, target, container)
      return true
    },
    onPageRect: () => preview.place(),
    onResizing: (resizing) => {
      preview.setHidden(resizing)
      sidebarSites.setHidden(resizing, 'resizing')
    },
    onActivate: (tab) => {
      // A preview belongs to the page it was opened from.
      preview.close()
      const contents = tabs.contentsFor(tab.id)
      appLinks.activeChanged()
      publishSiteColour()
      if (contents) extensions.selectTab(contents)
      if (isNewTabUrl(tab.url)) focusOmnibox()
      else tabs.focusActive()
      permissionService.refresh()
      httpAuth.refresh()
    },
    // Pages can still report in during shutdown, after the database has closed.
    onVisit: (url) => {
      if (!window.isDestroyed() && !isPrivate) {
        history.recordVisit(url)
        core.readingList?.markVisited(url)
      }
    },
    onPageLoaded: (contents) => void privacy.applyCosmetics(contents),
    onDomReady: (contents) => {
      if (forceDark) void darkenPage(contents)
      void applySiteTweaks(contents, settings.get())
      void core.highlights?.paint(contents)
      if (rejectsBanners(contents.getURL())) rejectCookieBanner(contents)
    },
    onTitle: (url, title) => {
      if (!window.isDestroyed() && !isPrivate) history.updateTitle(url, title)
    },
    // Only sites already bookmarked, so this keeps no record of browsing.
    onFavicon: (contents, pageUrl, iconUrl) => {
      if (!isPrivate && !window.isDestroyed() && core.needsIcon(pageUrl)) void fetchIcon(contents.session, iconUrl).then((icon) => core.storeIcon(pageUrl, icon))
    },
    onFound: (result) => send('find:result', result),
    onFullscreen: (fullscreen) => {
      window.setFullScreen(fullscreen)
      sidebarSites.setHidden(fullscreen, 'fullscreen')
      if (fullscreen) preview.close()
      extensions.setPanelHidden(fullscreen, window)
    },
    newTabPage: (target): string | null => extensions.newTabPage(target),
    engine: () => engineById(settings.get().searchEngine),
    errorUrl: (url, reason) => errorPageUrl(url, reason, privacy.upgradedFrom(url)),
    prepareSession: (target) => core.prepareSession(target),
    onLogin: (contents, details, info, respond) => httpAuth.ask(contents, details, info, respond),
    // Pages can still report in during shutdown, after the database has closed.
    zoomFor: (url) => (window.isDestroyed() ? 1 : ((kv.get(ZOOM_KEY) as Record<string, number> | undefined)?.[zoomSite(url)] ?? 1)),
    onZoom: (url, factor) => {
      if (window.isDestroyed()) return
      const { [zoomSite(url)]: _old, ...others } = (kv.get(ZOOM_KEY) as Record<string, number> | undefined) ?? {}
      kv.set(ZOOM_KEY, factor === 1 ? others : { ...others, [zoomSite(url)]: factor })
    },
    onWorkspaceChange: (next, previous) => {
      if (next.focus !== previous?.focus) settings.set({ focusMode: next.focus })
    }
  }, core.savedWorkspaces())

  const actions: BrowserActions = {
    tabs,
    appWindow: isApp,
    openWindow: (url, container) => void core.openWindow({ urls: url ? [url] : [], container }),
    installApp: () => void installApp(),
    openInBrowser: () => {
      const active = tabs.active
      if (!active) return
      const { tabs: other, window: target } = core.browser()
      other.create(effectiveUrl(active.url), { container: active.container })
      target.focus()
      if (isApp) window.close()
    },
    focusOmnibox,
    openFind: () => {
      chromeUi.focus()
      send('ui:open-find')
    },
    toggleBookmark: () => {
      const active = tabs.active
      if (!active || !/^(https?|file):/.test(effectiveUrl(active.url))) return
      bookmarks.toggle(effectiveUrl(active.url), active.title)
      publishBookmarks()
    },
    toggleBookmarksBar: () => settings.set({ bookmarksBar: settings.get().bookmarksBar === 'always' ? 'bookmarks-page' : 'always' }),
    toggleFullscreen: () => window.setFullScreen(!window.isFullScreen()),
    openPage: (page) => tabs.openInternal(`sc://${page}`),
    toggleAssistant: () => send('ui:assistant-toggle'),
    passwordMenu: () => openPasswordMenu(),
    toggleReader: () => {
      const active = tabs.active
      if (!active) return
      if (isReaderUrl(active.url)) {
        tabs.exitReader(active.id)
        return
      }
      const contents = tabs.contentsFor(active.id)
      if (!contents || !/^https?:/i.test(active.url)) return
      void extractArticle(contents)
        .then((article) => {
          if (contents.isDestroyed()) return
          if (article) void contents.loadURL(storeArticle(article))
          else notify("Reader view can't find an article on this page")
        })
        .catch(() => notify("Reader view can't open this page"))
    },
    togglePalette: () => overlay.togglePalette(),
    searchTabs: () => overlay.toggleTabSearch(tabs.searchRows()),
    openAddress: (id, input) => {
      const address = input.trim()
      if (isTypedAppUrl(address)) {
        appLinks.request(address, null, null)
      } else if (isJavascriptUrl(address)) {
        // The person asked for this, so it's their page to change. Never on scTerra's own pages.
        const contents = tabs.contentsFor(id)
        if (contents && /^(https?|file):/i.test(contents.getURL())) void contents.executeJavaScript(javascriptUrlCode(address), true).catch(() => undefined)
        else notify("Scripts can't run on this page")
      } else {
        tabs.navigate(id, input)
      }
    },
    openAppLink: (url, requester, contents) => appLinks.request(url, requester, contents),
    openFile: () => {
      void dialog
        .showOpenDialog(window as BrowserWindow, {
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Pages and documents', extensions: ['html', 'htm', 'xhtml', 'svg', 'pdf', 'txt', 'md', 'json', 'xml', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
        .then(({ canceled, filePaths }) => {
          if (canceled || window.isDestroyed()) return
          for (const path of filePaths) tabs.create(pathToFileURL(path).toString(), { afterId: tabs.active?.id })
        })
    },
    viewSource: () => {
      const active = tabs.active
      const url = active ? effectiveUrl(active.url) : ''
      if (active && /^(https?|file):/i.test(url)) tabs.create(`view-source:${url}`, { afterId: active.id, container: active.container })
    },
    searchWeb: (text) => {
      const address = engineById(settings.get().searchEngine).template.replace('%s', encodeURIComponent(text))
      tabs.create(address, { afterId: tabs.active?.id, container: tabs.active?.container })
    },
    spellCheck: {
      enabled: () => settings.get().spellCheck,
      toggle: () => settings.set({ spellCheck: !settings.get().spellCheck })
    },
    performanceMode: {
      enabled: () => settings.get().performanceMode,
      toggle: () => {
        const performanceMode = !settings.get().performanceMode
        settings.set({ performanceMode })
        notify(performanceMode ? 'Performance Mode is on' : 'Performance Mode is off')
      }
    },
    organiseTabs: () => void runTask('Organising tabs…', async () => {
      const candidates = tabs
        .snapshot()
        .tabs.filter((tab) => /^https?:/.test(tab.url) && !aiStore.disabledHosts().includes(new URL(tab.url).host))
      if (candidates.length < 2) return 'Open a few more tabs first'
      const groups = parseTabGroups(await ai.complete(GROUP_TABS_PROMPT, groupTabsMessage(candidates)), candidates)
      if (groups.length === 0) return "Couldn't sort these tabs"
      tabs.applyGroups(groups)
      return `Sorted into ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`
    }),
    cleanupTabs: () => void cleanupTabs(),
    autofillRows: (contents) => {
      const { available, exists, unlocked } = passwords.state()
      if (!available || !exists || !/^https?:/i.test(contents.getURL())) return []
      if (!unlocked) return [{ label: 'Fill address or details…', click: () => actions.openPage('passwords') }]
      const identities = passwords.identities()
      const fill = (id: string) => {
        void fillDetails(contents, passwords.identity(id)).then((count) => notify(count > 0 ? `Filled ${count} ${count === 1 ? 'field' : 'fields'}` : 'No empty fields to fill here'))
      }
      if (identities.length === 0) return [{ label: 'Add an address to fill…', click: () => actions.openPage('passwords') }]
      return [{ label: 'Fill address or details', submenu: identities.map((identity) => ({ label: identityName(identity), click: () => fill(identity.id!) })) }]
    },
    translateLanguage: () => settings.get().translateTo,
    translatePage: (language) => {
      if (language) settings.set({ translateTo: language })
      const target = language ?? settings.get().translateTo
      const active = tabs.active
      const contents = active && tabs.contentsFor(active.id)
      if (!contents || !/^https?:/.test(active.url)) return
      const useAi = settings.get().translateEngine === 'ai'
      if (useAi && aiStore.disabledHosts().includes(new URL(active.url).host)) return notify('AI is off for this site')
      const toggle = () => (useAi ? togglePageTranslation(contents, ai, target) : togglePageGoogleTranslation(contents, target))
      void runTask('Translating…', async () => {
        let outcome = await toggle()
        // Asking for another language takes the page there, by way of the original.
        if (outcome === 'restored' && translatedInto.get(contents) !== target) outcome = await toggle()
        if (outcome === 'translated' || outcome === 'partly') translatedInto.set(contents, target)
        if (outcome === 'failed') return useAi ? "Couldn't translate this page" : "Google Translate didn't answer. Try again soon"
        return { restored: 'Showing the original', translated: 'Translated', partly: 'Translated the start of this page' }[outcome]
      })
    },
    rewrite: (contents, text, style) => {
      const url = contents.getURL()
      if (URL.canParse(url) && aiStore.disabledHosts().includes(new URL(url).host)) return notify('AI is off for this site')
      void runTask('Rewriting…', async () =>
        (await rewriteSelection(contents, ai, text, style)) ? 'Rewritten. Undo with Ctrl Z' : 'The selection changed, so nothing was replaced'
      )
    },
    screenshot: () => {
      const contents = tabs.active && tabs.contentsFor(tabs.active.id)
      if (contents) void takeScreenshot(contents).catch(() => notify("Couldn't save the screenshot"))
    },
    askAssistant: (prompt) => send('ui:assistant-prompt', prompt),
    quit: () => app.quit(),
    openPrivateWindow: () => openPrivateWindow(settings.get(), bookmarks.list()),
    installUpdate: () => updates.install(),
    extensionMenu: () => extensions.menu(),
    addToSidebar: () => addSidebarSite(),
    highlight: (contents, text) => {
      const store = core.highlights
      if (!store) return notify('Private windows keep no highlights')
      const url = contents.getURL()
      if (!/^(https?|file):/i.test(url)) return notify('Only web pages can be highlighted')
      try {
        store.add(url, contents.getTitle(), text)
        void store.paint(contents)
        notify('Highlighted. Find it in Highlights')
      } catch (error) {
        notify(error instanceof Error ? error.message : "Couldn't highlight that")
      }
    },
    addToReadingList: () => {
      const list = core.readingList
      const active = tabs.active
      const url = active ? effectiveUrl(active.url) : ''
      if (!list) return notify('Private windows keep no reading list')
      if (!active || !/^(https?|file):/i.test(url)) return notify('Only web pages can go on the reading list')
      const already = list.has(url)
      list.add(url, active.title)
      notify(already ? 'Already on your reading list' : 'Added to your reading list')
    },
    closeGroup: (name, keep) => {
      const saved = tabs.closeGroup(name)
      if (!keep || isPrivate || isApp) return
      if (core.closedGroups.add(name, saved)) notify(`Closed “${name}”. Reopen it from the tab menu`)
    },
    closedGroups: () => (isPrivate ? [] : core.closedGroups.list()),
    reopenGroup: (id) => {
      const group = core.closedGroups.take(id)
      if (group) tabs.openGroup(group.name, group.tabs)
    },
    archiveTab: (id) => {
      if (isPrivate) return notify('Private windows keep no archive')
      const saved = tabs.archiveTab(id)
      if (!saved) return notify("This tab can't be archived")
      core.archive.add([saved], true)
      notify('Archived. Find it in Archived tabs')
    },
    watchPage: (part) => {
      const watcher = core.watcher
      const contents = tabs.active && tabs.contentsFor(tabs.active.id)
      const url = contents?.getURL() ?? ''
      if (!watcher) return notify("Private windows don't watch pages")
      if (!contents || !/^https?:/i.test(url)) return notify('Only websites can be watched')
      const title = contents.getTitle()
      void (part ? pickElement(contents, 'watch') : Promise.resolve(null))
        .then(async (selector) => {
          if (part && !selector) return
          await watcher.add(url, title, selector)
          notify(selector ? 'Watching that part. You’ll be told when it changes' : 'Watching this page. You’ll be told when it changes')
        })
        .catch((error: Error) => notify(error.message))
    },
    previewLink: (url, contents) => {
      if (!/^https?:/i.test(url)) return
      const id = tabs.tabIdFor(contents)
      openPreview(url, contents.session, id === null ? null : (tabs.snapshot().tabs.find((tab) => tab.id === id)?.container ?? null))
    },
    hidePart: () => {
      const contents = tabs.active && tabs.contentsFor(tabs.active.id)
      const url = contents?.getURL() ?? ''
      const site = siteOf(url)
      if (!contents || !site) return notify('Parts can only be hidden on websites')
      void pickElement(contents).then((selector) => {
        if (!selector || contents.isDestroyed() || siteOf(contents.getURL()) !== site) return
        const { hiddenElements } = settings.get()
        const list = hiddenElements[site] ?? []
        if (list.length >= MAX_HIDDEN_PER_SITE) return notify(`A site can have ${MAX_HIDDEN_PER_SITE} hidden parts at most`)
        if (!list.includes(selector)) settings.set({ hiddenElements: { ...hiddenElements, [site]: [...list, selector] } })
        notify('Hidden on this site. Show it again from the page menu')
      })
    },
    hasHiddenParts: (url) => {
      const site = siteOf(url)
      return !!site && Object.keys(settings.get().hiddenElements).some((hidden) => belongsToSite(site, hidden))
    },
    showHiddenParts: () => {
      const site = siteOf(tabs.active ? effectiveUrl(tabs.active.url) : '')
      if (!site) return
      const hiddenElements = Object.fromEntries(Object.entries(settings.get().hiddenElements).filter(([hidden]) => !belongsToSite(site, hidden)))
      settings.set({ hiddenElements })
      notify('Hidden parts are showing again')
    },
    forgetSite: () => {
      const site = siteOf(tabs.active ? effectiveUrl(tabs.active.url) : '')
      if (!site) return notify('Only websites can be forgotten')
      if (isPrivate) return notify('Private windows forget every site when they close')
      const always = settings.get().forgetOnClose.includes(site)
      void dialog
        .showMessageBox(window as BrowserWindow, {
          type: 'question',
          message: `Forget ${site}?`,
          detail: `This signs you out of ${site} and clears its cookies, saved site data, history and permissions, including its subdomains. Bookmarks and saved passwords stay.`,
          buttons: ['Forget', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          checkboxLabel: 'Also forget it every time scTerra closes',
          checkboxChecked: always
        })
        .then(async ({ response, checkboxChecked }) => {
          if (response !== 0) return
          const others = settings.get().forgetOnClose.filter((host) => host !== site)
          if (checkboxChecked !== always) settings.set({ forgetOnClose: checkboxChecked ? [...others, site].sort() : others })
          await core.forgetSite(site)
          notify(`${site} is forgotten`)
        })
        .catch(() => notify(`Couldn't forget ${site}`))
    }
  }
  // Hidden parts and site CSS apply to open pages as soon as they change.
  let lastTweaks = JSON.stringify([settings.get().hiddenElements, settings.get().siteCss])
  const stopTweaks = settings.subscribe((next) => {
    const tweaks = JSON.stringify([next.hiddenElements, next.siteCss])
    if (tweaks === lastTweaks) return
    lastTweaks = tweaks
    for (const contents of tabs.allContents()) void applySiteTweaks(contents, next)
  })
  const stopSidebarPrune = settings.subscribe((next) => sidebarSites.prune(next.sidebarSites.map((site) => site.url)))
  const ai = new AiService(aiStore, (id) => core.contentsFor(id), (contents) => core.tabIdFor(contents))

  const showPermission = (prompt: PermissionPrompt | null) =>
    overlay.setPermission(prompt && { prompt, x: tabs.page.x, y: tabs.page.y })
  const showAuth = (prompt: AuthPrompt | null) => {
    const { x, y, width } = tabs.page
    overlay.setAuth(prompt && { ...prompt, x: x + Math.max(0, (width - AUTH_POPUP.width) / 2), y: y + 48 })
  }
  const httpAuth = new HttpAuthService({
    tabIdFor: (contents) => tabs.tabIdFor(contents),
    activeTabId: () => tabs.active?.id ?? null,
    onPromptChanged: showAuth
  })
  const overlay = new Overlay(
    window,
    (index) => send('omnibox:pick', index),
    (requestId, allow) => permissionService.decide(requestId, allow),
    {
      onPaletteRun: (id) => paletteActions[id]?.(),
      onPaletteClose: () => tabs.focusActive(),
      onAppLinkAnswer: (choice) => appLinks.answer(choice),
      onExtensionsAction: (action, id, x, y) => extensions.listAction(action, id, x, y, window),
      onTabSearchPick: (id) => tabs.reveal(id),
      onTabSearchRemove: (id) => tabs.close(id),
      accent: () => settings.get().accent,
      performance: () => settings.get().performanceMode,
      onBookmarkSave: ({ id, title, url, groupId }) => {
        if (!URL.canParse(url) || !/^(https?|file|javascript):/i.test(url)) return 'Enter a full web address.'
        try {
          bookmarks.edit(id, title, url)
        } catch {
          return 'Another bookmark already has this address.'
        }
        if (bookmarks.list().find((b) => b.id === id)?.groupId !== groupId) bookmarks.setGroup(id, groupId)
        publishBookmarks()
        return null
      },
      onBookmarkRemove: (id) => {
        bookmarks.remove(id)
        publishBookmarks()
      },
      onBookmarkClose: () => tabs.focusActive(),
      onAnswerAction: (action) => send('omnibox:answer-action', action),
      onAnswerLink: (href) => {
        if (/^https?:/i.test(href)) tabs.create(href, { afterId: tabs.active?.id })
      },
      onAuth: (requestId, login) => httpAuth.answer(requestId, login),
      onPasswordAnswer: (choice) => answerPassword(choice),
      onPasswordSuggest: (choice) => answerSuggest(choice),
      onCleanup: (ids) => {
        if (!ids || ids.length === 0) return
        ids.forEach((id) => tabs.close(id))
        notify(`Closed ${ids.length} ${ids.length === 1 ? 'tab' : 'tabs'}. Ctrl Shift T brings them back`)
      },
      onWorkspaceSave: saveWorkspace,
      onWorkspaceRemove: (id) => {
        core.removeWorkspace(id)
      },
      onPopupClosed: () => tabs.focusActive(),
      onTooltipCleared: () => send('overlay:clear-tooltip'),
      onPreviewAction: (action) => (action === 'close' ? preview.close() : preview.promote(action))
    }
  )
  let previewContainer: string | null = null
  const preview = new LinkPreview({
    window,
    page: () => tabs.page,
    show: (state, view) => overlay.setLinkPreview(state, view),
    prepare: (contents) => {
      attachShortcuts(contents, actions)
      attachPageMenu(contents, actions, window, (page, params) => extensions.menuItems(page, params))
    },
    openTab: (url, how) => {
      const id = tabs.create(url, { activate: how !== 'background', afterId: tabs.active?.id, container: previewContainer })
      if (how === 'split') tabs.startSplit(id)
    },
    watch: (contents, onBlocked) => core.watchPage(contents, onBlocked)
  })
  const sidebarSites = new SidebarSites({
    window,
    prepare: (contents) => {
      attachShortcuts(contents, actions)
      attachPageMenu(contents, actions, window, (page, params) => extensions.menuItems(page, params))
    },
    onState: (state) => send('sidebar-sites:changed', state),
    raiseOverlay: () => overlay.raise(),
    openTab: (url) => tabs.create(url, { afterId: tabs.active?.id }),
    watch: (contents, onBlocked) => core.watchPage(contents, onBlocked)
  })
  const addSidebarSite = () => {
    const active = tabs.active
    const url = active ? effectiveUrl(active.url) : ''
    if (!active || !/^https?:\/\//i.test(url)) return notify('Only websites can go in the sidebar')
    const { sidebarSites: sites } = settings.get()
    if (sites.some((site) => site.url === url)) return sidebarSites.open(url)
    if (sites.length >= MAX_SIDEBAR_SITES) return notify(`The sidebar holds ${MAX_SIDEBAR_SITES} sites at most`)
    settings.set({ sidebarSites: [...sites, { url, title: (active.title || new URL(url).host).slice(0, 200) }] })
    // The rail has to be drawn before the panel has room to open in.
    setTimeout(() => sidebarSites.open(url), 50)
  }
  const sidebarSiteMenu = (url: string, x: number, y: number) => {
    const sites = settings.get().sidebarSites
    const index = sites.findIndex((site) => site.url === url)
    if (index < 0) return
    const move = (offset: number) => {
      const next = [...sites]
      const [site] = next.splice(index, 1)
      next.splice(Math.max(0, Math.min(next.length, index + offset)), 0, site!)
      settings.set({ sidebarSites: next })
    }
    Menu.buildFromTemplate([
      { label: 'Open as tab', click: () => tabs.create(url, { afterId: tabs.active?.id }) },
      { label: 'Reload', click: () => (sidebarSites.state()?.home === url ? sidebarSites.act('reload') : sidebarSites.open(url)) },
      { type: 'separator' },
      { label: 'Move up', enabled: index > 0, click: () => move(-1) },
      { label: 'Move down', enabled: index < sites.length - 1, click: () => move(1) },
      { type: 'separator' },
      { label: 'Remove from sidebar', click: () => settings.set({ sidebarSites: sites.filter((site) => site.url !== url) }) }
    ]).popup({ window, x: Math.round(x), y: Math.round(y) })
  }
  const openPreview = (url: string, target: Electron.Session, container: string | null) => {
    previewContainer = container
    preview.open(url, target)
  }
  const onActive = (action: (id: number) => void) => () => {
    if (tabs.active) action(tabs.active.id)
  }
  const installApp = async () => {
    const active = tabs.active
    const contents = active && tabs.contentsFor(active.id)
    const url = active ? effectiveUrl(active.url) : ''
    if (!active || !contents || !/^https?:/i.test(url)) return notify('Only web pages can be installed')
    if (isPrivate) return notify("Private windows can't install apps")
    const name = (active.title || new URL(url).host).trim()
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      message: `Install ${name}?`,
      detail: `${url}\n\nIt gets its own window and a shortcut in your apps menu, and uses the same sign-ins as your tabs.`,
      buttons: ['Install', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return
    const icon = active.faviconUrl ? await fetchIcon(contents.session, active.faviconUrl).catch(() => null) : null
    try {
      core.webApps.install(name, url, icon)
      notify(`Installed ${name}`)
    } catch {
      notify("Couldn't install this app")
    }
  }
  function saveWorkspace({ id, name, focus }: WorkspaceEdit) {
    const title = name.trim().slice(0, 40)
    if (!title) return
    if (id) {
      core.storeWorkspaces(tabs.workspaceList().map((workspace) => (workspace.id === id ? { ...workspace, name: title, focus } : workspace)))
      if (id === tabs.workspace.id && focus !== settings.get().focusMode) settings.set({ focusMode: focus })
      return
    }
    const created = { id: crypto.randomUUID(), name: title, focus }
    core.storeWorkspaces([...tabs.workspaceList(), created])
    tabs.switchWorkspace(created.id)
  }
  const editWorkspace = (id: string | null, x: number, y: number) => {
    const workspace = tabs.workspaceList().find((w) => w.id === id)
    const { width, height } = window.getContentBounds()
    overlay.openWorkspaceEditor({
      id: workspace?.id ?? null,
      name: workspace?.name ?? '',
      focus: workspace?.focus ?? false,
      canRemove: !!workspace && workspace.id !== DEFAULT_WORKSPACE.id,
      x: Math.round(Math.max(8, Math.min(width - WORKSPACE_POPUP.width - 8, x))),
      y: Math.round(Math.max(8, Math.min(height - WORKSPACE_POPUP.height - 8, y)))
    })
  }
  const paletteActions: Record<string, () => void> = {
    'new-tab': () => tabs.create(),
    'new-window': () => actions.openWindow(),
    'install-app': actions.installApp,
    'task-manager': () => actions.openPage('tasks'),
    'private-window': actions.openPrivateWindow,
    'reopen-tab': () => tabs.reopenClosed(),
    find: actions.openFind,
    bookmark: actions.toggleBookmark,
    'bookmarks-bar': actions.toggleBookmarksBar,
    reader: actions.toggleReader,
    assistant: actions.toggleAssistant,
    summarise: () => actions.askAssistant({ text: summarisePromptFor(tabs.active?.url ?? ''), selection: null, includePage: true }),
    split: () => tabs.toggleSplit(),
    'search-tabs': actions.searchTabs,
    'open-file': actions.openFile,
    'view-source': actions.viewSource,
    'pin-tab': onActive((id) => tabs.setPinned(id, !tabs.active?.pinned)),
    'mute-tab': onActive((id) => tabs.setMuted(id, !tabs.active?.muted)),
    screenshot: actions.screenshot,
    'hide-part': actions.hidePart,
    'add-to-sidebar': actions.addToSidebar,
    'watch-page': () => actions.watchPage(false),
    'reading-list-add': actions.addToReadingList,
    'reading-list': () => actions.openPage('reading'),
    highlights: () => actions.openPage('highlights'),
    'watched-pages': () => actions.openPage('watching'),
    'archived-tabs': () => actions.openPage('archive'),
    code: () => actions.openPage('code'),
    'reopen-group': () => {
      const [latest] = actions.closedGroups()
      if (latest) actions.reopenGroup(latest.id)
      else notify('No closed groups')
    },
    'forget-site': actions.forgetSite,
    translate: () => actions.translatePage(),
    'organise-tabs': actions.organiseTabs,
    'cleanup-tabs': actions.cleanupTabs,
    'new-workspace': () => editWorkspace(null, tabs.page.x + 16, tabs.page.y + 16),
    'ungroup-tabs': () => tabs.clearGroups(),
    'vertical-tabs': () =>
      settings.set({ tabLayout: settings.get().tabLayout === 'vertical' ? 'horizontal' : 'vertical' }),
    history: () => actions.openPage('history'),
    bookmarks: () => actions.openPage('bookmarks'),
    downloads: () => actions.openPage('downloads'),
    settings: () => actions.openPage('settings'),
    'ai-settings': () => actions.openPage('ai'),
    'focus-mode': () => {
      const focusMode = !settings.get().focusMode
      settings.set({ focusMode })
      notify(focusMode ? 'Focus Mode is on' : 'Focus Mode is off')
    },
    'performance-mode': () => actions.performanceMode.toggle(),
    'site-blocker': () => actions.openPage('blocker'),
    vpn: () => actions.openPage('vpn'),
    passwords: () => actions.openPage('passwords'),
    'fill-password': () => openPasswordMenu(),
    print: onActive((id) => tabs.print(id)),
    fullscreen: actions.toggleFullscreen,
    devtools: onActive((id) => tabs.toggleDevTools(id))
  }
  /**
   * A login waiting on the person's answer. Only ever held here, and for a minute at most. While
   * the vault is locked or not set up, nothing can say if it's already saved, so it asks anyway.
   */
  let pendingLogin: { origin: string; username: string; password: string; heldLocked: boolean; saveOnUnlock: boolean; timer: NodeJS.Timeout } | null = null
  /** Sites told "Not now" while locked, which has no lasting answer until the vault is open. */
  const dismissedWhileLocked = new Set<string>()
  const clearPendingLogin = () => {
    if (pendingLogin) clearTimeout(pendingLogin.timer)
    pendingLogin = null
    overlay.setPasswordPrompt(null)
  }
  const passwordPromptAt = (origin: string, username: string) => {
    const { x, y, width } = tabs.page
    return { host: new URL(origin).host, username, x: x + width - PASSWORD_POPUP.width - PASSWORD_POPUP.inset, y: y + PASSWORD_POPUP.inset }
  }
  /** What to ask, now the vault can answer. */
  const offerOpenVault = (login: NonNullable<typeof pendingLogin>) => {
    const offer = passwords.offerFor(login.origin, login.username, login.password)
    if (!offer) return clearPendingLogin()
    if (login.saveOnUnlock) {
      passwords.saveEntry({ url: login.origin, username: login.username, password: login.password, note: '' })
      clearPendingLogin()
      return notify('Password saved')
    }
    login.heldLocked = false
    overlay.setPasswordPrompt({ ...passwordPromptAt(login.origin, login.username), update: offer === 'update', needs: null })
  }
  const answerPassword = (choice: 'save' | 'never' | 'dismiss') => {
    const login = pendingLogin
    if (!login) return
    if (!passwords.unlocked) {
      if (choice === 'save') {
        // The minute keeps counting, so it can't wait around for long.
        login.saveOnUnlock = true
        overlay.setPasswordPrompt(null)
        actions.openPage('passwords')
      } else {
        dismissedWhileLocked.add(login.origin)
        clearPendingLogin()
      }
      return
    }
    clearPendingLogin()
    if (choice === 'save') passwords.saveEntry({ url: login.origin, username: login.username, password: login.password, note: '' })
    if (choice === 'never') passwords.neverFor(login.origin)
  }
  const watchTab = (contents: Electron.WebContents) => {
    // Pages can still report in during shutdown, after the database has closed.
    if (window.isDestroyed()) return
    const url = contents.getURL()
    const origin = /^https?:/.test(url) ? originOf(url) : null
    const { passwordOfferSave, passwordOfferLocked } = settings.get()
    const { available, exists, unlocked } = passwords.state()
    if (!origin || !available || !passwordOfferSave || (!unlocked && !passwordOfferLocked)) return
    void watchForSignIn(contents).then((login) => {
      if (contents.isDestroyed() || window.isDestroyed()) return
      // The name step of a sign-in over two pages: kept for the password step that follows.
      if (login && !login.password) {
        recentNames.set(origin, { username: login.username, at: Date.now() })
        return watchTab(contents)
      }
      if (login && !login.username) {
        const recent = recentNames.get(origin)
        if (recent && Date.now() - recent.at < RECENT_NAME_MS) login.username = recent.username
      }
      if (login) {
        const open = passwords.unlocked
        const stillOffering = settings.get().passwordOfferSave && (open || settings.get().passwordOfferLocked)
        if (stillOffering && (open || !dismissedWhileLocked.has(origin))) {
          clearPendingLogin()
          pendingLogin = { origin, ...login, heldLocked: !open, saveOnUnlock: false, timer: setTimeout(clearPendingLogin, LOGIN_PROMPT_MS) }
          if (open) offerOpenVault(pendingLogin)
          else overlay.setPasswordPrompt({ ...passwordPromptAt(origin, login.username), update: false, needs: exists || passwords.state().exists ? 'unlock' : 'setup' })
        }
      }
      // Sites that sign in without loading a new page can still be watched for another try.
      if (login) watchTab(contents)
    })
  }
  /** Names typed on the first page of a two-page sign-in, by site, for a few minutes. */
  const recentNames = new Map<string, { username: string; at: number }>()
  /** The page whose sign-in field the list of logins hangs from. */
  let suggestFor: { contents: Electron.WebContents; origin: string; kind: LoginFieldFocus['kind'] } | null = null
  const closeSuggest = () => {
    suggestFor = null
    overlay.setPasswordSuggest(null)
  }
  const pageOrigin = (contents: Electron.WebContents) => {
    const url = contents.isDestroyed() ? '' : contents.getURL()
    return /^https?:/.test(url) ? originOf(url) : null
  }
  /** Waits for a click into a sign-in field, shows the list, and waits again. */
  const watchLoginFields = (contents: Electron.WebContents) => {
    if (window.isDestroyed() || contents.isDestroyed() || !pageOrigin(contents) || !passwords.state().available) return
    void nextLoginField(contents).then((field) => {
      if (!field || contents.isDestroyed() || window.isDestroyed()) return
      showSuggest(contents, field)
      watchLoginFields(contents)
    })
  }
  const showSuggest = (contents: Electron.WebContents, field: LoginFieldFocus) => {
    const origin = pageOrigin(contents)
    const view = tabs.shownBounds(contents)
    if (!origin || !view || !settings.get().passwordSuggest) return
    const { available, exists, unlocked } = passwords.state()
    if (!available) return
    const generate = field.kind === 'new'
    const logins = exists && unlocked ? passwords.matches(origin).map(({ id, username }) => ({ id, username })) : []
    const locked = exists && !unlocked && !generate
    if (!locked && logins.length === 0 && !generate) return
    const zoom = contents.getZoomFactor()
    const width = Math.round(Math.min(PASSWORD_SUGGEST.maxWidth, Math.max(PASSWORD_SUGGEST.minWidth, field.width * zoom)))
    const height = passwordSuggestHeight({ logins, locked, generate })
    const below = view.y + (field.y + field.height) * zoom + 2
    const above = view.y + field.y * zoom - height - 2
    const y = below + height > view.y + view.height && above > view.y ? above : below
    const x = Math.min(view.x + view.width - width - 4, Math.max(view.x + 4, view.x + field.x * zoom))
    suggestFor = { contents, origin, kind: field.kind }
    overlay.setPasswordSuggest({ host: new URL(origin).host, logins, locked, generate, x: Math.round(x), y: Math.round(y), width })
  }
  const answerSuggest = (choice: string) => {
    const target = suggestFor
    suggestFor = null
    if (choice === 'manage' || choice === 'unlock') return actions.openPage('passwords')
    if (!target || choice === 'close' || target.contents.isDestroyed()) return
    // Checked again now, as the page may have moved on while the list was open.
    if (pageOrigin(target.contents) !== target.origin) return notify('This page has changed, so nothing was filled')
    target.contents.focus()
    if (choice === 'generate') {
      const password = generatePassword((values) => void randomFillSync(values))
      void fillNewPassword(target.contents, password).then((count) => {
        if (count === 0) return notify('No password field to fill')
        copySecret(password)
        notify("Strong password filled and copied. You'll be asked to save it when you sign up")
      })
      return
    }
    const id = choice.startsWith('login:') ? choice.slice(6) : ''
    if (!passwords.unlocked || !passwords.matches(target.origin).some((login) => login.id === id)) return
    const { username, password } = passwords.find(id)
    void fillLogin(target.contents, username, password).then((filled) => {
      if (!filled) notify('No sign-in form on this page')
    })
  }
  /**
   * Fills by itself only when exactly one login is saved for this exact site, in the top frame, on an
   * encrypted page (or this computer), and only into empty fields. Pages that draw their form late get one more look.
   */
  const autoFillPassword = async (contents: Electron.WebContents, retry = true): Promise<void> => {
    const origin = pageOrigin(contents)
    if (!origin || window.isDestroyed() || !settings.get().passwordAutoFill || !passwords.state().available || !passwords.unlocked) return
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return
    const logins = passwords.matches(origin)
    if (logins.length !== 1) return
    if (!(await hasLoginForm(contents))) {
      if (retry) setTimeout(() => void autoFillPassword(contents, false), 1500)
      return
    }
    if (contents.isDestroyed() || pageOrigin(contents) !== origin || !passwords.unlocked) return
    const { username, password } = passwords.find(logins[0]!.id)
    await fillLogin(contents, username, password, true)
  }
  const openPasswordMenu = (x = tabs.page.x + tabs.page.width - 240, y = tabs.page.y) => {
    const { available, exists, unlocked } = passwords.state()
    if (!available) return notify("Private windows don't use saved passwords")
    if (!exists || !unlocked) return actions.openPage('passwords')
    const contents = tabs.active && tabs.contentsFor(tabs.active.id)
    const url = contents?.getURL() ?? ''
    const origin = /^https?:/.test(url) ? originOf(url) : null
    const logins = origin ? passwords.matches(origin) : []
    const fill = (id: string) => {
      // Checked again now, as the page may have moved on while the menu was open.
      const current = tabs.active && tabs.contentsFor(tabs.active.id)
      if (!current || !origin || originOf(current.getURL()) !== origin) return notify('This page has changed, so nothing was filled')
      const { username, password } = passwords.find(id)
      void fillLogin(current, username, password).then((filled) => {
        if (!filled) notify('No sign-in form on this page')
      })
    }
    Menu.buildFromTemplate([
      ...(logins.length === 0 ? [{ label: origin ? 'No saved logins for this site' : 'Nothing to fill on this page', enabled: false }] : []),
      ...logins.map((login) => ({ label: login.username || 'No username', click: () => fill(login.id) })),
      ...logins
        .filter((login) => login.totp)
        .map((login) => ({
          label: logins.filter((other) => other.totp).length > 1 ? `Copy two-step code for ${login.username || 'no username'}` : 'Copy two-step code',
          click: () => {
            const { code, remaining } = passwords.totp(login.id)
            copySecret(code)
            notify(`Two-step code copied. It changes in ${remaining} seconds`)
          }
        })),
      ...(logins.length > 0 && origin?.startsWith('http:') ? [{ label: "This page isn't encrypted", enabled: false }] : []),
      ...(contents ? actions.autofillRows(contents) : []),
      { type: 'separator' },
      {
        label: 'Copy a new strong password',
        click: () => {
          copySecret(generatePassword((values) => void randomFillSync(values)))
          notify('Copied. It clears in 30 seconds')
        }
      },
      { label: 'Lock', click: () => passwords.lock() },
      { label: 'Manage passwords…', click: () => actions.openPage('passwords') }
    ]).popup({ window, x: Math.round(x), y: Math.round(y) })
  }

  const openVpnMenu = (x: number, y: number) => {
    const { enabled, connections, activeId, groups, pings } = vpn.state()
    const pick = (id: string) => void vpn.select(id).then(() => (vpn.summary().enabled ? undefined : vpn.setEnabled(true)))
    const row = (connection: (typeof connections)[number]) => ({
      label: `${connection.name}${pings[connection.id] ? `  ${pings[connection.id]} ms` : pings[connection.id] === null ? '  not working' : ''}`,
      type: 'radio' as const,
      checked: connection.id === activeId,
      click: () => pick(connection.id)
    })
    const list = (items: typeof connections) => byPing(items, pings).slice(0, VPN_MENU_ROWS).map(row)
    const pingAll = async () => {
      notify('Pinging…')
      await vpn.ping(connections.map(({ id }) => id), settings.get().vpnPingTimeout)
      notify('Finished pinging')
    }
    Menu.buildFromTemplate([
      { label: enabled ? 'Turn off' : 'Turn on', click: () => void (enabled ? vpn.setEnabled(false) : vpn.turnOn()) },
      { type: 'separator' },
      ...list(connections.filter((connection) => connection.groupId === null)),
      ...groups.map((group) => ({ label: group.name, submenu: list(connections.filter((connection) => connection.groupId === group.id)) })),
      { type: 'separator' },
      { label: 'Ping all', click: () => void pingAll() },
      { label: 'Manage connections…', click: () => actions.openPage('vpn') }
    ]).popup({ window, x: Math.round(x), y: Math.round(y) })
  }
  const notify = (text: string) => {
    const { x, y, width } = tabs.page
    overlay.showToast(text, x + width - TOAST_POPUP.width - TOAST_POPUP.inset, y + TOAST_POPUP.inset)
  }
  const runTask = async (working: string, task: () => Promise<string>) => {
    notify(working)
    try {
      notify(await task())
    } catch (error) {
      notify(error instanceof AiError ? error.message : 'That AI task failed')
    }
  }

  /** Local checks first. The AI only sees titles and addresses, and only because the person asked. */
  const cleanupTabs = async () => {
    const input = tabs.cleanupInput()
    const rows = suggestCleanup(input, tabs.active?.id ?? null)
    const offered = new Set(rows.map((row) => row.id))
    const candidates = input.filter(
      (tab) => !offered.has(tab.id) && tab.id !== tabs.active?.id && /^https?:/.test(tab.url) && !aiStore.disabledHosts().includes(new URL(tab.url).host)
    )
    if (aiStore.status().ready && candidates.length > 1) {
      notify('Looking through your tabs…')
      const reply = await ai.complete(TAB_CLEANUP_PROMPT, groupTabsMessage(candidates)).catch(() => '')
      for (const { id, reason } of parseTabCleanup(reply, candidates)) {
        const tab = candidates.find((candidate) => candidate.id === id)!
        rows.push({ id, title: tab.title || tab.url, url: tab.url, reason })
      }
    }
    if (rows.length === 0) return notify('Your tabs look tidy')
    const { width } = window.getContentBounds()
    overlay.openCleanup({ rows, x: Math.max(0, Math.round((width - CLEANUP_POPUP.width) / 2)), y: CLEANUP_POPUP.top })
  }

  /** Chromium can refuse a capture until the page has painted, so it's asked to, and tried again. */
  const capturePage = async (contents: Electron.WebContents) => {
    for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
      contents.invalidate()
      const image = await contents.capturePage().catch(() => null)
      if (image && !image.isEmpty()) return image
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_MS))
    }
    return null
  }
  const takeScreenshot = async (contents: Electron.WebContents) => {
    const image = await capturePage(contents)
    if (!image) return notify("Couldn't take a screenshot")
    const png = image.toPNG()
    const dir = settings.get().downloadDir || app.getPath('downloads')
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-').replace('T', ' ')
    await writeFile(uniquePath(dir, `Screenshot ${stamp}.png`, existsSync), png)
    // Saved first, and with a limit here: a busy system clipboard can leave this waiting for good.
    const copied = await Promise.race([
      clipboard
        .write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
        .then(() => true)
        .catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CLIPBOARD_WAIT_MS))
    ])
    notify(copied ? 'Screenshot saved and copied' : 'Screenshot saved')
  }

  const editBookmark = (bookmark: Bookmark, fromBar: boolean) => {
    const { x, y, width } = tabs.page
    const { id, title, url, groupId } = bookmark
    overlay.openBookmarkEditor({
      id,
      title,
      url,
      groupId,
      groups: bookmarks.groups(),
      editUrl: fromBar,
      x: x + width - BOOKMARK_POPUP.width - BOOKMARK_POPUP.inset,
      y: y + BOOKMARK_POPUP.inset
    })
  }

  attachShortcuts(chromeUi, actions)
  const handle: BrowserWindowHandle = {
    kind,
    window,
    tabs,
    actions,
    send,
    showPermission,
    raiseOverlay: () => overlay.raise(),
    setExtensionFrame: (rect, view) => overlay.setExtensionFrame(rect, view),
    openExtensionsPopup: (popup, refresh) => overlay.openExtensionsPopup(popup, refresh),
    passwordsChanged: () => {
      if (passwords.unlocked) {
        tabs.allContents().forEach(watchTab)
        if (pendingLogin?.heldLocked) offerOpenVault(pendingLogin)
      } else if (!pendingLogin?.heldLocked) {
        clearPendingLogin()
      }
    },
    hidePages: (hidden) => {
      tabs.setResizing(hidden)
      extensions.setPanelHidden(hidden, window)
    },
    saved: () => ({ ...tabs.session(), bounds: window.getNormalBounds() })
  }
  core.add(handle)
  /** The intro runs edge to edge, with window controls to match its light or dark scene. */
  function setIntro(tabId: number | null) {
    introActive = tabId !== null
    tabs.setImmersive(tabId)
    if (tabId === null) kv.set(WELCOME_KEY, true)
    syncTheme()
  }
  let introActive = false
  const disposeIpc = registerIpc(chromeUi, {
    window,
    tabs,
    history,
    bookmarks,
    settings,
    overlay,
    actions,
    onBookmarksChanged: publishBookmarks,
    editBookmark,
    updates,
    editWorkspace,
    aiStore,
    ai,
    chats: core.services.chats,
    privacy,
    vpn,
    passwords,
    openVpnMenu,
    openPasswordMenu,
    extensions,
    sidebar: { sites: sidebarSites, addCurrent: addSidebarSite, menu: sidebarSiteMenu },
    core
  })
  const disposeInternalIpc = registerInternalIpc({
    window,
    tabs,
    settings,
    history,
    bookmarks,
    downloads,
    permissions: core.services.permissions,
    core,
    onBookmarksChanged: publishBookmarks,
    aiStore,
    ai,
    chats: core.services.chats,
    privacy,
    extensions,
    sync,
    reporter: core.services.reporter,
    blocker,
    vpn,
    passwords,
    updates,
    setIntro
  })
  const appLinks = new AppLinks(core.services.permissions, {
    show: (prompt) => overlay.setAppLink(prompt && { ...prompt, x: tabs.page.x + 8, y: tabs.page.y + 8 }),
    notify: (text) => notify(text),
    activeContents: () => (tabs.active ? tabs.contentsFor(tabs.active.id) : undefined)
  })
  chromeUi.once('did-finish-load', () => send('privacy:changed', privacy.offHosts()))

  // The chrome UI itself must never navigate away or open windows.
  chromeUi.on('will-navigate', (event) => event.preventDefault())
  chromeUi.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // If the UI process dies, reload it: tabs live in the main process and reappear.
  chromeUi.on('render-process-gone', () => chromeUi.reload())

  function syncTheme() {
    const { background, foreground } = nativeColors()
    const intro = INTRO_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
    window.setBackgroundColor(introActive ? intro.color : background)
    if (process.platform === 'darwin') return
    window.setTitleBarOverlay({ ...(introActive ? intro : { color: background, symbolColor: foreground }), height: TABSTRIP_HEIGHT })
  }
  nativeTheme.on('updated', syncTheme)

  const sleepTimer = setInterval(() => {
    const minutes = sleepMinutes(settings.get())
    if (minutes > 0) tabs.sleepIdle(minutes * 60_000)
    const days = settings.get().archiveAfterDays
    if (days > 0 && !isPrivate && !isApp) core.archive.add(tabs.archiveIdle(days * 86_400_000))
  }, SLEEP_CHECK_MS)

  // Windows: mouse back/forward buttons arrive as app commands.
  window.on('app-command', (_event, command) => {
    const active = tabs.active
    if (!active) return
    if (command === 'browser-backward') tabs.back(active.id)
    if (command === 'browser-forward') tabs.forward(active.id)
  })
  window.on('resize', () => tabs.applyBounds())

  window.once('ready-to-show', () => {
    if (savedWindow?.maximized && openBrowsers.length === 0) window.maximize()
    window.show()
  })
  window.on('close', () => {
    core.closing(handle)
    if (!isApp) kv.set(WINDOW_KEY, { bounds: window.getNormalBounds(), maximized: window.isMaximized() } satisfies SavedWindow)
  })
  window.on('closed', () => {
    clearInterval(sleepTimer)
    stopTweaks()
    stopSidebarPrune()
    preview.close()
    sidebarSites.destroy()
    nativeTheme.off('updated', syncTheme)
    disposeIpc()
    disposeInternalIpc()
    overlay.destroy()
    // After the overlay, which went with the window: this clears any save offer it was showing.
    if (pendingLogin) clearTimeout(pendingLogin.timer)
    tabs.destroy()
    core.closed(handle)
  })

  // An installed site's window draws only a slim bar, and asks for it here.
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${isApp ? '?window=app' : ''}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), isApp ? { query: { window: 'app' } } : {})

  chromeUi.once('did-finish-load', () => {
    if (isApp) {
      options.urls?.forEach((url) => tabs.create(url))
      return
    }
    const urls = options.urls ?? []
    if (options.restore) {
      tabs.restore(options.restore.tabs, options.restore.activeIndex, options.restore.split, options.restore.splitRatio)
      return
    }
    if (!options.first) {
      if (urls.length > 0) urls.forEach((url) => tabs.create(url, { container: options.container ?? null }))
      else tabs.create()
      return
    }
    if (!isPrivate) void core.fillMissingIcons()
    const saved = settings.get().startup === 'restore' ? loadSession(kv) : null
    const previous = loadSession(kv)
    if (saved) tabs.restore(saved.tabs, saved.activeIndex, saved.split, saved.splitRatio)
    urls.forEach((url) => tabs.create(url))
    // Someone already using scTerra has no need of an introduction.
    const seen = kv.get(WELCOME_KEY) === true || !!previous || bookmarks.list().length > 0
    const eligible = !isPrivate && currentProfile() === DEFAULT_PROFILE && urls.length === 0 && (!process.env.SCB_E2E || !!process.env.SCB_WELCOME)
    if (!seen && eligible) setIntro(tabs.create(WELCOME_URL))
    else if (!saved && urls.length === 0) tabs.create()
    if (seen) kv.set(WELCOME_KEY, true)
    if (saved) for (const restore of loadExtraSessions(kv)) core.openWindow({ restore })
  })

  return handle
}
