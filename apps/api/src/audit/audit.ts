import type { Database } from "../db/client.ts";
import { auditEvents } from "../db/schema.ts";

export interface AuditInput {
  actorUserId: string | null;
  organizationId: string | null;
  companyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Trilha de auditoria append-only. Deve ser chamada dentro da mesma transação
 * da operação de negócio sempre que possível (passe o `tx` como `db`), para
 * que a mudança e o seu registro sejam atômicos.
 */
export async function audit(db: Database, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    companyId: input.companyId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
  });
}
