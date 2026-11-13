import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { SESSION_COOKIE, resolveSession } from "./auth/session.ts";
import type { Config } from "./config.ts";
import type { Database } from "./db/client.ts";
import { AppError } from "./errors.ts";
import { authRoutes } from "./modules/auth.ts";
import { companyRoutes } from "./modules/companies.ts";
import { documentRoutes } from "./modules/documents.ts";
import { fiscalProfileRoutes } from "./modules/fiscal-profiles.ts";
import { reviewRoutes } from "./modules/review.ts";

export interface AppDeps {
  db: Database;
  config: Config;
  logger?: boolean | object;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? { level: deps.config.LOG_LEVEL },
    trustProxy: deps.config.TRUST_PROXY === "true",
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", deps.db);
  app.decorate("config", deps.config);
  app.decorateRequest("principal", null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  // XML da NF-e chega como texto cru; o parser do domínio valida o conteúdo.
  app.addContentTypeParser(["application/xml", "text/xml", "text/plain"], { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.principal = token ? await resolveSession(deps.db, token) : null;
  });

  // Defesa CSRF: cookie SameSite=Strict + verificação de Origin em métodos mutáveis.
  app.addHook("onRequest", async (request, reply) => {
    if (!MUTATING.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !deps.config.allowedOrigins.includes(origin) && origin !== request.protocol + "://" + request.host) {
      reply.code(403).send({ error: { code: "FORBIDDEN_ORIGIN", message: "Origem não permitida." } });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details ?? undefined } });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: { code: "VALIDATION", message: "Dados inválidos.", details: error.validation.map((issue) => ({ path: issue.instancePath, message: issue.message })) },
      });
    }
    const status = typeof (error as { statusCode?: number }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, "erro interno");
      return reply.code(500).send({ error: { code: "INTERNAL", message: "Erro interno. Tente novamente mais tarde." } });
    }
    // Erros HTTP do próprio Fastify (ex.: 413, 415, 429) com mensagem segura.
    return reply.code(status).send({ error: { code: (error as { code?: string }).code ?? "HTTP_" + status, message: (error as Error).message } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } });
  });

  app.get("/api/health", async () => ({ ok: true, service: "calculadora-fiscal-api", time: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(fiscalProfileRoutes);
  await app.register(documentRoutes);
  await app.register(reviewRoutes);

  if (deps.config.WEB_DIST_DIR) {
    const fastifyStatic = (await import("@fastify/static")).default;
    const path = await import("node:path");
    await app.register(fastifyStatic, { root: path.resolve(deps.config.WEB_DIST_DIR), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
