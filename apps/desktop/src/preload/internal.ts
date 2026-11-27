import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INTERNAL_COMMAND_CHANNELS, SIGN_IN_HOSTS, type AssistantEvent, type CoderEvent, type InternalBridge, type PagePrefs } from '@scbrowser/shared'
import { middleClickScroll, mouseGestures } from './pageExtras'

declare const location: { protocol: string; hostname: string }
declare const navigator: { userAgent: string }
declare const process: { versions: Record<string, string> }

// This preload runs in every tab, but websites get nothing: the bridge exists only on
// sc:// pages, and the main process re-checks the calling frame on each call.
if (location.protocol === 'sc:') {
  const channels = new Set<string>(INTERNAL_COMMAND_CHANNELS)
  const bridge: InternalBridge = {
    invoke: (channel, ...args) => {
      if (!channels.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`))
      return ipcRenderer.invoke('internal:call', channel, ...args)
    },
    onAssistantEvent: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: AssistantEvent) => listener(payload)
      ipcRenderer.on('ai:event', wrapped)
      return () => ipcRenderer.removeListener('ai:event', wrapped)
    },
    onCoderEvent: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: CoderEvent) => listener(payload)
      ipcRenderer.on('coder:event', wrapped)
      return () => ipcRenderer.removeListener('coder:event', wrapped)
    }
  }
  contextBridge.exposeInMainWorld('scbInternal', bridge)
}

// Google's sign-in pages check that what scripts read matches the request's header. This runs
// before their scripts, and can't disturb a navigation as changing the tab's own identity would.
// signin.test is the tests' stand-in, a name that can't exist on the internet.
if ((SIGN_IN_HOSTS as readonly string[]).includes(location.hostname) || location.hostname === 'signin.test') {
  contextBridge.executeInMainWorld({
    func: (userAgent: string) => {
      for (const name of ['userAgent', 'appVersion']) {
        const value = name === 'userAgent' ? userAgent : userAgent.replace(/^Mozilla\//, '')
        Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true })
      }
    },
    args: [navigator.userAgent.replace(' Safari/', ` Electron/${process.versions.electron} Safari/`)]
  })
}

// The Chrome Web Store shows "Switch to Chrome" unless the browser's brands include Google Chrome,
// which Electron's never do (renaming the words on the page doesn't help). Only the store is told
// this, and the request headers say the same, from `googleSignIn.ts`.
if (location.hostname === 'chromewebstore.google.com') {
  contextBridge.executeInMainWorld({
    func: (major: string, full: string) => {
      const brands = [
        { brand: 'Chromium', version: major },
        { brand: 'Google Chrome', version: major },
        { brand: 'Not_A Brand', version: '24' }
      ]
      const fullVersionList = brands.map(({ brand }) => ({ brand, version: brand === 'Not_A Brand' ? '24.0.0.0' : full }))
      const nav = navigator as unknown as { userAgentData?: { platform: string; getHighEntropyValues: (hints: string[]) => Promise<Record<string, unknown>> } }
      const real = nav.userAgentData
      const data = {
        brands,
        mobile: false,
        platform: real?.platform ?? '',
        getHighEntropyValues: async (hints: string[]) => ({ ...(real ? await real.getHighEntropyValues(hints) : {}), brands, mobile: false, fullVersionList, uaFullVersion: full }),
        toJSON: () => ({ brands, mobile: false, platform: real?.platform ?? '' })
      }
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => data, configurable: true })
    },
    args: [process.versions.chrome!.split('.')[0]!, process.versions.chrome!]
  })
}

// Websites: what the person turned on for them, asked once as the page starts, before its scripts.
if (/^(https?|file):$/.test(location.protocol)) {
  // Listening starts at once and acts once the answer says to, so nothing below can stop it.
  const on = { mouseGestures: false, middleClickScroll: false }
  mouseGestures(() => on.mouseGestures)
  middleClickScroll(() => on.middleClickScroll)
  let prefs: PagePrefs | null = null
  try {
    prefs = ipcRenderer.sendSync('page:prefs') as PagePrefs | null
  } catch {
    prefs = null
  }
  // Global Privacy Control, which the request headers already carry, for scripts that ask.
  if (prefs?.globalPrivacyControl && location.protocol !== 'file:') {
    contextBridge.executeInMainWorld({
      // Returns nothing: handing Navigator.prototype back across worlds reads its getters, which throws.
      func: () => {
        Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true, enumerable: true })
      }
    })
  }
  on.mouseGestures = prefs?.mouseGestures === true
  on.middleClickScroll = prefs?.middleClickScroll === true
  // Protected content turned off, everywhere or for this site. Chromium doesn't ask a permission for
  // Widevine, so the page is told it isn't available, as a browser without it would say.
  if (prefs && !prefs.protectedContent) {
    contextBridge.executeInMainWorld({
      func: () => {
        const refuse = () => Promise.reject(new DOMException('Protected content is turned off for this site in scTerra.', 'NotSupportedError'))
        Object.defineProperty(Navigator.prototype, 'requestMediaKeySystemAccess', { value: refuse, writable: true, configurable: true })
      }
    })
  }
}

// Sites' notifications: each one a site with the permission makes is listed under More > Notifications,
// and during Do not disturb the page gets a stand-in that never shows. Asked synchronously, as the
// page expects its notification at once. Pages on this computer are secure contexts too.
if (location.protocol === 'https:' || (location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) {
  contextBridge.executeInMainWorld({
    // This build has no DOM types, so the page's objects are typed loosely.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    func: (report: (title: string, body: string) => boolean) => {
      const page = globalThis as any
      const Real = page.Notification
      if (typeof Real !== 'function') return
      const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, 500)
      // What the page gets while a notification is held: it never shows, and behaves as one that's closed.
      const held = (title: string, options: any) => {
        const stand = new page.EventTarget()
        Object.assign(stand, { title, body: options?.body ?? '', tag: options?.tag ?? '', data: options?.data ?? null, icon: options?.icon ?? '', onclick: null, onclose: null, onerror: null, onshow: null, close: () => undefined })
        return stand
      }
      const Wrapped: any = function (this: unknown, title: unknown, options?: any) {
        if (!new.target) throw new TypeError("Failed to construct 'Notification': Please use the 'new' operator.")
        if (Real.permission === 'granted' && report(text(title), text(options?.body))) return held(text(title), options)
        return Reflect.construct(Real, [title, options])
      }
      Object.setPrototypeOf(Wrapped, Real)
      Wrapped.prototype = Real.prototype
      Object.defineProperty(page, 'Notification', { value: Wrapped, writable: true, configurable: true })
      const show = page.ServiceWorkerRegistration?.prototype?.showNotification
      if (typeof show === 'function') {
        page.ServiceWorkerRegistration.prototype.showNotification = function (this: unknown, title: unknown, options?: any) {
          if (Real.permission === 'granted' && report(text(title), text(options?.body))) return Promise.resolve()
          return show.call(this, title, options)
        }
      }
    },
    args: [
      (title: string, body: string) => {
        try {
          return ipcRenderer.sendSync('page:notification', title, body) === true
        } catch {
          return false
        }
      }
    ]
  })
}
