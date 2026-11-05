import { clipboard, type WebContents } from 'electron'
import type { Identity } from '@scbrowser/shared'

/** Its own isolated world, so the page's scripts can't see what's done here. */
const WORLD = 1004
const MAX_FIELD = 4096
const CLIPBOARD_CLEAR_MS = 30_000

const PICK_FIELDS = `
  const visible = (el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const isText = (el) => ['text', 'email', 'tel', ''].includes(el.getAttribute('type') ?? '') || el.type === 'text'
  const nameBefore = (pass) => {
    const inputs = [...(pass.form ?? document).querySelectorAll('input')]
    return inputs.slice(0, inputs.indexOf(pass)).filter((el) => isText(el) && visible(el)).at(-1) ?? null
  }
`

/** Fills the first visible sign-in fields. A site that asks for the name first gets just that. */
const fillCode = (username: string, password: string) => `(() => {
  ${PICK_FIELDS}
  const put = (el, value) => {
    el.focus()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const pass = [...document.querySelectorAll('input[type=password]')].find(visible)
  const name = pass ? nameBefore(pass) : [...document.querySelectorAll('input')].find((el) => isText(el) && visible(el) && /user|email|login|name/i.test(el.name + el.id + el.autocomplete))
  if (!pass && !name) return false
  if (name) put(name, ${JSON.stringify(username)})
  if (pass) put(pass, ${JSON.stringify(password)})
  return true
})()`

/** Resolves with what was entered when someone signs in. Only real clicks and keys count, not a page's scripts. */
const WATCH = `new Promise((resolve) => {
  if (globalThis.scSignInWatch) return
  globalThis.scSignInWatch = true
  ${PICK_FIELDS}
  const read = () => {
    const pass = [...document.querySelectorAll('input[type=password]')].find((el) => el.value && visible(el))
    if (!pass) return
    globalThis.scSignInWatch = false
    removeEventListener('submit', onSubmit, true)
    removeEventListener('click', onClick, true)
    removeEventListener('keydown', onKey, true)
    resolve({ username: nameBefore(pass)?.value ?? '', password: pass.value })
  }
  const onSubmit = (e) => e.isTrusted && read()
  const onKey = (e) => e.isTrusted && e.key === 'Enter' && e.target?.type === 'password' && read()
  const onClick = (e) => {
    if (!e.isTrusted) return
    const button = e.target?.closest?.('button, input[type=submit], [role=button]')
    if (button && (button.type === 'submit' || /sign.?in|log.?in|continue|next|submit/i.test(button.textContent + button.value))) read()
  }
  addEventListener('submit', onSubmit, true)
  addEventListener('click', onClick, true)
  addEventListener('keydown', onKey, true)
})`

export function fillLogin(contents: WebContents, username: string, password: string): Promise<boolean> {
  return contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: fillCode(username, password) }], true) as Promise<boolean>
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

/** Never settles if the page goes away first, which is fine: there was no sign-in to offer. */
export async function watchForSignIn(contents: WebContents): Promise<EnteredLogin | null> {
  const found = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: WATCH }]).catch(() => null)) as Partial<EnteredLogin> | null
  const { username, password } = found ?? {}
  if (typeof username !== 'string' || typeof password !== 'string' || !password || username.length > MAX_FIELD || password.length > MAX_FIELD) return null
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
