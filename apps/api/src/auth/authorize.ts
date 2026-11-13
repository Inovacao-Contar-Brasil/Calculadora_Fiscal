import { and, eq, inArray, or } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { companies, companyAccess } from "../db/schema.ts";
import type { Role } from "../db/schema.ts";
import { forbidden, notFound } from "../errors.ts";
import type { Principal } from "./session.ts";

/**
 * Regras de autorização, aplicadas sempre no backend.
 *
 * - `admin` e `fiscal` enxergam todas as empresas da(s) organização(ões) em que
 *   têm papel. Só `admin` gerencia usuários/acessos; `fiscal` e `admin` alteram
 *   cadastro fiscal e decidem revisões.
 * - `cliente` só enxerga empresas com concessão explícita em `company_access`,
 *   e nunca altera dados controlados pelo escritório.
 * - Recurso fora do escopo responde 404 (não 403) para não revelar existência.
 */

export type Company = typeof companies.$inferSelect;

export function roleIn(principal: Principal, organizationId: string): Role | null {
  return principal.memberships.find((m) => m.organizationId === organizationId)?.role ?? null;
}

export function requireRole(principal: Principal, organizationId: string, roles: Role[]): Role {
  const role = roleIn(principal, organizationId);
  if (!role) throw notFound();
  if (!roles.includes(role)) throw forbidden();
  return role;
}

const STAFF: Role[] = ["admin", "fiscal"];

export function isStaff(role: Role | null): boolean {
  return role !== null && STAFF.includes(role);
}

/** Carrega a empresa e garante que o principal pode vê-la; senão 404. */
export async function loadAccessibleCompany(db: Database, principal: Principal, companyId: string): Promise<{ company: Company; role: Role }> {
  const company = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  if (!company) throw notFound("Empresa não encontrada.");
  const role = roleIn(principal, company.organizationId);
  if (!role) throw notFound("Empresa não encontrada.");
  if (isStaff(role)) return { company, role };
  const access = await db
    .select({ id: companyAccess.id })
    .from(companyAccess)
    .where(and(eq(companyAccess.companyId, companyId), eq(companyAccess.userId, principal.userId)))
    .limit(1);
  if (!access[0]) throw notFound("Empresa não encontrada.");
  return { company, role };
}

/** Garante que o principal pode alterar dados fiscais da empresa (somente staff). */
export async function loadCompanyForStaff(db: Database, principal: Principal, companyId: string, roles: Role[] = STAFF): Promise<{ company: Company; role: Role }> {
  const loaded = await loadAccessibleCompany(db, principal, companyId);
  if (!roles.includes(loaded.role)) throw forbidden();
  return loaded;
}

/** Lista as empresas visíveis ao principal, em todas as suas organizações. */
export async function listVisibleCompanies(db: Database, principal: Principal): Promise<Company[]> {
  const staffOrgs = principal.memberships.filter((m) => isStaff(m.role)).map((m) => m.organizationId);
  const clientOrgs = principal.memberships.filter((m) => !isStaff(m.role)).map((m) => m.organizationId);
  if (staffOrgs.length === 0 && clientOrgs.length === 0) return [];

  const conditions = [];
  if (staffOrgs.length) conditions.push(inArray(companies.organizationId, staffOrgs));
  if (clientOrgs.length) {
    const granted = db
      .select({ companyId: companyAccess.companyId })
      .from(companyAccess)
      .where(eq(companyAccess.userId, principal.userId));
    conditions.push(and(inArray(companies.organizationId, clientOrgs), inArray(companies.id, granted)));
  }
  return db
    .select()
    .from(companies)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .orderBy(companies.legalName);
}
