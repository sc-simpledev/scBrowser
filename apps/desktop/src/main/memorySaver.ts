/** How often it looks, and how hard up the computer has to be before tabs sleep. */
const CHECK_MS = 20_000
const LOW_SHARE = 0.1
const LOW_KB = 700 * 1024
/** A tab looked at in the last minute stays awake whatever happens. */
const MIN_IDLE_MS = 60_000
const PER_CHECK = 2

export interface MemoryInfo {
  total: number
  free: number
}

export const isShortOfMemory = ({ total, free }: MemoryInfo) => total > 0 && (free / total < LOW_SHARE || free < LOW_KB)

/**
 * Chrome's Memory Saver, more or less: while free memory is low, the background tabs looked at
 * longest ago sleep, a couple at a time, until there's room again. Sleeping tabs keep their place,
 * history and title, and load again when clicked, so nothing is lost.
 */
export function startMemorySaver(options: { enabled: () => boolean; memory: () => MemoryInfo; sleepOldest: (count: number, minIdleMs: number) => number }): () => void {
  const timer = setInterval(() => {
    if (!options.enabled()) return
    let info: MemoryInfo
    try {
      info = options.memory()
    } catch {
      return
    }
    if (isShortOfMemory(info)) options.sleepOldest(PER_CHECK, MIN_IDLE_MS)
  }, CHECK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
