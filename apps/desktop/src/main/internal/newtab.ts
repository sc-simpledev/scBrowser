import geistFont from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline'
import tokensCss from '@scbrowser/ui/tokens.css?raw'

// Internal pages can't resolve package @imports, so tokens are inlined and the font
// is embedded as a data URL.
const tokens = tokensCss.replace(/^@import .*$/gm, '')

export function newTabPage(): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>New tab</title>
<style>
@font-face { font-family: 'Geist Variable'; font-weight: 100 900; src: url(${geistFont}) format('woff2'); }
${tokens}
html, body { height: 100%; margin: 0; }
body {
  display: grid;
  place-items: center;
  background: var(--sc-surface);
  color: var(--sc-text);
  font: var(--sc-weight-regular) var(--sc-text-sm) / var(--sc-leading-normal) var(--sc-font-sans);
  -webkit-font-smoothing: antialiased;
}
main { display: grid; gap: calc(var(--sc-space) * 3); justify-items: center; translate: 0 -8vh; }
h1 {
  margin: 0;
  font-size: var(--sc-text-xl);
  font-weight: var(--sc-weight-medium);
  letter-spacing: -0.02em;
  line-height: var(--sc-leading-tight);
}
p { margin: 0; color: var(--sc-text-muted); }
kbd {
  font: inherit;
  font-size: var(--sc-text-2xs);
  padding: 1px calc(var(--sc-space) * 1.5);
  border-radius: var(--sc-radius-sm);
  box-shadow: var(--sc-shadow-1);
  color: var(--sc-text-muted);
}
</style>
</head>
<body>
<main>
  <h1 id="greeting">Hello</h1>
  <p>Search or enter an address above <kbd>Ctrl L</kbd></p>
</main>
<script>
  const hour = new Date().getHours()
  document.getElementById('greeting').textContent =
    hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
</script>
</body>
</html>`
}
