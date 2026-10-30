import { pageShell } from './shell'

const css = `
main { max-width: 480px; padding: 0 calc(var(--sc-space) * 6); text-align: center; }
h1 { font-size: var(--sc-text-lg); }
#url { overflow-wrap: anywhere; color: var(--sc-text-faint); font-size: var(--sc-text-xs); }
button {
  height: calc(var(--sc-space) * 8);
  padding: 0 calc(var(--sc-space) * 3);
  border: 0;
  border-radius: var(--sc-radius-md);
  background: var(--sc-accent);
  color: var(--sc-on-accent);
  font: inherit;
  font-weight: var(--sc-weight-medium);
}
button:hover { background: var(--sc-accent-hover); }
button.secondary { background: var(--sc-field); color: var(--sc-text); }
button[hidden] { display: none; }`

// The URL and reason come from the query string, so they're only ever set as text.
const body = `<main>
  <h1>This page didn't load</h1>
  <p id="reason"></p>
  <p id="url"></p>
  <button id="retry" type="button">Try again</button>
  <button id="http" type="button" class="secondary" hidden>Continue without HTTPS</button>
</main>
<script>
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? ''
  document.getElementById('reason').textContent = params.get('reason') ?? ''
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
