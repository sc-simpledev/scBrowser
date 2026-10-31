# scBrowser — Product & Technical Plan

## Context
Greenfield project (empty folder at `~/Alex's Folder/scSpace/scBrowser`). Goal: a modern, commercial-quality desktop browser for **Linux and Windows** with deep **AI integration**, inspired by **Firefox** (privacy, customisation, reader view, containers) and **Dia** (AI sidebar that understands your tabs, AI-first omnibox, writing help). Built by a small team. Decisions made:
- **Engine:** Electron (Chromium) + TypeScript.
- **AI:** Bring-your-own API key, plus user-defined **custom providers** (any OpenAI- or Anthropic-compatible endpoint, local Ollama, etc.).
- **Business model:** decide later — architecture keeps room for a hosted "Pro" tier, sync, or a paid licence without rewrites.

## Status

**Phase 0 — mostly done.** Monorepo, tokens, base components, typed IPC, CI, Playwright E2E. Still to do: Storybook with visual regression, token lint rule, Style Dictionary.

**Phase 1 — done.** Everything below is covered by E2E tests unless marked.
- [x] Tabs across the top or down the side (collapsible), drag to reorder, tab menu
- [x] Omnibox with bookmark, history, open-tab and search-engine suggestions
- [x] Overlay layer for popups and tooltips
- [x] History, bookmarks and bookmarks bar, downloads manager
- [x] Session restore (tabs load when opened, back/forward kept), window size restored
- [x] Find in page, zoom
- [x] Permission prompts with remembered per-site decisions
- [x] `sc://settings`, `sc://history`, `sc://bookmarks`, `sc://downloads`, search engine choice
- [x] Error pages, crashed-page recovery, background tab sleeping

Built but needs a manual check, as automated tests can't drive them: print dialog, camera and microphone prompts, fullscreen video, Ctrl+scroll zoom, save-as dialogs, set as default browser (packaged builds only; Windows opens system settings).

Known limits to pick up later: geolocation needs a Google API key in Electron; bookmarks have no folders yet; zoom isn't kept across restarts; HTTP auth dialogs aren't handled; one window only (no Ctrl+N or private windows); tab drag has no spring animation yet.

