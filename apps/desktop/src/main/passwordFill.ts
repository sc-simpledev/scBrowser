import { clipboard, type WebContents } from 'electron'
import type { Identity } from '@scbrowser/shared'

/** Its own isolated world, so the page's scripts can't see what's done here. */
const WORLD = 1004
const MAX_FIELD = 4096
const CLIPBOARD_CLEAR_MS = 30_000

const PICK_FIELDS = `
  const visible = (el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled }
  const isText = (el) => el.tagName === 'INPUT' && ['text', 'email', 'tel', ''].includes((el.getAttribute('type') ?? '').toLowerCase())
  const hint = (el) => (el.getAttribute('autocomplete') ?? '').toLowerCase()
  const looksLikeName = (el) => /username|email/.test(hint(el)) || /user|e-?mail|login|account|identifier|phone/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' '))
  const nameBefore = (pass) => {
    const inputs = [...(pass.form ?? document).querySelectorAll('input')]
    const before = inputs.slice(0, inputs.indexOf(pass)).filter((el) => isText(el) && visible(el))
    return before.findLast((el) => /username|email/.test(hint(el))) ?? before.at(-1) ?? null
  }
  const passwordsIn = (root) => [...root.querySelectorAll('input[type=password]')].filter(visible)
  /** A sign-up or change-password form: a new-password hint, or two or more password fields. */
  const isNewPassword = (pass) => /new-password/.test(hint(pass)) || (!/current-password/.test(hint(pass)) && passwordsIn(pass.form ?? document).length >= 2) || /confirm|repeat|new.?pass|create/i.test([pass.name, pass.id, pass.placeholder, pass.getAttribute('aria-label')].join(' '))
  /** Sets a value the way typing does, so frameworks watching the field see it. */
  const put = (el, value) => {
    // Focusing it here mustn't bring the list of logins straight back.
    globalThis.scFillingUntil = Date.now() + 400
    el.focus()
    el.value = value
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
`

/**
 * Fills the sign-in fields: in the form of the field last clicked when there is one, else the first
 * visible ones on the page. A site that asks for the name first gets just that. With `onlyEmpty`,
 * as when filling by itself on load, it leaves anything the person has already typed alone.
 */
const fillCode = (username: string, password: string, onlyEmpty = false) => `(() => {
  ${PICK_FIELDS}
  const last = globalThis.scLoginField?.isConnected ? globalThis.scLoginField : null
  const scope = last?.form ?? document
  const pass = (last?.type === 'password' && visible(last) ? last : null) ?? passwordsIn(scope)[0] ?? passwordsIn(document)[0]
  const name = (last && last.type !== 'password' && isText(last) && visible(last) ? last : null) ?? (pass ? nameBefore(pass) : [...document.querySelectorAll('input')].find((el) => isText(el) && visible(el) && looksLikeName(el)))
  if (!pass && !name) return false
  if (pass && isNewPassword(pass) && ${onlyEmpty}) return false
  if (${onlyEmpty} && ((name && name.value) || (pass && pass.value))) return false
  if (name && ${JSON.stringify(username)}) put(name, ${JSON.stringify(username)})
  if (pass) put(pass, ${JSON.stringify(password)})
  return true
})()`

/** A new password, in every password field of the form being filled in (so its "confirm" too). */
const newPasswordCode = (password: string) => `(() => {
  ${PICK_FIELDS}
  const last = globalThis.scLoginField?.isConnected ? globalThis.scLoginField : null
  const fields = passwordsIn(last?.form ?? document).filter((el) => !/current-password/.test(hint(el)))
  for (const el of fields) put(el, ${JSON.stringify(password)})
  if (last?.type === 'password') last.focus()
  return fields.length
})()`

/**
 * Resolves the next time someone clicks into, or tabs to, a sign-in field (only real input counts),
 * with where it is in the page and what it's for. Remembers the field, so a fill goes into its form.
 */
