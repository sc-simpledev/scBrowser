/**
 * Hex equivalents of `--sc-bg` / `--sc-text` for native surfaces that can't read CSS
 * (the window-controls overlay, the window background before first paint).
 * Keep in sync with tokens.css.
 */
export const NATIVE_THEME = {
  light: { background: '#f1f0ed', foreground: '#1e1a16' },
  dark: { background: '#141210', foreground: '#edebe7' }
} as const
