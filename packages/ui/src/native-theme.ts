/**
 * Hex equivalents of `--sc-bg` / `--sc-text` for native surfaces that can't read CSS
 * (the window-controls overlay, the window background before first paint).
 * Keep in sync with tokens.css.
 */
export const NATIVE_THEME = {
  light: { background: '#f9f9f9', foreground: '#111111' },
  dark: { background: '#171717', foreground: '#f2f2f2' }
} as const
