# scTerra: context for a new session

scTerra (formerly scDelta, and before that scBrowser) is an Electron browser for Linux, Windows and macOS with AI built in, inspired by Firefox and Dia. Its catchphrase is "Browse the World". Read [Plan.md](Plan.md) for the roadmap and status checklist, and [README.md](README.md) for layout and shortcuts. The repo is private: `sc-simpledev/scBrowser`, branch `main`.

## How to work with the owner

- Commit and push only when asked. They usually say "Commit and push" after each round. Work directly on `main`. A coworker also commits there, so pull first. `theme.html` in the root is the owner's scSpace style reference: don't commit it.
- Commits need `git -c user.name=... -c user.email=...` using the last commit's author, as no git identity is set on this machine.
- Don't spend their AI credit without asking. Live requests to the hosted server use real keys.
- They want it modern but not "vibe coded": follow the design rules in Plan.md and use tokens, not raw colours or sizes. They've pulled back glass, pills and big shadows once already: flat surfaces with thin borders, 4/6/10 radii, glass only on popups and new tab cards.
- Report honestly what was and wasn't tested. Say so when something only ran against mocks.
- Rebuild the Linux beta after a round of changes, and tell them where it is. Run `build` before `electron-builder`, which packages whatever is already in `out/`.
- Signing, store distribution and extra update channels are on hold until they say otherwise.

## Commands

pnpm isn't installed globally, so use `npx pnpm@10.34.9`.

```bash
npx pnpm@10.34.9 dev
npx pnpm@10.34.9 typecheck
npx pnpm@10.34.9 test
npx pnpm@10.34.9 build
npx playwright test --timeout 20000
```

Build first, because E2E tests run the built app. To build and test the packaged app, fetch the Xray VPN core once first. Packaging stops if it's missing:

```bash
node apps/desktop/scripts/fetch-xray.mjs
```

```bash
cd apps/desktop && npx electron-builder --linux AppImage deb
```

```bash
SCB_E2E_EXECUTABLE="$PWD/apps/desktop/release/0.2.0/linux-unpacked/scterra" npx playwright test --timeout 20000
```

The beta lands in `apps/desktop/release/<version>/`, which git ignores. CI (`.github/workflows/ci.yml`) runs on Linux and Windows, plus a Deno job for `server/`, and uploads installers as artifacts. `macos.yml` is run by hand from the Actions tab, as a private repo's macOS minutes count ten times over. `release.yml` runs on a `v*` tag. See [docs/auto-update.md](docs/auto-update.md).

Deno isn't installed. To run server tests locally, use the npm package `deno`, then `deno test --allow-env` inside `server/`.

## Layout

