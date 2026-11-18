import type { FastifyInstance } from "fastify";
import { taxRuleRoutes } from "./rules.ts";
import { legalSourceRoutes } from "./sources.ts";

/** Catálogo legal versionado (Sprint 2A.1). Todas as rotas são staff-only; ver access.ts. */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  await app.register(legalSourceRoutes);
  await app.register(taxRuleRoutes);
}
