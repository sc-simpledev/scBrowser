# Auto-updates through the public repo

A proposal, not yet built. The aim is automatic updates for the .deb, AppImage and Windows
builds while the source stays in the private `scBrowser` repo.

## Recommended setup

Keep two repos with separate jobs:

| Repo | Visibility | Holds |
|---|---|---|
| `scBrowser` | Private | All source code and CI |
| `sc-simpledev/scDelta` | Public | GitHub Releases containing only installers and update files, plus a short README |

1. On a version tag such as `v0.2.0`, a workflow in `scBrowser` builds on Linux and Windows.
2. electron-builder publishes to the public repo, using `publish: { provider: github, owner: sc-simpledev, repo: sc-simpledev/scDelta }`.
3. The app uses `electron-updater`. It reads `latest.yml` and `latest-linux.yml` from the public release, so it needs no token and no source access.

GitHub's default `GITHUB_TOKEN` can't write to another repo, so this needs a fine-grained token
limited to the public repo with Contents read and write, stored as a secret in `scBrowser`. It must
never be in the app: reading public releases needs no token.

## What each format does

| Format | How it updates | Notes |
|---|---|---|
| Windows NSIS | Downloads in the background, installs on restart | Best supported. Unsigned builds trigger SmartScreen warnings on first install |
| AppImage | Replaces itself in place | Needs nothing from the system. Works only while running from an AppImage |
| .deb, option A | `electron-updater` downloads the new .deb and installs it with `pkexec` | Simple, but shows a password prompt on each update |
| .deb, option B | A signed apt repo on GitHub Pages in the public repo, updated by CI | Updates arrive with normal system updates, with no prompt from sc-simpledev/scDelta. More setup, and it needs a GPG key kept in CI secrets |

Start with option A, and move to B if the password prompt annoys people.

## Decisions needed

- **Public repo name.** It's `sc-simpledev/scDelta`, while the app is now scTerra. Renaming it is optional, as GitHub redirects old addresses, but do it before the first update ships.
- **Signing.** Windows updates work unsigned, but SmartScreen warnings stay until there's a certificate.
- **Update checksums.** `electron-updater` checks SHA-512 hashes from the release's own files, which guards against damaged downloads but not against someone who gets write access to the public repo. Signing, or an offline signature checked by the app, closes that gap. Keep the token narrow until then.
- **Channels.** One stable channel is enough to start. Prereleases on the public repo can become a beta channel later.
- **Bundled Xray.** Updates are the only way it gets security fixes, so bump its pinned version in releases.

## Rough work

1. Add `electron-updater`, with a check at startup and every few hours, in the main process only.
2. Add an "Update ready, restart" prompt and a version line in Settings.
3. Add the tag-triggered release workflow in `scBrowser`.
4. Test by installing one version and publishing the next, on Linux and Windows.