const FIELD_FOCUS = `new Promise((resolve) => {
  if (globalThis.scFieldWatch) return
  globalThis.scFieldWatch = true
  ${PICK_FIELDS}
  const loginField = (el) => {
    if (!el || el.tagName !== 'INPUT' || !visible(el) || el.readOnly) return null
    if (el.type === 'password') return isNewPassword(el) ? 'new' : 'password'
    if (!isText(el)) return null
    if (/one-time-code|cc-/.test(hint(el))) return null
    const form = el.form ?? document
    if (passwordsIn(form).length > 0 && nameBefore(passwordsIn(form)[0]) === el) return 'username'
    return looksLikeName(el) && /username|email/.test(hint(el) + ' ' + el.type + ' ' + el.name + ' ' + el.id) ? 'username' : null
  }
  const onFocus = (e) => {
    if (Date.now() < (globalThis.scFillingUntil ?? 0)) return
    const el = e.composedPath?.()[0] ?? e.target
    const kind = loginField(el)
    if (!kind) return
    removeEventListener('focusin', onFocus, true)
    removeEventListener('mousedown', onDown, true)
    globalThis.scFieldWatch = false
    globalThis.scLoginField = el
    const box = el.getBoundingClientRect()
    resolve({ kind, x: box.left, y: box.top, width: box.width, height: box.height, filled: !!el.value })
  }
  // A click into a field that already has focus brings the list back.
  const onDown = (e) => { if (e.isTrusted && e.target === document.activeElement) onFocus(e) }
  addEventListener('focusin', onFocus, true)
  addEventListener('mousedown', onDown, true)
})`

export interface LoginFieldFocus {
  kind: 'username' | 'password' | 'new'
  x: number
  y: number
  width: number
  height: number
  filled: boolean
}

/** Never settles if the page goes away first. */
export async function nextLoginField(contents: WebContents): Promise<LoginFieldFocus | null> {
  const found = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: FIELD_FOCUS }]).catch(() => null)) as LoginFieldFocus | null
  if (!found || !['username', 'password', 'new'].includes(found.kind)) return null
  if (![found.x, found.y, found.width, found.height].every(Number.isFinite)) return null
  return found
}

