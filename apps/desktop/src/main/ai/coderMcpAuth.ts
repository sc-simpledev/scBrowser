import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { safeStorage } from 'electron'
import type { KeyValueRepo } from '../storage/kv'

const AUTH_KEY = 'coder:mcp-auth'
/** Sign-in finishes on the computer itself, at a port that stays the same for each server. */
const FIRST_PORT = 33418
const PORTS = 80
const SIGN_IN_MS = 5 * 60_000

interface Saved {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  verifier?: string
}

/** A server's own port for finishing sign-in, so the address it was registered with still works next time. */
export const callbackPort = (server: string) => FIRST_PORT + (createHash('sha256').update(server).digest().readUInt16BE(0) % PORTS)

/**
 * What remote MCP servers handed over at sign-in: the app's registration with them and its
 * tokens. Kept encrypted with the system keychain, as tokens are keys to the person's accounts.
 */
export class McpAuthStore {
  private cache: Record<string, Saved> | null = null

  constructor(private readonly kv: KeyValueRepo) {}

  private async all(): Promise<Record<string, Saved>> {
    if (this.cache) return this.cache
    const stored = this.kv.get(AUTH_KEY)
    let data: Record<string, Saved> = {}
    if (typeof stored === 'string' && (await safeStorage.isAsyncEncryptionAvailable())) {
      try {
        data = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))).result) as Record<string, Saved>
      } catch {
        data = {}
      }
    }
    this.cache = data
    return data
  }

  async get(server: string): Promise<Saved> {
    return (await this.all())[server] ?? {}
  }

  async update(server: string, patch: Partial<Saved> | null): Promise<void> {
    const data = { ...(await this.all()) }
    if (patch === null) delete data[server]
    else data[server] = { ...data[server], ...patch }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("This computer's keychain isn't available, so sign-ins can't be kept safely.")
    this.kv.set(AUTH_KEY, (await safeStorage.encryptStringAsync(JSON.stringify(data))).toString('base64'))
    this.cache = data
  }

  async signedIn(server: string): Promise<boolean> {
    return !!(await this.get(server)).tokens
  }
}

/** The SDK's sign-in steps for one server, with what they keep going to the store. */
export class McpOAuth implements OAuthClientProvider {
  /** Set when the server wants the person to sign in, to open when they choose to. */
  authorizationUrl: URL | null = null

  constructor(
    private readonly store: McpAuthStore,
    private readonly server: string
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${callbackPort(this.server)}/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'scTerra', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }
  }

  async clientInformation() {
    return (await this.store.get(this.server)).client
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    await this.store.update(this.server, { client })
  }

  async tokens() {
    return (await this.store.get(this.server)).tokens
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.store.update(this.server, { tokens })
  }

  redirectToAuthorization(url: URL) {
    // Never opened by itself: the person presses Sign in.
    this.authorizationUrl = url
  }

  async saveCodeVerifier(verifier: string) {
    await this.store.update(this.server, { verifier })
  }

  async codeVerifier() {
    const verifier = (await this.store.get(this.server)).verifier
    if (!verifier) throw new Error('Sign-in was started somewhere else. Try again.')
    return verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') await this.store.update(this.server, null)
    else if (scope === 'client') await this.store.update(this.server, { client: undefined })
    else if (scope === 'tokens') await this.store.update(this.server, { tokens: undefined })
    else if (scope === 'verifier') await this.store.update(this.server, { verifier: undefined })
  }
}

/**
 * Waits for the service to send the person back with a sign-in code, on the computer's own
 * address only. Gives up after five minutes.
 */
export function waitForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      if (url.pathname !== '/callback') return void response.writeHead(404).end()
      const code = url.searchParams.get('code')
      const problem = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" })
      response.end(`<!doctype html><title>scTerra</title><body style="font:15px system-ui;margin:4rem;color:#222">${code ? 'Signed in. You can close this tab and go back to Terra Code.' : 'Sign-in didn’t finish. Go back to Terra Code and try again.'}</body>`)
      finish(code ? null : new Error(problem ? `Sign-in failed: ${problem.slice(0, 200)}` : 'Sign-in didn’t finish.'), code)
    })
    const timer = setTimeout(() => finish(new Error('Sign-in took too long. Try again.'), null), SIGN_IN_MS)
    let done = false
    const finish = (error: Error | null, code: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      server.close()
      if (error) reject(error)
      else resolve(code!)
    }
    server.on('error', (error) => finish(new Error(`Sign-in couldn't listen for the answer: ${error.message}`), null))
    server.listen(port, '127.0.0.1')
  })
}
