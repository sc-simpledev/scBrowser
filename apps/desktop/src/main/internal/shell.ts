import geistFont from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline'
import tokensCss from '@scbrowser/ui/tokens.css?raw'

// Lightweight pages can't resolve package @imports, so tokens are inlined and the font
// is embedded as a data URL.
const tokens = tokensCss.replace(/^@import .*$/gm, '')

export function pageShell(title: string, css: string, body: string): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
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
${css}
</style>
</head>
<body>
${body}
</body>
</html>`
}
