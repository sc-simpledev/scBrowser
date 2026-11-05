export const api = () => window.scbInternal

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** Shows or hides the accent wash behind the page. */
export const applyTint = (on: boolean) => document.documentElement.toggleAttribute('data-tint', on)

/** Performance Mode's plainer drawing: see tokens.css. */
export const applyPerformance = (on: boolean) => document.documentElement.toggleAttribute('data-performance', on)
