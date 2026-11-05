import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AppLinkPermission, PermissionDecision, SitePermission } from '@scbrowser/shared'

interface Row {
  origin: string
  permission: SitePermission | AppLinkPermission
  allowed: number
}

export class PermissionsRepo {
  private readonly getQuery: StatementSync
  private readonly setQuery: StatementSync
  private readonly listQuery: StatementSync
  private readonly revokeQuery: StatementSync

  constructor(db: DatabaseSync) {
    this.getQuery = db.prepare(`SELECT allowed FROM permissions WHERE origin = ? AND permission = ?`)
    this.setQuery = db.prepare(`INSERT OR REPLACE INTO permissions (origin, permission, allowed) VALUES (?, ?, ?)`)
    this.listQuery = db.prepare(`SELECT origin, permission, allowed FROM permissions ORDER BY origin, permission`)
    this.revokeQuery = db.prepare(`DELETE FROM permissions WHERE origin = ? AND permission = ?`)
  }

  get(origin: string, permission: SitePermission | AppLinkPermission): boolean | undefined {
    const row = this.getQuery.get(origin, permission) as { allowed: number } | undefined
    return row ? row.allowed === 1 : undefined
  }

  set(origin: string, permission: SitePermission | AppLinkPermission, allowed: boolean): void {
    this.setQuery.run(origin, permission, allowed ? 1 : 0)
  }

  list(): PermissionDecision[] {
    return (this.listQuery.all() as unknown as Row[]).map((row) => ({
      origin: row.origin,
      permission: row.permission,
      allowed: row.allowed === 1
    }))
  }

  revoke(origin: string, permission: string): void {
    this.revokeQuery.run(origin, permission)
  }
}
