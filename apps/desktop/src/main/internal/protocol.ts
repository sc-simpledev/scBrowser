import { protocol, session } from 'electron'
import { newTabPage } from './newtab'

export const INTERNAL_SCHEME = 'sc'

/** Must run before `app.whenReady()`. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

const pages: Record<string, () => string> = {
  newtab: newTabPage
}

/** Serves `sc://<page>` internal pages to web content in the default session. */
export function handleInternalPages(): void {
  session.defaultSession.protocol.handle(INTERNAL_SCHEME, (request) => {
    const { host } = new URL(request.url)
    const render = pages[host]
    if (!render) return new Response('Not found', { status: 404 })
    return new Response(render(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'"
      }
    })
  })
}