| Path | Contents |
|---|---|
| `apps/desktop/src/main` | Main process: `window.ts` wires everything, `updater.ts`, `httpAuth.ts`, `private.ts`, `siteIcons.ts`, `internal/pdf.ts`, `tabs/TabManager.ts`, `ipc.ts`, `internalIpc.ts`, `overlay.ts`, `ai/`, `privacy/`, `storage/`, `import/`, `extensions.ts`, `blocker.ts`, `vpn.ts`, `sync.ts`, `reporter.ts`, `profiles.ts`, `flags.ts` |
| `apps/desktop/src/preload` | Bridges: `index.ts` (browser UI), `overlay.ts`, `internal.ts` (sc:// pages only) |
| `apps/desktop/src/renderer/src` | Browser UI in `components/`, overlay UI in `overlay/`, sc:// pages in `internal/` (the intro is `internal/welcome/`), reply and report rendering in `shared/` |
| `packages/shared` | IPC contracts, settings, omnibox logic, reports, privacy helpers |
| `packages/ai` | Providers, prompts, parsers for AI tasks. No Electron |
| `packages/ui` | Tokens, Tailwind theme, components, `content.css` (replies and report themes) |
| `server` | Deno service for hosted AI. Deployed at `https://sc-delta-ai.scspacedev.deno.net` |
| `e2e` | Playwright tests. `app.ts` is the harness, `aiMock.ts` fakes OpenAI and Anthropic servers |

## Architecture rules

- The main process owns all state. Every IPC channel is declared in `packages/shared/src/ipc.ts` and validated in the main process.
- Tabs are sandboxed `WebContentsView`s. Native views draw above the browser UI, so popups that cover a page must go in the overlay view (`overlay.ts` and `renderer/src/overlay`).
- `sc://` pages get `window.scbInternal`, and the main process checks the calling frame. Websites must never reach them: navigation, redirects, iframes and `window.open` are all blocked.
- Page content is untrusted. It's read in isolated worlds and wrapped in `<page>` tags. Replies never render images or raw HTML.
- API keys stay in the main process, encrypted with `safeStorage`. Never send them to a renderer. Use only its async calls (`encryptStringAsync`, `decryptStringAsync`, `isAsyncEncryptionAvailable`): with KDE Wallet (the owner runs Kubuntu) the old synchronous ones report no encryption at all, which stopped VPN links saving. Dev builds use `basic_text`, so only packaged builds show this.
- The owner's desktop is Kubuntu with a Windows-style theme, so screenshots can look like Windows.
- Parsing PDFs happens in a separate utility process, never in the main process.
- The new tab picture reaches `sc://newtab` only through the internal bridge, so it has no address a website could load. It stays in the profile folder and isn't synced.
- The sync folder only ever holds ciphertext. The passphrase isn't stored, and the derived key is kept with `safeStorage`.
- Crash reports and usage stats are opt-in, and hold no addresses, titles or error messages. `scrubStack` removes folders and messages.
- Page loads are screened in `PrivacyService.attach`, before anything is sent. Category checks hold the load for up to 6 seconds, then let it through.
- VPN links hold passwords, so they stay encrypted in the main process and never reach a renderer. The toolbar and `sc://vpn` only see names, hosts and ports.
- Site icons are saved as data addresses in `site_icons`, only for bookmarked hosts, so drawing the bar contacts nobody. Sites that were never visited are asked for `/favicon.ico` once per run.
- Private windows skip history and icon saving, and take no AI keys. They're processes, because IPC handlers assume one window per process.
- Agent mode needs approval for every click, entry and navigation. Private fields are refused in `ai/agent.ts`, not left to the model.
- Nothing goes to an AI provider unless the person acts. Respect the per-site AI off list.
- The address bar's answer card only runs once someone picks Ask scTerra, and never includes page text.
- HTTP sign-in passwords go straight to Chromium and are never stored. The box closes if the page navigates away, so it can't sit over another site.
- OCR runs in the sandboxed `sc://pdf` page from files in the app (`public/ocr`, copied at build time). No scan leaves the computer.
- Workspaces: `TabManager.snapshot()` only returns the open workspace's tabs, so the UI needs no filtering. Use `allContents()` for anything that must reach every tab.
- Saved reports are built by `reportHtml`, which escapes all text and carries a CSP blocking scripts and network requests.
- Claude calls use the official SDK (v1.3, which sends keys as `Authorization: Bearer`). Other providers use the OpenAI-compatible adapter.

## Hosted AI server

Deployed on Deno Deploy with `server/main.ts` as the entrypoint from the repo root. Deno Deploy has no app directory setting. The browser's address is `HOSTED_AI_URL` in `packages/shared/src/ai.ts`, including `/v1`.

Routes come from `API_KEY_n`, `MODEL_n`, `REASONING_n`, `BASE_URL_n`, `WEIGHTING_n` and `FORMAT_n`. Two or more routes means random weighted routing, with failover before any text is sent. `BASE_URL_n` includes `/v1` for OpenAI format and leaves it out for Anthropic format. Limits and details are in [server/README.md](server/README.md). The live server returned a real reply when last tested.

## Status

Phases 0 to 5 are built, apart from signing, stores and extra update channels, which are on hold. Since then: site blocker, VPN with a bundled Xray core, bookmark groups and icons, private windows, the PDF viewer, the scSpace look, auto-updates, the first-run intro, workspaces, tab clean-up, inline address bar answers, HTTP sign-in, OCR, and macOS builds. See Plan.md for what each does.

Updates publish to the public `sc-simpledev/scTerra` repo, renamed from scDelta on 2026-11-03. The source repo stays private, and only installers go to that repo.

Open items:
- CI: E2E failures used to stop the installer step, which looked like a broken build. Installers now build regardless, and CI retries flaky tests twice.
- A real AI provider hasn't been used through the browser UI. Everything in the app was tested against mocks, so reports, agent mode, translation, inline answers, AI tab clean-up and the scAI identity need real-model checks.
- DRM (Netflix, Spotify) isn't in. It needs castLabs' Electron, whose newest stable build (44.9.3 in November 2026) is behind our 45.1.0, plus VMP signing for Windows and macOS. It was never run here. Don't swap the engine without the owner's say.
- Before the first release, add the `RELEASE_TOKEN` secret. See docs/auto-update.md. Copies older than 0.2.0 can't update themselves.
- macOS has never been run. Builds are unsigned, so they can't install updates: the app offers the release page instead. Windows and .deb updates are also untested. Only an AppImage update has been done for real.
- Saved reports can't be saved from the side panel, only from `sc://assistant`.
- Bookmark group order doesn't sync, only names and membership.
- The intro has night and daytime scenes, following the theme. It was checked on an Intel GPU at 1320 by 860, and falls back to a plain gradient without WebGL 2.
- The overlay takes clicks wherever it's drawn, and has no way to let them through. Keep popup regions tight: tooltips only cover their own bubble and clear as soon as the pointer moves. The Settings link fix for this couldn't be tried with a real mouse here.
- Assistant, Profiles and More are fixed at the end of the toolbar. Below 760 pixels wide (`compact`), spare buttons move into More and the sidebar becomes a rail.
- Extensions are a supported subset of Chrome's APIs. Bitwarden's install, background worker and popup were tested live; its sign-in and autofill weren't. Firefox extensions can't run.
- VPN checked live against the FastNodes list: real TLS and Reality nodes carried traffic, but most public nodes are dead, and Xray itself refuses VLESS and Trojan without TLS to public addresses. Ping is a real request through each connection, so free lists mostly show Not working. That's accurate.
- Sync goes through a folder, not a server, and was tested between two simulated devices, not two computers.
- The server's `/v1/reports` route needs deploying before reports go anywhere. Native crash dumps aren't collected.
- The accent tint is off by default, using `data-tint` on the root. Glass is only for popups and new tab cards.
- With the sandbox on, a page that segfaults didn't reach the crashed-page screen under Playwright, though one that's killed did. Check this by hand in a real build.
- Phase 0 remaining: Storybook, token lint rule, Style Dictionary.
- Saved permissions are shared across containers.
- The app was renamed from scDelta on 2026-11-02. The profile is copied on first launch and the old folder stays, but the rename changes the system keychain entry, so AI keys, VPN links and the sync key need adding again. The old `scdelta` package has to be uninstalled by hand.
- Names deliberately left alone: `sc-simpledev/scBrowser` (private repo, which Deno Deploy and the coworker's clone point at), `@scbrowser/*` packages, the hosted address `sc-delta-ai.scspacedev.deno.net`, the `scdelta-sync.bin` file so sync keeps working, and reading old `scdelta-report` blocks in saved chats.
- The hosted server has IP limits but no sign-in, so it can be used as a free API from outside the browser.

## Test pitfalls

- Playwright's simulated keys don't reach `before-input-event`. Use `shortcut()` from `e2e/app.ts` for browser shortcuts.
- Playwright clicks don't move native focus between views. `toBeFocused` also only checks DOM focus, so check `getFocusedWebContents()` when real keyboard focus matters.
- `app.firstWindow()` may be the overlay, so use the harness's `chrome` page.
- Playwright forces light mode unless launched with `colorScheme: null`.
- Screenshots of the browser UI don't include native page views, so the page area appears blank.
- First-run tests need `SCB_WELCOME=1`, as the intro is off under `SCB_E2E`. `SCB_UPDATE_URL` points updates at a local feed, under `SCB_E2E` only.
- Don't name a process in the same shell command that `pgrep -f` or `pkill -f` looks for it: the command matches itself and kills the shell.
- Tests set `SCTERRA_AI_URL=off` and use `SCB_FILTERS` to avoid the network. `SCB_E2E` exposes `scbTabs`, `scbActions` and `scbExtensions` on the main process.
- Playwright turns the sandbox off, and service worker extensions then lose the extra `chrome.*` APIs. Launch with `SCB_E2E_SANDBOX: '1'` for those tests.
- VPN tests get `<-loopback>` in the bypass rules under `SCB_E2E`, so local servers go through the proxy.
- `e2e/xray.spec.ts` makes real connections through a local Xray server, and is skipped if the core hasn't been fetched.
- `SCB_VPN_PROBE=host:port` points VPN pings at a local page. `serveSite` answers `/generate_204`.
- Pages fill the window edge to edge, with no inset or rounded corners (`PAGE_RADIUS` is 0).
- Don't take desktop screenshots with spectacle: it can capture the owner's own windows.
- `pkill -f` patterns can match your own shell. Use `pgrep -f "dist/electro[n]" | xargs -r kill -9`.
- Code running during shutdown must guard against the destroyed window and closed database.
- An unexplained session-restore test failure and a history shortcut failure each happened once, in full runs. Neither recurred after repeats, so watch for them.