/** Does the page's top frame have a sign-in form? Used before filling by itself on load. */
export function hasLoginForm(contents: WebContents): Promise<boolean> {
  return contents
    .executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => { ${PICK_FIELDS} return passwordsIn(document).length > 0 })()` }])
    .then((found) => found === true)
    .catch(() => false)
}

export function fillNewPassword(contents: WebContents, password: string): Promise<number> {
  return contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: newPasswordCode(password) }], true).then((n) => (typeof n === 'number' ? n : 0)).catch(() => 0)
}

/** Resolves with what was entered when someone signs in. Only real clicks and keys count, not a page's scripts. */
const WATCH = `new Promise((resolve) => {
  if (globalThis.scSignInWatch) return
  globalThis.scSignInWatch = true
  ${PICK_FIELDS}
  const done = (login) => {
    globalThis.scSignInWatch = false
    removeEventListener('submit', onSubmit, true)
    removeEventListener('click', onClick, true)
    removeEventListener('keydown', onKey, true)
    resolve(login)
  }
  const read = () => {
    const pass = [...document.querySelectorAll('input[type=password]')].find((el) => el.value && visible(el))
    if (pass) return done({ username: nameBefore(pass)?.value ?? '', password: pass.value })
    // The first step of a sign-in that asks for the name on a page of its own.
    const name = [...document.querySelectorAll('input')].find((el) => isText(el) && visible(el) && el.value && looksLikeName(el))
    if (name && passwordsIn(document).length === 0) done({ username: name.value, password: '' })
  }
  const onSubmit = (e) => e.isTrusted && read()
  const onKey = (e) => e.isTrusted && e.key === 'Enter' && e.target?.tagName === 'INPUT' && read()
  const onClick = (e) => {
    if (!e.isTrusted) return
    const button = e.target?.closest?.('button, input[type=submit], [role=button]')
    if (button && (button.type === 'submit' || /sign.?in|log.?in|continue|next|submit/i.test(button.textContent + button.value))) read()
  }
  addEventListener('submit', onSubmit, true)
  addEventListener('click', onClick, true)
  addEventListener('keydown', onKey, true)
})`

export function fillLogin(contents: WebContents, username: string, password: string, onlyEmpty = false): Promise<boolean> {
  return contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: fillCode(username, password, onlyEmpty) }], true).then((filled) => filled === true).catch(() => false)
}

/**
 * Fills empty fields, in the form being used or else the page, reading what each one is for from
 * its autocomplete hint and then its labels. Anything for a card, a login or an ID is left alone.
 */
const detailsCode = (identity: Identity) => {
  const [first = '', ...rest] = identity.fullName.split(/\s+/)
  const values = { ...identity, givenName: first, familyName: rest.join(' ') }
  return `(() => {
  const values = ${JSON.stringify(values)}
  const HINTS = { name: 'fullName', 'given-name': 'givenName', 'family-name': 'familyName', email: 'email', tel: 'phone', 'tel-national': 'phone', organization: 'organization', 'street-address': 'address1', 'address-line1': 'address1', 'address-line2': 'address2', 'address-level2': 'city', 'address-level1': 'region', 'postal-code': 'postalCode', country: 'country', 'country-name': 'country' }
  const SKIP = /user.?name|login|password|passcode|card|\\bcc\\b|cc-|cvv|cvc|iban|\\bssn\\b|passport|licen[cs]e|tax|captcha|coupon|promo|search|one-time/i
  const RULES = [
    ['email', /e.?mail/i], ['phone', /phone|mobile|\\btel\\b/i], ['organization', /company|organi[sz]ation|business/i],
    ['address2', /address.?(line)?.?2|addr.?2|apartment|\\bapt\\b|\\bunit\\b|suite/i], ['address1', /address.?(line)?.?1|addr.?1|street|address/i],
    ['city', /city|town|suburb|locality/i], ['postalCode', /post.?code|postal|\\bzip/i], ['region', /state|province|region|county/i], ['country', /country/i],
    ['givenName', /first.?name|given.?name|fname/i], ['familyName', /last.?name|family.?name|surname|lname/i], ['fullName', /full.?name|your.?name|\\bname\\b/i]
  ]
  const visible = (el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const describe = (el) => [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), ...[...(el.labels ?? [])].map((label) => label.textContent)].filter(Boolean).join(' ')
  const purpose = (el) => {
    const hint = (el.getAttribute('autocomplete') ?? '').trim().split(/\\s+/).at(-1)
    if (hint && HINTS[hint]) return HINTS[hint]
    if (/^(cc-|username|current-password|new-password|one-time-code)/.test(hint ?? '')) return null
    const text = describe(el)
    if (SKIP.test(text)) return null
    return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null
  }
  const put = (el, value) => {
    if (el.tagName === 'SELECT') {
      const wanted = value.toLowerCase()
      const option = [...el.options].find((o) => o.value.toLowerCase() === wanted || o.textContent.trim().toLowerCase() === wanted)
      if (!option) return false
      el.value = option.value
    } else {
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  const root = document.activeElement?.form ?? document
  let filled = 0
  for (const el of root.querySelectorAll('input, textarea, select')) {
    if (el.disabled || el.readOnly || !visible(el) || ['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'date', 'number', 'range', 'color'].includes(el.type)) continue
    if (el.tagName === 'SELECT' ? el.selectedIndex > 0 : el.value) continue
    const value = values[purpose(el)]
    if (value && put(el, value)) filled++
  }
  return filled
})()`
}

/** Only ever by request, and only in the page's top frame. Returns how many fields were filled. */
export function fillDetails(contents: WebContents, identity: Identity): Promise<number> {
  return contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: detailsCode(identity) }], true) as Promise<number>
}

export interface EnteredLogin {
  username: string
  password: string
}

/**
 * Never settles if the page goes away first, which is fine: there was no sign-in to offer. An empty
 * password is the name step of a sign-in split over two pages.
 */
export async function watchForSignIn(contents: WebContents): Promise<EnteredLogin | null> {
  const found = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: WATCH }]).catch(() => null)) as Partial<EnteredLogin> | null
  const { username, password } = found ?? {}
  if (typeof username !== 'string' || typeof password !== 'string' || (!password && !username) || username.length > MAX_FIELD || password.length > MAX_FIELD) return null
  return { username, password }
}

/** Clears itself, unless something else has been copied since. */
export function copySecret(secret: string): void {
  void clipboard.writeText(secret)
  setTimeout(() => {
    void Promise.resolve(clipboard.readText()).then((current) => {
      if (current === secret) void clipboard.clear()
    })
  }, CLIPBOARD_CLEAR_MS).unref?.()
}
