import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol, session } from 'electron'
import { INTERNAL_PAGES } from '@scbrowser/shared'
import { handlePreviews, PREVIEW_SCHEME } from '../filePreview'
import { MINI_APP_SCHEME } from '../miniApps'
import { errorPage } from './error'
import { READER_CSP, readerPage } from './reader'

export const INTERNAL_SCHEME = 'sc'

/** Must run before `app.whenReady()`. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // Nothing more than an address of its own: no fetch, no bypassing its policy.
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true } },
    // A kept mini app: an origin of its own so its storage lasts, and nothing else.
    { scheme: MINI_APP_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

const staticPages: Record<string, () => string> = {
  error: errorPage
}

/** Internal pages can never be framed by a website. */
const FRAME_POLICY = "frame-ancestors 'none'"

const isAppPage = (host: string): boolean => host === 'newtab' || host === 'blocked' || host === 'pdf' || host === 'welcome' || (INTERNAL_PAGES as readonly string[]).includes(host)

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
export function handleInternalPages(target = session.defaultSession): void {
  handlePreviews(target)
  target.protocol.handle(INTERNAL_SCHEME, (request) => {
    const url = new URL(request.url)
    if (isAppPage(url.host)) return serveAppPage(url)
    if (url.host === 'reader') {
      const page = readerPage(url.searchParams.get('id'))
      if (!page) return new Response('This article has expired.', { status: 404 })
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': READER_CSP } })
    }
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
