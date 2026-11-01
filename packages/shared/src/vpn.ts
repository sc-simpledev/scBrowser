export type VpnProtocol = 'http' | 'https' | 'socks4' | 'socks5' | 'vless' | 'vmess' | 'trojan' | 'ss'

/** What the interface sees of a connection. The link itself holds secrets and stays in the main process. */
export interface VpnConnection {
  id: string
  name: string
  protocol: VpnProtocol
  host: string
  port: number
  groupId: string | null
}

export interface VpnGroup {
  id: string
  name: string
  /** Set when the group refreshes from a subscription. */
  subscription: boolean
}

export interface VpnState {
  enabled: boolean
  connecting: boolean
  activeId: string | null
  error: string | null
  connections: VpnConnection[]
  groups: VpnGroup[]
}

/** The short form the toolbar needs. */
export interface VpnSummary {
  available: boolean
  enabled: boolean
  connecting: boolean
  name: string | null
  error: string | null
}

export interface VpnAddResult {
  added: number
  skipped: number
}

export interface ParsedLink {
  protocol: VpnProtocol
  name: string
  host: string
  port: number
  username: string
  password: string
  /** Transport options from the link's query string. */
  params: Record<string, string>
}

const decodeBase64 = (text: string): string | null => {
  const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!clean || !/^[A-Za-z0-9+/=\s]+$/.test(clean)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(clean.replace(/\s/g, '').replace(/=+$/, '')), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

const decodeName = (hash: string) => {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    return hash.replace(/^#/, '')
  }
}

const validPort = (port: number) => Number.isInteger(port) && port > 0 && port <= 65_535

function parseVmess(link: string): ParsedLink | null {
  const json = decodeBase64(link.slice('vmess://'.length))
  if (!json) return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const port = Number(data.port)
  const text = (key: string) => (data[key] === undefined || data[key] === null ? '' : String(data[key]))
  if (!text('add') || !text('id') || !validPort(port)) return null
  return {
    protocol: 'vmess',
    name: text('ps') || text('add'),
    host: text('add'),
    port,
    username: text('id'),
    password: text('scy') || 'auto',
    params: { type: text('net') || 'tcp', headerType: text('type'), host: text('host'), path: text('path'), security: text('tls'), sni: text('sni'), alpn: text('alpn'), fp: text('fp') }
  }
}

function parseShadowsocks(link: string): ParsedLink | null {
  const rest = link.slice('ss://'.length)
  const hashAt = rest.indexOf('#')
  const name = hashAt === -1 ? '' : decodeName(rest.slice(hashAt))
  let body = (hashAt === -1 ? rest : rest.slice(0, hashAt)).split('?')[0]!
  let userinfo: string
  if (body.includes('@')) {
    const at = body.lastIndexOf('@')
    const user = decodeURIComponent(body.slice(0, at))
    userinfo = user.includes(':') ? user : (decodeBase64(user) ?? '')
    body = body.slice(at + 1)
  } else {
    const whole = decodeBase64(body)
    if (!whole?.includes('@')) return null
    const at = whole.lastIndexOf('@')
    userinfo = whole.slice(0, at)
    body = whole.slice(at + 1)
  }
  const colon = userinfo.indexOf(':')
  const portAt = body.lastIndexOf(':')
  const port = Number(body.slice(portAt + 1))
  if (colon === -1 || portAt === -1 || !validPort(port)) return null
  const host = body.slice(0, portAt).replace(/^\[|\]$/g, '')
  return { protocol: 'ss', name: name || host, host, port, username: userinfo.slice(0, colon), password: userinfo.slice(colon + 1), params: {} }
}

const SCHEMES: Record<string, VpnProtocol> = {
  'http:': 'http',
  'https:': 'https',
  'socks:': 'socks5',
  'socks5:': 'socks5',
  'socks5h:': 'socks5',
  'socks4:': 'socks4',
  'vless:': 'vless',
  'trojan:': 'trojan'
}

/** Reads one connection link, or null if it's a kind scDelta can't use. */
export function parseVpnLink(raw: string): ParsedLink | null {
  const link = raw.trim()
  if (/^vmess:\/\//i.test(link)) return parseVmess(link)
  if (/^ss:\/\//i.test(link)) return parseShadowsocks(link)
  if (!URL.canParse(link)) return null
  const url = new URL(link)
  const protocol = SCHEMES[url.protocol]
  // Non-special schemes keep their port in the host, so `URL` parses them all the same way.
  const port = Number(url.port || (protocol === 'http' ? 80 : protocol === 'https' ? 443 : 0))
  if (!protocol || !url.hostname || !validPort(port)) return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  return {
    protocol,
    name: decodeName(url.hash) || host,
    host,
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    params: Object.fromEntries(url.searchParams)
  }
}

/** Splits pasted text or a subscription, which is often one block of base64, into links. */
export function splitVpnLinks(text: string): string[] {
  const decoded = !text.includes('://') ? (decodeBase64(text) ?? text) : text
  return decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

/** Chromium can use these itself, so they don't need the Xray core. */
export const isDirectProxy = (link: ParsedLink) => ['http', 'https', 'socks4', 'socks5'].includes(link.protocol) && !link.username

export const proxyRule = ({ protocol, host, port }: Pick<ParsedLink, 'protocol' | 'host' | 'port'>) => `${protocol}://${host.includes(':') ? `[${host}]` : host}:${port}`

function streamSettings(link: ParsedLink): Record<string, unknown> {
  const { type = 'tcp', security = '', sni, host, path, alpn, fp, pbk, sid, spx, serviceName, headerType, allowInsecure } = link.params
  const network = type === 'h2' ? 'xhttp' : type || 'tcp'
  const stream: Record<string, unknown> = { network }
  const serverName = sni || host || link.host
  if (security === 'tls') {
    stream.security = 'tls'
    stream.tlsSettings = {
      serverName,
      ...(alpn ? { alpn: alpn.split(',') } : {}),
      ...(fp ? { fingerprint: fp } : {}),
      ...(allowInsecure === '1' ? { allowInsecure: true } : {})
    }
  } else if (security === 'reality') {
    stream.security = 'reality'
    stream.realitySettings = { serverName, publicKey: pbk ?? '', shortId: sid ?? '', fingerprint: fp || 'chrome', spiderX: spx ?? '' }
  }
  if (network === 'ws') stream.wsSettings = { path: path || '/', ...(host ? { host } : {}) }
  if (network === 'grpc') stream.grpcSettings = { serviceName: serviceName ?? path ?? '' }
  if (network === 'httpupgrade') stream.httpupgradeSettings = { path: path || '/', ...(host ? { host } : {}) }
  if (network === 'xhttp') stream.xhttpSettings = { path: path || '/', ...(host ? { host } : {}) }
  if (network === 'tcp' && headerType === 'http') {
    stream.tcpSettings = { header: { type: 'http', request: { path: [path || '/'], headers: { Host: (host || link.host).split(',') } } } }
  }
  return stream
}

function outbound(link: ParsedLink): Record<string, unknown> {
  const { host: address, port, username, password, params } = link
  switch (link.protocol) {
    case 'vless':
      return { protocol: 'vless', settings: { vnext: [{ address, port, users: [{ id: username, encryption: params.encryption || 'none', ...(params.flow ? { flow: params.flow } : {}) }] }] }, streamSettings: streamSettings(link) }
    case 'vmess':
      return { protocol: 'vmess', settings: { vnext: [{ address, port, users: [{ id: username, security: password || 'auto' }] }] }, streamSettings: streamSettings(link) }
    case 'trojan':
      return { protocol: 'trojan', settings: { servers: [{ address, port, password: username }] }, streamSettings: streamSettings({ ...link, params: { security: 'tls', ...params } }) }
    case 'ss':
      return { protocol: 'shadowsocks', settings: { servers: [{ address, port, method: username, password }] } }
    case 'http':
    case 'https':
      return {
        protocol: 'http',
        settings: { servers: [{ address, port, users: [{ user: username, pass: password }] }] },
        ...(link.protocol === 'https' ? { streamSettings: { security: 'tls', tlsSettings: { serverName: address } } } : {})
      }
    default:
      return { protocol: 'socks', settings: { servers: [{ address, port, users: [{ user: username, pass: password }] }] } }
  }
}

/** A config that takes browser traffic on a local port and sends it through the link. */
export function xrayConfig(link: ParsedLink, localPort: number): unknown {
  return {
    log: { loglevel: 'none' },
    inbounds: [{ listen: '127.0.0.1', port: localPort, protocol: 'socks', settings: { auth: 'noauth', udp: false } }],
    outbounds: [outbound(link)]
  }
}

/** Fastest first, with anything that didn't answer last. */
export function byPing<T extends { id: string }>(items: T[], pings: Record<string, number | null>): T[] {
  const time = (item: T) => pings[item.id] ?? Number.POSITIVE_INFINITY
  return [...items].sort((a, b) => time(a) - time(b))
}
