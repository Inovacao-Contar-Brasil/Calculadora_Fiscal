import type { StaffRole } from "@calculadora-fiscal/domain";
import { isStaff, roleIn } from "../../auth/authorize.ts";
import type { Principal } from "../../auth/session.ts";
import { forbidden, notFound } from "../../errors.ts";

/**
 * Autorização do catálogo legal. O catálogo é do ESCRITÓRIO: nunca faz parte
 * do escopo do cliente, mesmo da mesma organização.
 *
 * - Coleções por organização (`/api/organizations/:id/...`): não membro → 404;
 *   membro sem papel staff (cliente) → 403. A organização vem da URL e é
 *   conferida contra as associações do usuário autenticado; nenhum
 *   `organizationId` do corpo da requisição é aceito.
 * - Recursos por ID: inexistente, de outra organização ou acessado por
 *   cliente → 404 com corpo idêntico (sem oráculo de existência).
 */

export function requireCatalogStaff(principal: Principal, organizationId: string, roles: readonly StaffRole[] = ["admin", "fiscal"]): StaffRole {
  const role = roleIn(principal, organizationId);
  if (!role) throw notFound("Organização não encontrada.");
  if (!isStaff(role)) throw forbidden("O catálogo legal é restrito à equipe do escritório.");
  if (!roles.includes(role as StaffRole)) throw forbidden();
  return role as StaffRole;
}

/** Para recursos já carregados por ID: fora do escopo staff = 404 com a mensagem do recurso. */
export function staffRoleOrNotFound(principal: Principal, organizationId: string, notFoundMessage: string): StaffRole {
  const role = roleIn(principal, organizationId);
  if (!isStaff(role)) throw notFound(notFoundMessage);
  return role as StaffRole;
}

export const NOT_FOUND = {
  source: "Fonte normativa não encontrada.",
  provision: "Dispositivo legal não encontrado.",
  rule: "Regra não encontrada.",
  version: "Versão de regra não encontrada.",
} as const;