**Phase 2 — nearly done.**
- [x] Provider layer: Anthropic (official SDK), OpenAI, Gemini, OpenRouter, Ollama, LM Studio, custom endpoints with extra headers
- [x] Keys encrypted with the OS keychain, never sent to any page or UI
- [x] `sc://ai` settings: add providers, test connection, choose the chat model, token usage
- [x] Assistant panel chatting with the current page, one-click summarise, ask about selection, per-site AI off
- [x] Omnibox "Ask" row (opens the panel; the answer isn't inline yet)
- [x] YouTube transcript chat, by opening YouTube's own transcript panel (it has no public API, so a YouTube redesign can break this; it falls back to page text)
- [x] PDF chat, parsed in a separate process (scans have no text and need OCR, which isn't built)
- [x] Estimated cost for Anthropic's own API, tokens only for other providers
- [x] Saved conversations, stored on this device with an off switch; page text isn't kept
- [ ] Inline answers in the omnibox dropdown

**Phase 3 — in progress.**
- [x] Tracking protection (off, standard, strict) at the network level, with per-site exceptions and a blocked count
- [x] HTTPS-only mode with a fallback prompt
- [x] Reader view
- [x] Picture-in-picture (from the right-click menu; needs a manual check)
- [x] Command palette (Ctrl K) and accent colours
- [ ] Cosmetic filtering (hiding ad placeholders; only network requests are blocked so far)
- [ ] Profiles and containers
- [x] Split view (from the tab menu or Ctrl K, 50/50 and not restored after a restart yet)
- [x] Vertical tabs as the default, with close on the favicon
- [ ] Customisable toolbar
- [ ] `sc://flags`, screenshot tool, import from Chrome/Firefox

## Design direction — modern, deliberate, not "vibe coded"
The look should feel like a crafted product (think Dia, Arc, Linear, Raycast, Firefox's Proton), not a generated template. That comes from a real design system and restraint, not from effects.

**Principles**
1. **Content first.** The browser chrome stays quiet. Max ~40px top bar, or vertical tabs with a collapsible rail. The web page is the hero.
2. **One accent colour, used sparingly.** Neutral greys tuned slightly warm or cool, one brand accent for focus, active tab and the primary AI action. No rainbow gradients.
3. **A tight scale for everything.** 4px spacing grid; type scale 11/12/13/15/20/28; radius scale 4/6/10 (pick one radius per component type and stick to it); 3 elevation levels at most.
4. **Typography does the hierarchy.** Interface font: Inter Display / Geist (bundled, not system fallback), tabular numbers; mono: Geist Mono / JetBrains Mono for URLs and code. Hierarchy comes from weight and opacity, not boxes.
5. **Motion with purpose.** 120–200ms, custom easing curves (e.g. `cubic-bezier(.2,.8,.2,1)`), spring physics only for tab drag, sidebar open and split view. Honour `prefers-reduced-motion`.
6. **Native-feeling details.** Proper window controls on Windows (Snap Layouts on maximise hover, Mica/Acrylic backdrop on Windows 11) and on Linux (respect GTK theme light/dark, KDE/GNOME button order). Crisp at 100/125/150/200% scaling.
7. **AI is part of the design, not stuck on top.** No sparkle emoji everywhere. AI gets one recognisable motif (e.g. a subtle animated accent edge while generating), streaming text that reflows calmly, and clear source citations linking back to tabs.

**Anti-patterns to avoid (the "vibe coded" tells)**
- Purple-to-blue gradients, glassmorphism on every surface, glowing drop shadows.
- Untouched default shadcn/Tailwind look: identical `rounded-2xl` cards, `shadow-lg`, grey-500 text everywhere.
- Emoji as icons; mixed icon sets. → Use **one** icon set (Lucide or Phosphor at 1.5px stroke, 16/20px grid) plus custom-drawn brand icons.
- Placeholder copy, inconsistent capitalisation, "✨ AI-powered" labels. → Write the copy on purpose (sentence case, short verbs).
- Spinners for everything. → Skeletons and optimistic UI; the omnibox and tab switching must feel instant (<16ms input response, <100ms tab switch).
- Hard-coded colours and pixel values in components.

**How we keep it consistent**
- **Design tokens** in `packages/ui/tokens` (colour, type, spacing, radius, motion, elevation) built with Style Dictionary into CSS variables. Components may only use tokens; a lint rule (stylelint + custom ESLint rule) rejects raw hex/px values.
- Light, dark and high-contrast themes from day one; user accent and theme presets layer on top of the tokens.
- **Design before code** for each major surface (tab strip, omnibox, AI sidebar, new tab page, settings): Figma mockups covering states (hover, focus, active, loading, empty, error) before implementing.
- **Storybook** for `packages/ui` with visual regression (Playwright screenshots) so polish doesn't silently regress.
- Accessibility: visible focus rings, full keyboard navigation, WCAG AA contrast, screen-reader labels — part of "done" for every component.
- A short design review per milestone; signature moments get extra attention: the new tab page, opening the AI sidebar, tab drag-and-drop, split view, and the first-run onboarding.

## Tech stack
| Area | Choice |
|---|---|
| Runtime | Electron (latest stable), `BaseWindow` + `WebContentsView` per tab (not deprecated `BrowserView`) |
| Language / build | TypeScript, `electron-vite`, pnpm workspaces (via `corepack`; Node 22 is installed) |
| Browser UI ("chrome") | React + Zustand; Tailwind configured **only** from our design tokens (no default palette); Radix primitives (unstyled) skinned by `packages/ui`; Motion (Framer) for springs |
| Design system | Style Dictionary tokens, Storybook, Lucide/Phosphor icons, bundled Geist/Inter fonts |
| Storage | SQLite via Electron's built-in `node:sqlite` (no native rebuilds) for history/bookmarks/sessions; embeddings store to be chosen in Phase 4 |
| Secrets | Electron `safeStorage` (libsecret on Linux, DPAPI on Windows) for API keys |
| Ad/tracker blocking | `@ghostery/adblocker-electron` with EasyList/EasyPrivacy |
| Extensions | `electron-chrome-extensions` (partial MV3 — scoped to popular extensions, e.g. password managers) |
| Reader / page extraction | `@mozilla/readability` in an isolated preload |
| Packaging / updates | `electron-builder` → AppImage, .deb (later .rpm, Flatpak); NSIS + MSIX on Windows; `electron-updater` |
| Tests / CI | Vitest (units), Playwright `_electron` (E2E), GitHub Actions matrix (ubuntu + windows) |

## Repository layout
```
scBrowser/
  apps/desktop/
    src/main/          # main process: windows, TabManager, sessions/profiles, storage, IPC, protocol
      tabs/  storage/  ai/  privacy/  downloads/  permissions/  updater/
    src/preload/       # chrome-ui.ts (UI bridge), content.ts (page extraction; no Node exposure)
    src/renderer/      # React UI: toolbar/omnibox, tab strip/vertical tabs, AI sidebar, command palette
    src/internal/      # sc:// pages: newtab, settings, history, bookmarks, downloads, flags
  packages/ai/         # provider abstraction, streaming, tool calls — pure TS, unit-testable
  packages/shared/     # IPC contracts (typed), types, constants
  packages/ui/         # shared design system components + theme tokens
```

## Architecture
- **Main process** owns all state: `TabManager` (create/close/move/pin/group, per-tab `WebContentsView`), `ProfileManager` (Electron `session` partitions → profiles & Firefox-style containers), `Storage` (SQLite repos), `AIService`, `PrivacyService`, `PermissionService`, `DownloadManager`.
- **Chrome UI renderer** is one React app layered over tab views; talks to main only via a **typed IPC contract** in `packages/shared` (no raw `ipcRenderer` in components).
- **Web content** runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; the content preload exposes nothing to pages — main pulls page text through it on demand.
- **Internal pages** served via a privileged custom `sc://` protocol.
- **Security rules:** API keys never reach a renderer; page content is only sent to an AI provider on explicit user action (or opt-in features), with a per-site "AI off" switch; validate every IPC message.

## AI layer (`packages/ai` + `src/main/ai`)
- `Provider` interface: `listModels()`, `chat(messages, {tools, stream})`, optional `embed()`, `testConnection()`.
- Built-in adapters: **Anthropic** (default suggestion), **OpenAI**, **Google Gemini**, **OpenRouter**, **Ollama / LM Studio** (local).
- **Custom provider:** name, protocol (OpenAI-compatible / Anthropic-compatible), base URL, API key, extra headers, model list (auto-fetched or manual). "Test connection" button.
- **Model roles** the user maps to any configured model: *Chat*, *Fast* (titles, tab grouping, omnibox), *Embeddings* (semantic history; can be local).
- Context builder: assembles current page / @-mentioned tabs / selection / PDF text with token budgeting and truncation.
- Usage meter per provider (tokens, estimated cost) so BYO-key users see spend. Hooks for a future hosted "scBrowser Pro" provider.

## Feature roadmap

### Phase 0 — Foundation
Monorepo, lint/format, typed IPC, CI on Linux + Windows building unsigned installers, Playwright E2E smoke test. **Design tokens, fonts, icon set, base components (button, input, menu, tooltip, tab) and Storybook set up before any feature UI.**

### Phase 1 — Core browser (usable daily driver)
Window + tabs (horizontal & **vertical**), omnibox with search suggestions and history autocomplete, back/forward/reload, find in page, zoom, print, DevTools, history, bookmarks (+ bar), downloads manager, session restore, permissions prompts, `sc://newtab`, `sc://settings`, default search engine choice, keyboard shortcuts, set-as-default-browser, crash recovery.

### Phase 2 — AI core (Dia-inspired)
Provider settings + BYO key / custom provider UI · **AI sidebar** chatting with the current page · one-click summarise · "Ask about selection" context menu · **AI omnibox mode** (question → inline answer, URL → navigate) · YouTube transcript & PDF chat.

### Phase 3 — Privacy & polish (Firefox-inspired)
Tracking protection levels (standard/strict), ad blocking, HTTPS-only mode, **profiles & containers**, **reader view**, picture-in-picture, **split view**, command palette (Ctrl+K), themes/accent colours, customisable toolbar, `sc://flags`, screenshot tool, import from Chrome/Firefox.

### Phase 4 — Advanced AI
Multi-tab context (@-mention tabs) · smart tab grouping & auto-naming · **writing assistant** in text fields (rewrite, proofread, tone) · **semantic history search** ("that article about GPUs last week") with local embeddings · user-defined **Skills** (saved prompts with shortcuts) · page translation · **Agent mode** (AI clicks/fills forms in a tab with step-by-step confirmation, read-only by default).

### Phase 5 — Ecosystem & shipping
Chrome extensions support · encrypted sync (bookmarks/history/settings; E2E so it can later be a paid service) · password manager integration (extensions first; native vault later) · auto-update channels (stable/beta/nightly) · code signing (Windows EV cert) · distribution: Flathub, .deb/.rpm repos, winget, Microsoft Store · telemetry (opt-in only) and crash reporting.

## Known risks (and mitigations)
- **Google sign-in sometimes blocks Electron** ("browser may not be secure") → clean Chrome-like user agent, remove `Electron/` token, test early in Phase 1.
- **DRM (Netflix, Spotify)** needs Widevine → use castLabs "Electron for Content Security" build; requires VMP signing for Windows.
- **Extensions are partial in Electron** → set expectations; target a supported list.
- **Security patch cadence** → track Electron stable closely; CI job alerts on new Chromium security releases.
- **Memory use** → tab discarding/sleeping for background tabs (Phase 1/3).

## First implementation step (after approval)
Phase 0 + the start of Phase 1: scaffold the monorepo with `electron-vite`, a window with a React toolbar/omnibox, `TabManager` with `WebContentsView` tabs (new/close/switch/navigate), typed IPC, and CI. Then proceed phase by phase.

## Verification
- `pnpm dev` launches scBrowser; open tabs, navigate, close, reopen — session restores.
- `pnpm test` (Vitest) covers `packages/ai` adapters (mocked HTTP), storage repos, IPC validation.
- `pnpm e2e` (Playwright `_electron`) drives: open tab → load page → omnibox search → bookmark → restart → verify state; AI sidebar against a mock OpenAI-compatible server.
- CI produces AppImage/.deb and Windows installer artifacts on every PR; manual smoke test on both OSes per milestone.
- Design quality: Storybook visual-regression snapshots pass; token lint finds no raw colours/px; manual check of light/dark/high-contrast at 100% and 150% scaling on GNOME, KDE and Windows 11.
