import { pageShell } from './shell'

const css = `
main { max-width: 480px; padding: 0 calc(var(--sc-space) * 6); text-align: center; }
h1 { font-size: var(--sc-text-lg); }
#url { overflow-wrap: anywhere; color: var(--sc-text-faint); font-size: var(--sc-text-xs); }
#code { color: var(--sc-text-faint); font-family: var(--sc-font-mono); font-size: var(--sc-text-2xs); }
#code:empty { display: none; }
.actions { display: flex; flex-wrap: wrap; gap: calc(var(--sc-space) * 2); justify-content: center; }
button {
  height: calc(var(--sc-space) * 8);
  padding: 0 calc(var(--sc-space) * 3);
  border: 1px solid transparent;
  border-radius: var(--sc-radius-md);
  background: var(--sc-text);
  color: var(--sc-surface);
  font: inherit;
  font-weight: var(--sc-weight-medium);
}
button:hover { opacity: 0.85; }
button.secondary { background: var(--sc-surface); border-color: var(--sc-border); color: var(--sc-text); }
button.secondary:hover { opacity: 1; background: var(--sc-surface-hover); }
button[hidden] { display: none; }`

// The URL and reason come from the query string, so they're only ever set as text.
const body = `<main>
  <h1>This page didn't load</h1>
  <p id="reason"></p>
  <p id="url"></p>
  <div class="actions">
    <button id="retry" type="button">Try again</button>
    <button id="http" type="button" class="secondary" hidden>Continue without HTTPS</button>
  </div>
  <p id="code"></p>
</main>
<script>
  // What Chromium's error names mean, in words. The name itself stays below, small, for searching.
  const WORDS = {
    ERR_NAME_NOT_RESOLVED: "The site's address couldn't be found. Check it for a typo, or try again later.",
    ERR_INTERNET_DISCONNECTED: "You're not connected to the internet.",
    ERR_NETWORK_CHANGED: 'Your network changed while the page was loading.',
    ERR_CONNECTION_REFUSED: 'The site refused to connect. It may be down for now.',
    ERR_CONNECTION_RESET: 'The connection to the site was cut off.',
    ERR_CONNECTION_CLOSED: 'The site closed the connection without sending the page.',
    ERR_EMPTY_RESPONSE: 'The site sent nothing back.',
    ERR_CONNECTION_TIMED_OUT: 'The site took too long to answer.',
    ERR_TIMED_OUT: 'The site took too long to answer.',
    ERR_ADDRESS_UNREACHABLE: "The site can't be reached from this network.",
    ERR_PROXY_CONNECTION_FAILED: "The proxy or VPN isn't answering. Check it, or turn it off and try again.",
    ERR_TUNNEL_CONNECTION_FAILED: "The proxy or VPN couldn't reach the site.",
    ERR_SSL_PROTOCOL_ERROR: "The site's secure connection failed.",
    ERR_TOO_MANY_REDIRECTS: 'The site keeps sending the browser round in a loop.',
    ERR_UNSAFE_PORT: 'This address uses a port that browsers block for safety.',
    ERR_FILE_NOT_FOUND: "That file isn't there any more.",
    ERR_ACCESS_DENIED: "scTerra isn't allowed to open that file."
  }
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? ''
  const reason = params.get('reason') ?? ''
  const code = /^(net::)?(ERR_[A-Z_]+)$/.exec(reason.trim())?.[2] ?? null
  const words = code ? (WORDS[code] ?? (code.startsWith('ERR_CERT_') ? "The site's security certificate can't be trusted, so scTerra didn't open it." : null)) : null
  document.getElementById('reason').textContent = words ?? reason
  document.getElementById('code').textContent = words ? code : ''
  document.getElementById('url').textContent = url
  document.getElementById('retry').addEventListener('click', () => { if (/^https?:/i.test(url)) location.replace(url) })
  const http = params.get('http')
  if (http && /^http:/i.test(http)) {
    const button = document.getElementById('http')
    button.hidden = false
    button.addEventListener('click', () => {
      window.scbInternal.invoke('privacy:allow-http', http).then(() => location.replace(http))
    })
  }
</script>`

export const errorPage = () => pageShell("This page didn't load", css, body)
