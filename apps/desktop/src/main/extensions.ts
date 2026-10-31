import type { Session } from 'electron'
import type { ExtensionInfo } from '@scbrowser/shared'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'extensions:paths'

/** Unpacked Chrome extensions, loaded into every session so containers get them too. */
export class ExtensionManager {
  private readonly sessions = new Set<Session>()

  constructor(private readonly kv: KeyValueRepo) {}

  private paths(): string[] {
    return (this.kv.get(KEY) as string[] | undefined) ?? []
  }

  async attach(session: Session): Promise<void> {
    this.sessions.add(session)
    // One broken or deleted extension shouldn't stop the others.
    await Promise.all(this.paths().map((path) => session.extensions.loadExtension(path).catch(() => undefined)))
  }

  list(): ExtensionInfo[] {
    const [session] = this.sessions
    if (!session) return []
    return session.extensions.getAllExtensions().map(({ id, name, version }) => ({ id, name, version }))
  }

  /** Throws if the folder isn't a valid extension, leaving nothing saved. */
  async add(path: string): Promise<string> {
    let id = ''
    for (const session of this.sessions) id = (await session.extensions.loadExtension(path)).id
    this.kv.set(KEY, [...new Set([...this.paths(), path])])
    return id
  }

  remove(id: string): void {
    const [first] = this.sessions
    const path = first?.extensions.getExtension(id)?.path
    for (const session of this.sessions) session.extensions.removeExtension(id)
    this.kv.set(KEY, this.paths().filter((p) => p !== path))
  }
}
