import { randomUUID } from 'node:crypto'
import { MAX_CLOSED_GROUPS, type ClosedGroup } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'tabs:closed-groups'

/** Tab groups closed from their menu, newest first. Kept on this computer and never synced. */
export class ClosedGroups {
  constructor(
    private readonly kv: KeyValueRepo,
    private readonly key = KEY
  ) {}

  list(): ClosedGroup[] {
    const saved = this.kv.get(this.key)
    return Array.isArray(saved) ? (saved as ClosedGroup[]) : []
  }

  add(name: string, tabs: ClosedGroup['tabs'], now = Date.now()): ClosedGroup | null {
    if (tabs.length === 0) return null
    const group: ClosedGroup = { id: randomUUID(), name, closedAt: now, tabs }
    // Closing a group of the same name again replaces the older copy.
    this.kv.set(this.key, [group, ...this.list().filter((other) => other.name !== name)].slice(0, MAX_CLOSED_GROUPS))
    return group
  }

  /** Takes it out of the list, to open it again. */
  take(id: string): ClosedGroup | null {
    const all = this.list()
    const found = all.find((group) => group.id === id) ?? null
    if (found) this.kv.set(this.key, all.filter((group) => group !== found))
    return found
  }

  clear(): void {
    this.kv.set(this.key, [])
  }
}
