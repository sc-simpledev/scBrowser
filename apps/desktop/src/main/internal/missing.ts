import { pageShell } from './shell'

const css = `
main { max-width: 480px; padding: 0 calc(var(--sc-space) * 6); text-align: center; }
h1 { font-size: var(--sc-text-lg); }
#address { overflow-wrap: anywhere; color: var(--sc-text-faint); font-family: var(--sc-font-mono); font-size: var(--sc-text-xs); }
.actions { display: flex; flex-wrap: wrap; gap: calc(var(--sc-space) * 2); justify-content: center; }
a {
  display: inline-flex;
  align-items: center;
  height: calc(var(--sc-space) * 8);
  padding: 0 calc(var(--sc-space) * 3);
  border: 1px solid var(--sc-border);
  border-radius: var(--sc-radius-md);
  background: var(--sc-surface);
  color: var(--sc-text);
  font-weight: var(--sc-weight-medium);
  text-decoration: none;
}
a:hover { background: var(--sc-surface-hover); }
a.primary { border-color: transparent; background: var(--sc-text); color: var(--sc-surface); }
a.primary:hover { background: var(--sc-text); opacity: 0.85; }`

/**
 * What an sc:// address that isn't one of scTerra's pages shows, and a reader article that has
 * gone: a page in the same style as the rest, rather than a bare line of text.
 */
export function missingPage(kind: 'page' | 'article'): string {
  const [title, said] =
    kind === 'article'
      ? ['This article has gone', 'Reader view keeps an article only while its tab is open. Open the page again for a fresh copy.']
      : ['There’s no page here', 'This isn’t one of scTerra’s pages. Its own pages are listed in the sidebar of Settings.']
  // The address is only ever set as text, from the page's own location.
  const body = `<main>
  <h1>${title}</h1>
  <p>${said}</p>
  ${kind === 'page' ? '<p id="address"></p>' : ''}
  <div class="actions">
    <a class="primary" href="sc://newtab/">New tab</a>
    <a href="sc://settings/">Settings</a>
  </div>
</main>
${kind === 'page' ? `<script>document.getElementById('address').textContent = location.href.replace(/\\/$/, '')</script>` : ''}`
  return pageShell(title, css, body)
}
