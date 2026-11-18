/**
 * JSON canônico (chaves ordenadas, sem espaços) para hashing determinístico do
 * conteúdo de uma versão de regra. Mesmos dados → mesma string, em qualquer
 * motor ou ordem de inserção das chaves. Aceita só tipos JSON.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Número não finito não é JSON canônico.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
  }
  throw new Error("Tipo não suportado em JSON canônico: " + typeof value);
}
