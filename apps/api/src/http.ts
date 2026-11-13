import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { Principal } from "./auth/session.ts";
import type { Config } from "./config.ts";
import type { Database } from "./db/client.ts";
import { unauthorized } from "./errors.ts";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
  interface FastifyInstance {
    db: Database;
    config: Config;
  }
}

export function requireAuth(request: FastifyRequest): Principal {
  if (!request.principal) throw unauthorized();
  return request.principal;
}

export const idParams = z.object({ id: z.uuid() });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato YYYY-MM-DD.").refine((value) => {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}, "Data inválida.");

export function clientIp(request: FastifyRequest): string | null {
  return request.ip || null;
}
