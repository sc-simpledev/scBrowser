import { isGettingStartedId, type GettingStartedId, type OnboardingState } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const SHOW_KEY = 'onboarding:show'
const DONE_KEY = 'onboarding:done'

/** Which of the Get started list someone has tried, and whether the list shows at all. */
export class Onboarding {
  constructor(private readonly kv: KeyValueRepo) {}

  state(): OnboardingState {
    const done = this.kv.get(DONE_KEY)
    return { show: this.kv.get(SHOW_KEY) === true, done: Array.isArray(done) ? done.filter(isGettingStartedId) : [] }
  }

  /** For a new profile, once the intro is over. People already using scTerra never see it. */
  begin(): void {
    if (this.kv.get(SHOW_KEY) === undefined) this.kv.set(SHOW_KEY, true)
  }

  setShown(show: boolean): void {
    this.kv.set(SHOW_KEY, show)
  }

  /** Ticks one off. Cheap to call often, as it only writes when something changes. */
  mark(id: GettingStartedId): void {
    const { done } = this.state()
    if (done.includes(id)) return
    this.kv.set(DONE_KEY, [...done, id])
  }
}
