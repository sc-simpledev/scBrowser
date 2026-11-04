# scTerra: context for a new session

scTerra (formerly scDelta, and before that scBrowser) is an Electron browser for Linux, Windows and macOS with AI built in, inspired by Firefox and Dia. Its catchphrase is "Browse the World". Read [Plan.md](Plan.md) for the roadmap and status checklist, and [README.md](README.md) for layout and shortcuts. The repo is private: `sc-simpledev/scBrowser`, branch `main`.

## Where things stand right now

Written on 2026-11-05. Version 0.3.3 was committed and tagged after the owner tested the AppImage and said it works, including the Chrome Web Store and signing in. Check `gh release list --repo sc-simpledev/scTerra` to confirm it published.

What 0.3.3 changed:

- **Google sign-in uses Electron's own identity** (see "Google sign-in" below).
- **Pages that pass through sign-in open.** Calling `setUserAgent` during a navigation made Chromium reload the page and drop the navigation, which broke the Chrome Web Store for signed-in people. The identity is now set per request in `googleSignIn.ts`, and `preload/internal.ts` gives scripts on those pages the matching value before they run.
- **Popups keep their link to the page that opened them.** `TabManager.adoptPopup` shows the real window as a tab, closes it on `window.close()`, and returns to the opener. Tabs in a popup pair don't sleep.
- **Screenshots** retry when Chromium's capture rejects with `UnknownVizError`, save before touching the clipboard, and say so if they fail.
- **Tracker blocking** holds requests for up to 5 seconds while the filter engine loads, and the blocked count resets when navigation starts.
- **End-to-end tests:** 123 down to 101, removing those that overlap most with others. Only the vless and ss kinds still make real Xray connections. They run in parallel: 3 workers locally, 2 on Linux CI, 1 on Windows CI, where two at once timed out starting apps. `e2e/app.ts` passes `--no-proxy-server`, as the owner's VPN had been catching test traffic.

Still to ask the owner: has a copy on an older version updated itself? No update between published versions has been confirmed.

Known flakes: `privacy.spec.ts:21` fails about 1 run in 75 under parallel load, showing 1 blocked instead of 2. `assistant.spec.ts:142` failed once in a full run. The cause of each isn't known. CI retries cover them.

## How to work with the owner

- Never commit, push or tag on your own. The owner tests the AppImage first, then tells you to commit and rebuild, even if an earlier message in the chat asked for a release. An instruction to commit only covers that round. Work directly on `main`. A coworker also commits there, so pull first. `theme.html` in the root is the owner's scSpace style reference: don't commit it.
- Commits need `git -c user.name=... -c user.email=...` using the last commit's author, as no git identity is set on this machine.
- Don't spend their AI credit without asking. Live requests to the hosted server use real keys.
- They want it modern but not "vibe coded": follow the design rules in Plan.md and use tokens, not raw colours or sizes. They've pulled back glass, pills and big shadows once already: flat surfaces with thin borders, 4/6/10 radii, glass only on popups and new tab cards.
- Report honestly what was and wasn't tested. Say so when something only ran against mocks.
- Rebuild the Linux beta after a round of changes, and tell them where it is. Run `build` before `electron-builder`, which packages whatever is already in `out/`.
- Signing, store distribution and extra update channels are on hold until they say otherwise.
- Their desktop is Kubuntu (KDE Plasma) with a Windows-style theme, so screenshots can look like Windows. They test the packaged Linux build. Nobody has tried a Windows or Mac build yet.
- They care a lot about polish. Check new UI on screen, as Playwright screenshots, before saying it's done. When they say a control was moved, they mean its place in the toolbar: Assistant, Profiles and More sit to the right of the address bar.
- They usually send a list of changes with screenshots. Work through all of it, then say plainly what couldn't be checked.

## Commands

pnpm isn't installed globally, so use `npx pnpm@10.34.9`.

```bash
npx pnpm@10.34.9 dev
npx pnpm@10.34.9 typecheck
npx pnpm@10.34.9 test
npx pnpm@10.34.9 build
npx playwright test --timeout 20000
```

Build first, because E2E tests run the built app. The suite has 101 tests and takes under 2 minutes locally, and there are 201 unit tests. To build and test the packaged app, fetch the Xray VPN core once first. Packaging stops if it's missing:

