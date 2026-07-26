import type { Kysely } from 'kysely';
import type { DB } from '../db/types';

export interface AuditLogEntry {
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string;
}

export async function writeAuditLog(db: Kysely<DB>, entry: AuditLogEntry): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      actor_user_id: entry.actorUserId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      before_state: entry.beforeState !== undefined ? JSON.stringify(entry.beforeState) : null,
      after_state: entry.afterState !== undefined ? JSON.stringify(entry.afterState) : null,
      reason: entry.reason ?? null,
    })
    .execute();
}
