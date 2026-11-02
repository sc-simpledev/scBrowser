# Auto-updates through the public repo

Automatic updates for the AppImage, .deb, Windows and macOS builds, while the source stays in the private `scBrowser` repo.

| Repo | Visibility | Holds |
|---|---|---|
| `scBrowser` | Private | All source code and CI |
| `sc-simpledev/scTerra` | Public | GitHub Releases containing only installers and update files, plus a short README |

The app uses `electron-updater` in `apps/desktop/src/main/updater.ts`. It checks 30 seconds after starting and every 4 hours, reading the public release, so it needs no token and no source access.

## Publishing a version

Do this once: create a fine-grained GitHub token limited to `sc-simpledev/scTerra`, with Contents read and write, and store it as the `RELEASE_TOKEN` secret in `scBrowser`. It must never be in the app.

For each release:

1. Set `version` in `apps/desktop/package.json`.
2. Commit, then tag it to match, such as `v0.2.0`, and push the tag.

`.github/workflows/release.yml` checks the tag, builds every platform into a draft release, and publishes the draft once all of them succeed. Browsers only ever see a finished release.

## What each format does

| Format | How it updates | Status |
|---|---|---|
| AppImage | Replaces itself in place | Tested for real, from 0.2.0 to a local 0.2.1 |
| Windows NSIS | Downloads in the background, installs on restart | Untested. Unsigned builds trigger SmartScreen warnings on first install |
| .deb | Downloads, then installs with `pkexec` after pressing Restart to update, so it asks for a password | Untested. A signed apt repo could remove the prompt later |
| macOS | Says a new version exists and opens the release page | Untested. Macs only install signed updates, so this stays manual until there's a Developer ID certificate |

Copies older than 0.2.0 have no updater, so those need one manual install.

## Still open

- **Update checksums.** `electron-updater` checks SHA-512 hashes from the release's own files, which guards against damaged downloads but not against someone who gets write access to the public repo. Signing closes that gap. Keep the token narrow until then.
- **Channels.** There's one stable channel. Prereleases on the public repo can become a beta channel later.
- **Bundled Xray.** Updates are the only way it gets security fixes, so bump its pinned version in releases.
