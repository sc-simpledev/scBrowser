import { pageShell } from './shell'

const css = `
kbd {
  font: inherit;
  font-size: var(--sc-text-2xs);
  padding: 1px calc(var(--sc-space) * 1.5);
  border-radius: var(--sc-radius-sm);
  box-shadow: var(--sc-shadow-1);
  color: var(--sc-text-muted);
}`

const body = `<main>
  <h1 id="greeting">Hello</h1>
  <p>Search or enter an address above <kbd>Ctrl L</kbd></p>
</main>
<script>
  const hour = new Date().getHours()
  document.getElementById('greeting').textContent =
    hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
</script>`

export const newTabPage = () => pageShell('New tab', css, body)
