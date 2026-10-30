# scBrowser

A modern, AI-native browser for Linux and Windows, inspired by Firefox and Dia.
Built on Electron. See [Plan.md](Plan.md) for the product and technical roadmap.

## Getting started

Requires Node 22+ and pnpm 10 (`npm i -g pnpm`, or prefix commands with `npx pnpm@10`).

```bash
pnpm install
pnpm dev          # run with hot reload
pnpm typecheck
pnpm test
pnpm e2e          # drive the built app with Playwright
pnpm dist         # build installers into apps/desktop/release
```

## Layout

| Path | What lives there |
|---|---|
| `apps/desktop/src/main` | Main process: window, `TabManager`, keyboard shortcuts, IPC, `sc://` internal pages |
| `apps/desktop/src/preload` | The only bridge between the chrome UI and the main process (`window.scb`) |
| `apps/desktop/src/renderer` | Browser UI (React): chrome, the overlay above pages, and the `sc://` pages |
| `packages/ai` | AI providers, streaming and prompt context; pure TypeScript with no Electron |
| `packages/shared` | Typed IPC contract, tab types, omnibox URL/search resolution |
| `packages/ui` | Design system: tokens, Tailwind theme, base components |

## Design rules

- Colours, type, spacing, radii, shadows and motion come from `packages/ui/src/tokens.css`.
  The Tailwind theme (`theme.css`) removes all Tailwind defaults, so only token-based utilities exist.
- One icon set (Lucide, 1.5–1.75 stroke), one accent colour, three elevation levels.
- Web pages run sandboxed. A preload exists in every tab but exposes nothing except on `sc://` pages, which websites can't open or frame, and the main process re-checks the calling frame. The chrome UI only talks to the main process
  through the channels declared in `packages/shared/src/ipc.ts`, and every argument is validated.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl T / Ctrl Shift T | New tab / reopen closed tab |
| Ctrl W | Close tab |
| Ctrl L, Alt D, F6 | Focus the address bar |
| Ctrl R, F5 (Shift for hard reload) | Reload |
| Alt ← / Alt → | Back / forward |
| Ctrl Tab, Ctrl PgUp/PgDn, Ctrl 1–9 | Switch tabs |
| F12, Ctrl Shift I | Developer tools for the page |
| Ctrl F | Find in page |
| Ctrl D / Ctrl Shift B | Bookmark page / show bookmarks bar |
| Ctrl H, Ctrl J, Ctrl Shift O | History, downloads, bookmarks |
| Ctrl = / Ctrl - / Ctrl 0 | Zoom in / out / reset |
| Ctrl Shift A | Assistant |
| Ctrl P | Print |
| F11 | Full screen |
| Ctrl Q | Quit |
