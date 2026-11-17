import { z } from "zod";

/**
 * Configuração via variáveis de ambiente. Nunca gravar segredos no repositório;
 * ver .env.example. Sem DATABASE_URL a API usa PGlite (PostgreSQL embarcado)
 * em `PGLITE_DIR`, o que serve apenas a desenvolvimento local e testes.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DIR: z.string().default(".data/pglite"),
  /** Duração absoluta da sessão, em horas. */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  /** Tentativas de login por IP por minuto antes do 429. */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  /** Origens permitidas para requisições mutáveis (CSRF). Separadas por vírgula. */
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  /** Marque como "true" quando a API estiver atrás de proxy TLS (Secure cookies). */
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Diretório com build do frontend para servir no mesmo origin (opcional). */
  WEB_DIST_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema> & {
  allowedOrigins: string[];
  cookieSecure: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; ");
    throw new Error("Configuração inválida: " + detail);
  }
  const value = parsed.data;
  if (value.NODE_ENV === "production" && !value.DATABASE_URL) {
    throw new Error("DATABASE_URL é obrigatória em produção (PGlite é apenas para desenvolvimento/testes).");
  }
  return {
    ...value,
    allowedOrigins: value.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    cookieSecure: value.COOKIE_SECURE ? value.COOKIE_SECURE === "true" : value.NODE_ENV === "production",
  };
}
