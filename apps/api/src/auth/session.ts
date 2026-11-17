import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { memberships, sessions, users } from "../db/schema.ts";
import type { Role } from "../db/schema.ts";

export const SESSION_COOKIE = "cf_session";

export interface Principal {
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  /** Papel por organização. Um usuário pode pertencer a mais de uma. */
  memberships: { organizationId: string; role: Role }[];
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Database,
  userId: string,
  ttlHours: number,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Database, token: string): Promise<Principal | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = new Date();
  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;

  // Atualiza last_seen no máximo uma vez por minuto para não escrever a cada requisição.
  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  const roles = await db
    .select({ organizationId: memberships.organizationId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, row.userId));
  return { userId: row.userId, email: row.email, name: row.name, sessionId: row.sessionId, memberships: roles };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllUserSessions(db: Database, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