```bash
node apps/desktop/scripts/fetch-xray.mjs
```

```bash
cd apps/desktop && npx electron-builder --linux AppImage deb
```

```bash
SCB_E2E_EXECUTABLE="$PWD/apps/desktop/release/0.3.3/linux-unpacked/scterra" npx playwright test --timeout 20000
```

The beta lands in `apps/desktop/release/<version>/`, which git ignores. CI (`.github/workflows/ci.yml`) runs on Linux and Windows, plus a Deno job for `server/`, and uploads installers as artifacts. `macos.yml` is run by hand from the Actions tab, as a private repo's macOS minutes count ten times over. `release.yml` runs on a `v*` tag. See [docs/auto-update.md](docs/auto-update.md).

Deno isn't installed. To run server tests locally, use the npm package `deno`, then `deno test --allow-env` inside `server/`.

## Layout

| Path | Contents |
|---|---|
| `apps/desktop/src/main` | Main process: `window.ts` wires everything, `systemProxy.ts`, `tun.ts`, `passwords.ts` (vault), `passwordFill.ts` (fill and save-offer scripts), `reportExport.ts`, `reportDocx.ts`, `updater.ts`, `httpAuth.ts`, `private.ts`, `siteIcons.ts`, `internal/pdf.ts`, `tabs/TabManager.ts`, `ipc.ts`, `internalIpc.ts`, `overlay.ts`, `ai/`, `privacy/`, `storage/`, `import/`, `extensions.ts`, `blocker.ts`, `vpn.ts`, `sync.ts`, `reporter.ts`, `profiles.ts`, `flags.ts` |
| `apps/desktop/src/preload` | Bridges: `index.ts` (browser UI), `overlay.ts`, `internal.ts` (sc:// pages only) |
| `apps/desktop/src/renderer/src` | Browser UI in `components/`, overlay UI in `overlay/`, sc:// pages in `internal/` (the intro is `internal/welcome/`), shared between both in `shared/`: `ReplyContent.tsx`, `ReportPane.tsx` (the side page), `ResizeHandle.tsx` |
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
- API keys stay in the main process, encrypted with `safeStorage`. Never send them to a renderer. Use only its async calls (`encryptStringAsync`, `decryptStringAsync`, `isAsyncEncryptionAvailable`): with KDE Wallet the old synchronous ones report no encryption at all, which stopped VPN links saving. Dev builds use `basic_text`, so only packaged builds show this.
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
- The password vault is sealed with a key derived from the master password, which is never stored; the key and logins only exist in memory while unlocked. Passwords reach a renderer only through `passwords:reveal` on the `sc://passwords` bridge, never the browser UI or overlay. Filling is only ever by request, top frame only, with the exact origin rechecked at that moment. Save offers watch pages only while unlocked, count only real clicks and keys, and hold the login in the main process for a minute at most. It never syncs and isn't in private windows.
- A native page view swallows mouse events over itself, so `layout:resizing` hides it while a sidebar is dragged.
- Google sign-in pages (`accounts.google.com`, `accounts.youtube.com`) see Electron's own user agent, without the app's name, in the header and to scripts, along with whatever they load. Every other site sees the clean Chrome one. Never call `setUserAgent` on a tab during a navigation, as Chromium reloads the page and drops the navigation: `googleSignIn.ts` sets the header per request, and `preload/internal.ts` sets what scripts read. Electron keeps only one listener per `webRequest` event per session, so anything else needing `onBeforeSendHeaders` has to share this one.
- Links and `window.open` from websites become tabs. Unless they ask for `noopener` or open in the background, the tab holds the real popup, and `window.opener` works. `window.close()` shows up as the `close` event on its `WebContents`, not `destroyed`. `sc://` stays unreachable from them.
- Tooltips on `sc://` pages are Radix, in the document. They must keep `pointer-events: none`, or they take the clicks of whatever's under them. The browser UI's tooltips are in the overlay and clear when the pointer moves.
- Word files are rebuilt in the main process from the report's blocks through `toReport`, so only plain text reaches them. There's no docx dependency: `reportDocx.ts` writes the zip itself.
- Saved reports are built by `reportHtml`, which escapes all text and carries a CSP blocking scripts and network requests. PDFs print that same file in a hidden window with scripts off.
- The VPN defaults to just the browser. Whole-computer modes must always undo themselves: the system proxy's old values are saved before changing it and a watcher process restores them after a crash; the TUN script runs as root and removes its routes when its stdin closes. Never start either without the person choosing it. These settings stay out of sync (`LOCAL_SETTINGS`). Connect-at-start holds pages on a dead proxy port (`holdPages`) before any tab loads, and failing stays closed on purpose: the person asked to always be covered.
- Claude calls use the official SDK (v1.3, which sends keys as `Authorization: Bearer`). Other providers use the OpenAI-compatible adapter.

## Releasing and updates

Installers and update files go to the public `sc-simpledev/scTerra` repo (renamed from scDelta on 2026-11-03). The source never goes there. Details are in [docs/auto-update.md](docs/auto-update.md).

1. Set `version` in `apps/desktop/package.json`, commit and push.
2. Wait for CI to pass on `main`, as a release doesn't wait for it. Then tag to match and push the tag, with the `git -c user.name=... -c user.email=...` identity: `git tag -a v0.3.4 -m "scTerra 0.3.4"`, then `git push origin v0.3.4`. Only a tag publishes. Pushes to `main` just run CI.
3. `.github/workflows/release.yml` checks the tag against the version, builds Linux, Windows and both kinds of Mac into a draft release using the `RELEASE_TOKEN` secret (already set), and publishes the draft only once every build succeeds.
4. Watch it with `gh run list --workflow release.yml`, and check the release appeared with `gh release list --repo sc-simpledev/scTerra`.

The app checks for updates 30 seconds after starting and every 4 hours (`apps/desktop/src/main/updater.ts`). AppImage replaces itself; Windows installs on restart; .deb asks for a password when Restart to update is pressed; unsigned Macs only point at the release page. Settings has a switch and Check now.

## Hosted AI server

Deployed on Deno Deploy with `server/main.ts` as the entrypoint from the repo root. Deno Deploy has no app directory setting. The browser's address is `HOSTED_AI_URL` in `packages/shared/src/ai.ts`, including `/v1`.

Routes come from `API_KEY_n`, `MODEL_n`, `REASONING_n`, `BASE_URL_n`, `WEIGHTING_n` and `FORMAT_n`. Two or more routes means random weighted routing, with failover before any text is sent. `BASE_URL_n` includes `/v1` for OpenAI format and leaves it out for Anthropic format. Limits and details are in [server/README.md](server/README.md). The live server returned a real reply when last tested.

## Google sign-in

Published 0.3.2 told Google's pages it was Firefox, and the owner still got "This browser or app may not be secure". With Electron's own identity (0.3.3), the owner confirmed signing in works.

Why that failed, from two other Electron browsers that measured this against the live site in October 2026 ([Mise PR 19](https://github.com/Rakosn1cek/Mise-browser/pull/19), [Orca PR 36519](https://github.com/stablyai/orca/pull/36519)):

- A clean Chrome identity is rejected: Google then runs its full Chrome checks, which Electron fails. That's also why the original setup failed.
- A Firefox identity is rejected often, as the page can see it's really Chromium. A faked Google Chrome with full client hints was also rejected.
- Electron's own identity passed every time in both: Orca 4 of 4, and 4 of 4 on the redirect from "Sign in with Google", Mise through to a full sign-in in a packaged Linux AppImage on X11.
- It also fits [Google's guidance](https://developers.googleblog.com/guidance-to-developers-affected-by-our-effort-to-block-less-secure-browsers-and-applications/), which says a browser must identify itself and not use another browser's user agent.

To check it: open `accounts.google.com`, enter an email, press Next. Getting to the password step, or "Couldn't find this account", passes. `/v3/signin/rejected` fails. The check runs at the email step. Neither project reported on passkeys or two-step verification.

If Google starts refusing again, in the order to try them:

1. **Check for a second cause first:** Mise's first bug was another `webRequest` listener silently replacing theirs. Compare with Orca's and Mise's hosts and flow, and whether scTerra's privacy rules touch the page. Mise also rewrites `GlifWebSignIn` to `WebLiteSignIn`, which it calls mostly redundant.
2. **Use Electron's identity everywhere:** this passed for Orca, but it revoked sessions on other sites such as x.com and LinkedIn, so it's a last resort.
3. **Sign in through a real browser:** Google's supported route for embedded apps is OAuth in the system browser. That only gives an app access to Google's APIs. It doesn't sign the tabs in to Gmail or YouTube, so it wouldn't solve this alone.
4. **Importing cookies from Chrome** is fragile and touches other people's saved sessions. Avoid it unless the owner decides otherwise.
5. **Say it isn't supported,** and offer the sites that work.

Passing Google's check may stop working at any time, as it's Google's to change.

## Flags

`BROWSER_FLAGS` in `packages/shared/src/containers.ts` lists them, kept in `flags.json`. The ones marked `fun` become `data-flag-<id>` on each page's root (`renderer/src/shared/funFlags.ts` and `.css`), so most are only CSS. They take effect after a restart and must never take clicks.

## Status

Version 0.3.3. Phases 0 to 5 are built, apart from signing, stores and extra update channels, which are on hold. Since then: site blocker, VPN with a bundled Xray core, whole-computer VPN (system proxy or TUN), VPN connect at start, fastest pick and skip list, bookmark folders and icons, a built-in password vault, private windows, the PDF viewer, the scSpace look, auto-updates, the first-run intro (night and daytime scenes, "Browse the World"), workspaces, tab clean-up, inline address bar answers, HTTP sign-in, OCR for scanned PDFs, saved zoom, split view restore, a report side page with versions, change requests, designs and PDF, HTML, Markdown and Word downloads, a saved-chat list, a draggable toolbar, resizable sidebars, a profiles button, bookmark overflow, a compact toolbar for narrow windows, and macOS builds. See Plan.md for what each does.

0.2.0, 0.3.1, 0.3.2 and 0.3.3 are published at https://github.com/sc-simpledev/scTerra/releases. `release.yml` now creates one draft before building. 0.3.1 was the first release through that fix, and the first real update from one published version to another, so ask the owner whether their 0.2.0 picked it up. 0.3.1 has no Apple silicon Mac build: that runner sat queued, so the owner chose to publish without it, by cancelling the run and running `gh release edit v0.3.1 --repo sc-simpledev/scTerra --draft=false --latest`. Intel Mac, Linux and Windows are there. 0.3.2 built everything into one release, so the single-draft fix works. 0.3.0 was never published: its release run was cancelled over an error on closing the browser, and its draft is deleted. Only a `v0.3.0` tag remains, in the private repo. A release doesn't wait for CI, so let CI pass on `main` before tagging.

**Next ideas the owner hasn't taken up yet:** a live test with a real AI model (needs their OK, as it spends credit), citations linking replies to their tabs, research across several tabs into one report, a reading list with AI summaries, and sign-in for the hosted server. DRM stays their decision.

Open items:
- CI: E2E failures used to stop the installer step, which looked like a broken build. Installers now build regardless, and CI retries flaky tests twice.
- A real AI provider hasn't been used through the browser UI. Everything in the app was tested against mocks, so reports, agent mode, translation, inline answers, AI tab clean-up and the scAI identity need real-model checks.
- DRM (Netflix, Spotify) isn't in. It needs castLabs' Electron, whose newest stable build (44.9.3 in November 2026) is behind our 45.1.0, plus VMP signing for Windows and macOS. It was never run here. Don't swap the engine without the owner's say.
- Copies older than 0.2.0 can't update themselves, so they need one manual install.
- macOS has never been run. Builds are unsigned, so they can't install updates: the app offers the release page instead. Windows and .deb updates are also untested. Only an AppImage update has been done for real.
- Whole-computer VPN: the TUN script was run for real in a throwaway network namespace (traffic, DNS and clean-up all worked), and system proxy against the real KDE and GNOME tools in a scratch config. Neither has run through pkexec or against the real desktop settings, so ask the owner to try both. Windows and macOS system proxy have only run against fake commands. TUN is Linux only: Windows needs the wintun driver. Two profiles could fight over the system proxy; that isn't handled. Switching connections under TUN asks for the password again.
- The report side page takes its room from the page, so a narrow window leaves little of the page showing. The chosen design isn't saved with a chat, and is forgotten when the side page closes. Versions are matched by title, so a model that renames a report starts a new set.
- Dragging a sidebar was only tested with Playwright's mouse, which never crosses the native page view. Hiding the page during a drag is meant to make that work, so ask the owner to try it with a real mouse. The page area goes blank during the drag. Hiding the page drops pointer capture mid-drag, which is why `ResizeHandle` listens on the window.
- CI artifact storage hit its quota on 2026-11-03. Artifacts now last 5 days and a failed upload no longer fails CI, and the old ones were deleted that day. GitHub recalculates usage every 6 to 12 hours, so uploads may fail until then. Releases don't use this storage.
- The password vault's fill and save offer were tested on simple local sign-in pages only, not real sites. Pages with sign-in forms in iframes (some banks, some single sign-on) won't fill or offer, and multi-step sign-ins may save without a username. Bookmark imports don't bring folders.
- Bookmark folder order doesn't sync, only names, membership and nesting.
- The intro has night and daytime scenes, following the theme. It was checked on an Intel GPU at 1320 by 860, and falls back to a plain gradient without WebGL 2.
- Clicks landing below a button: the owner reported this on 0.3.1. The likely cause, hoverable tooltips on `sc://` pages, is fixed in 0.3.2, and a scan of the browser UI and `sc://` pages found nothing else covering a button at rest. It couldn't be tried with a real mouse, so ask whether it's gone, and where if not.
- The overlay takes clicks wherever it's drawn, and has no way to let them through. Keep popup regions tight: tooltips only cover their own bubble and clear as soon as the pointer moves. The fix for the Settings link needing a click below it couldn't be tried with a real mouse here, so ask whether it's gone.
- Window buttons are drawn over the top right of the window. `sc-wco-inset` keeps bars clear of them with margins, as a bar's own padding utilities would override padding. A test checks More stays clear.
- The taskbar icon was blank on KDE. The window now sets its own icon (`build/icon.png`), but whether KDE shows it hasn't been confirmed.
- DRM: see above. The Widevine build couldn't be run here: the permission system blocks running downloaded binaries.
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

- The owner may have whole-computer VPN on while you work. Then this machine's system proxy is set and `HTTP_PROXY` is in the environment. Check before blaming the code, and never turn it off for them. `ProxyType` in `kioslaverc` shows it, and `/opt/scTerra` means their .deb is running.
- When comparing against earlier code, run the last packaged build with `SCB_E2E_EXECUTABLE` rather than stashing.
- Tests run in parallel, each with its own app and profile, but the system clipboard is shared. CI on Windows runs one at a time.
- `accounts.google.com` is preloaded as HTTPS-only in Chromium, so a local HTTP test can't reach it. Use `SCB_SIGN_IN_HOST` with `--host-resolver-rules`, as `e2e/phase9.spec.ts` does, and turn `httpsOnly` off.
- `--repeat-each=25 --retries=0` finds flakes quickly. Trace each step before believing a cause: the screenshot flake looked like the clipboard and wasn't, and the tracker flake looked like slow filter loading but was mostly the count being reset.
- Don't rely on hover in tests: on CI's display, stray pointer moves can dismiss a tooltip before it opens. Send `pointermove` straight to the element with `dispatchEvent`. `focus()` doesn't work either, as Playwright's page view doesn't have real focus.
- CI windows have no focus, unlike a run on the owner's desktop. `BaseWindow.getAllWindows()[0].blur()` gets close to it locally, as `xvfb-run` isn't installed here.
- Local runs print uncaught main-process errors without failing, so read the output as well as the totals.
- Native menus and save dialogs can't be driven by Playwright. Replace `Menu.buildFromTemplate` or `dialog.showSaveDialog` through `h.app.evaluate`, as `e2e/phase8.spec.ts` and `phase5.spec.ts` do.
- `h.page(text)` matches any part of a page's address, including the app's own path, so a route called `/app` finds the wrong page.
- `go(h, ...)` reuses the current tab, so a page object from before it now points at the new page.
- Never test whole-computer VPN against the real system settings. Use `XDG_CONFIG_HOME` and `GSETTINGS_BACKEND=keyfile` for system proxy, and `unshare -Urnm` for the TUN script. The repo path contains an apostrophe, which breaks single-quoted shell scripts.
- A controlled radio that only updates after an IPC reply fails Playwright's `check()`, so update local state first.
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
