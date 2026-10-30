import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol, session } from 'electron'
import { INTERNAL_PAGES, type InternalPage } from '@scbrowser/shared'
import { errorPage } from './error'
import { newTabPage } from './newtab'

export const INTERNAL_SCHEME = 'sc'

/** Must run before `app.whenReady()`. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

const staticPages: Record<string, () => string> = {
  newtab: newTabPage,
  error: errorPage
}

/** Internal pages can never be framed by a website. */
const FRAME_POLICY = "frame-ancestors 'none'"

const isAppPage = (host: string): host is InternalPage => (INTERNAL_PAGES as readonly string[]).includes(host)

/** The React pages share one bundle, served from the build output (or dev server). */
async function serveAppPage(url: URL): Promise<Response> {
  const path = url.pathname === '/' ? '/internal.html' : url.pathname
  const devServer = process.env.ELECTRON_RENDERER_URL
  let response: Response
  if (devServer) {
    response = await net.fetch(`${devServer}${path}${url.search}`)
  } else {
    const root = join(__dirname, '../renderer')
    const file = normalize(join(root, decodeURIComponent(path)))
    if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    response = await net.fetch(pathToFileURL(file).toString())
  }
  const headers = new Headers(response.headers)
  headers.set('content-security-policy', FRAME_POLICY)
  return new Response(response.body, { status: response.status, headers })
}

/** Serves `sc://<page>` internal pages to tabs in the default session. */
export function handleInternalPages(): void {
  session.defaultSession.protocol.handle(INTERNAL_SCHEME, (request) => {
    const url = new URL(request.url)
    if (isAppPage(url.host)) return serveAppPage(url)
    const render = staticPages[url.host]
    if (!render) return new Response('Not found', { status: 404 })
    return new Response(render(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; ${FRAME_POLICY}`
      }
    })
  })
}
