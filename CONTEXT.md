# scDelta: context for a new session

scDelta (formerly scBrowser) is an Electron browser for Linux and Windows with AI built in, inspired by Firefox and Dia. Read [Plan.md](Plan.md) for the roadmap and status checklist, and [README.md](README.md) for layout and shortcuts. The repo is private: `sc-simpledev/scBrowser`, branch `main`.

## How to work with the owner

- Commit and push only when asked. They usually say "Commit and push" after each round.
- Don't spend their AI credit without asking. Live requests to the hosted server use real keys.
- They want it modern but not "vibe coded": follow the design rules in Plan.md and use tokens, not raw colours or sizes.
- Report honestly what was and wasn't tested. Say so when something only ran against mocks.
- Rebuild the Linux beta after a round of changes, and tell them where it is.
- Signing, store distribution and update channels are on hold until they say otherwise.

## Commands

pnpm isn't installed globally, so use `npx pnpm@10.34.9`.

```bash
npx pnpm@10.34.9 dev
npx pnpm@10.34.9 typecheck
npx pnpm@10.34.9 test
npx pnpm@10.34.9 build
npx playwright test --timeout 20000
```

Build first, because E2E tests run the built app. To build and test the packaged app:

```bash
cd apps/desktop && npx electron-builder --linux AppImage deb
```

```bash
SCB_E2E_EXECUTABLE="$PWD/apps/desktop/release/0.1.0/linux-unpacked/scdelta" npx playwright test --timeout 20000
```

The beta lands in `apps/desktop/release/0.1.0/`, which git ignores. CI (`.github/workflows/ci.yml`) runs on Linux and Windows, plus a Deno job for `server/`, and uploads installers as artifacts.

Deno isn't installed. To run server tests locally, use the npm package `deno`, then `deno test --allow-env` inside `server/`.

## Layout

| Path | Contents |
|---|---|
| `apps/desktop/src/main` | Main process: `window.ts` wires everything, `tabs/TabManager.ts`, `ipc.ts`, `internalIpc.ts`, `overlay.ts`, `ai/`, `privacy/`, `storage/`, `import/`, `extensions.ts`, `sync.ts`, `reporter.ts`, `profiles.ts`, `flags.ts` |
| `apps/desktop/src/preload` | Bridges: `index.ts` (browser UI), `overlay.ts`, `internal.ts` (sc:// pages only) |
| `apps/desktop/src/renderer/src` | Browser UI in `components/`, overlay UI in `overlay/`, sc:// pages in `internal/`, reply and report rendering in `shared/` |
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
- API keys stay in the main process, encrypted with `safeStorage`. Never send them to a renderer.
- Parsing PDFs happens in a separate utility process, never in the main process.
- The new tab picture reaches `sc://newtab` only through the internal bridge, so it has no address a website could load. It stays in the profile folder and isn't synced.
- The sync folder only ever holds ciphertext. The passphrase isn't stored, and the derived key is kept with `safeStorage`.
- Crash reports and usage stats are opt-in, and hold no addresses, titles or error messages. `scrubStack` removes folders and messages.
- Agent mode needs approval for every click, entry and navigation. Private fields are refused in `ai/agent.ts`, not left to the model.
- Nothing goes to an AI provider unless the person acts. Respect the per-site AI off list.
- Claude calls use the official SDK (v1.3, which sends keys as `Authorization: Bearer`). Other providers use the OpenAI-compatible adapter.

## Hosted AI server

Deployed on Deno Deploy with `server/main.ts` as the entrypoint from the repo root. Deno Deploy has no app directory setting. The browser's address is `HOSTED_AI_URL` in `packages/shared/src/ai.ts`, including `/v1`.

Routes come from `API_KEY_n`, `MODEL_n`, `REASONING_n`, `BASE_URL_n`, `WEIGHTING_n` and `FORMAT_n`. Two or more routes means random weighted routing, with failover before any text is sent. `BASE_URL_n` includes `/v1` for OpenAI format and leaves it out for Anthropic format. Limits and details are in [server/README.md](server/README.md). The live server returned a real reply when last tested.

## Status

Phases 0 to 5 are built, apart from signing, stores and update channels, which are on hold. See the Status section of Plan.md.

Open items:
- A real AI provider hasn't been used through the browser UI. Everything in the app was tested against mocks, so reports, agent mode, translation and the scAI identity need real-model checks.
- `sc://assistant` has no saved-chat list. Chats open from the side panel.
- Reports can't be saved as HTML files yet.
- Extensions are a supported subset of Chrome's APIs. Bitwarden's install, background worker and popup were tested live; its sign-in and autofill weren't. Firefox extensions can't run.
- Sync goes through a folder, not a server, and was tested between two simulated devices, not two computers.
- The server's `/v1/reports` route needs deploying before reports go anywhere. Native crash dumps aren't collected.
- With the sandbox on, a page that segfaults didn't reach the crashed-page screen under Playwright, though one that's killed did. Check this by hand in a real build.
- Phase 3 remaining: dragging to rearrange the toolbar.
- Phase 0 remaining: Storybook, token lint rule, Style Dictionary.
- Saved permissions are shared across containers.
- Linux users may need to re-enter API keys after the rename from scBrowser.
- The hosted server has IP limits but no sign-in, so it can be used as a free API from outside the browser.

## Test pitfalls

- Playwright's simulated keys don't reach `before-input-event`. Use `shortcut()` from `e2e/app.ts` for browser shortcuts.
- Playwright clicks don't move native focus between views. `toBeFocused` also only checks DOM focus, so check `getFocusedWebContents()` when real keyboard focus matters.
- `app.firstWindow()` may be the overlay, so use the harness's `chrome` page.
- Playwright forces light mode unless launched with `colorScheme: null`.
- Screenshots of the browser UI don't include native page views, so the page area appears blank.
- Tests set `SCDELTA_AI_URL=off` and use `SCB_FILTERS` to avoid the network. `SCB_E2E` exposes `scbTabs`, `scbActions` and `scbExtensions` on the main process.
- Playwright turns the sandbox off, and service worker extensions then lose the extra `chrome.*` APIs. Launch with `SCB_E2E_SANDBOX: '1'` for those tests.
- Don't take desktop screenshots with spectacle: it can capture the owner's own windows.
- `pkill -f` patterns can match your own shell. Use `pgrep -f "dist/electro[n]" | xargs -r kill -9`.
- Code running during shutdown must guard against the destroyed window and closed database.
- An unexplained session-restore test failure and a history shortcut failure each happened once, in full runs. Neither recurred after repeats, so watch for them.
