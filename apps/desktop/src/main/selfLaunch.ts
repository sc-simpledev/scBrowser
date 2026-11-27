import { existsSync } from 'node:fs'

/**
 * Starting another copy of scTerra (another profile, a private window, an installed site's
 * shortcut, a restart). castLabs' Electron, which plays Widevine, can't start with CHROME_DESKTOP
 * set, and Electron sets it in its own environment from `desktopName`, so copies started from here
 * leave it out. On Linux, packaged builds start through the `scterra` launcher (after-pack.cjs).
 */

/** The environment for another copy of scTerra: this one's, without CHROME_DESKTOP. */
export function selfEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { CHROME_DESKTOP: _desktop, ...env } = process.env
  return { ...env, ...extra }
}

/** What to run for another copy: the AppImage, the Linux launcher beside the real program, or the program itself. */
export function selfLauncher(execPath = process.execPath, appImage = process.env.APPIMAGE, exists = existsSync): string {
  if (appImage) return appImage
  if (process.platform === 'linux' && execPath.endsWith('-bin') && exists(execPath.slice(0, -'-bin'.length))) return execPath.slice(0, -'-bin'.length)
  return execPath
}

/** A restart (app.relaunch) starts the new copy as the app exits, with the environment as it is then. */
export function dropDesktopNameAtExit(on: (event: 'will-quit', listener: () => void) => void): void {
  if (process.platform === 'linux') on('will-quit', () => void delete process.env.CHROME_DESKTOP)
}
