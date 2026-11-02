export const RELEASES_URL = 'https://github.com/sc-simpledev/scTerra/releases/latest'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  /** Downloaded, and waiting for a restart. */
  | 'ready'
  /** A newer version exists, but it has to be installed by hand. */
  | 'manual'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The newer version, once one has been found. */
  version: string | null
  percent: number | null
  error: string | null
  /** False where this copy can't replace itself, such as a development build. */
  supported: boolean
}

export const IDLE_UPDATE: UpdateState = { phase: 'idle', version: null, percent: null, error: null, supported: false }
