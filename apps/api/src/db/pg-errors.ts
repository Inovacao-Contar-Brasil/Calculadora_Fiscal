/**
 * Erros do PostgreSQL (node-postgres e PGlite) chegam embrulhados pelo Drizzle
 * (`DrizzleQueryError.cause`). Estas funções percorrem a cadeia de `cause`.
 */
function* chain(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

export function pgErrorCode(error: unknown): string | null {
  for (const item of chain(error)) if (typeof item.code === "string" && /^[0-9A-Z]{5}$/.test(item.code)) return item.code;
  return null;
}

/** 23505 = unique_violation. Opcionalmente restrito a um índice/constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (pgErrorCode(error) !== "23505") return false;
  if (!constraint) return true;
  for (const item of chain(error)) {
    if (item.constraint === constraint) return true;
    if (typeof item.message === "string" && item.message.includes(constraint)) return true;
  }
  return false;
}
