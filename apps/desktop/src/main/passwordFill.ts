import { clipboard, type WebContents } from 'electron'

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
