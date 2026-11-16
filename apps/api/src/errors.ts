/**
 * Erros de aplicação com código HTTP e mensagem segura para o cliente.
 * Qualquer outro erro é registrado no log e respondido como 500 genérico,
 * sem vazar detalhes internos.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Autenticação necessária.") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Sem permissão para esta operação.") => new AppError(403, "FORBIDDEN", message);
/** Usado também quando o recurso existe mas pertence a outro escopo: não revelar existência. */
export const notFound = (message = "Recurso não encontrado.") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, "UNPROCESSABLE", message, details);
export const badRequest = (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details);

/**
 * Para recursos acessados por ID cujo escopo é verificado pela empresa dona:
 * fora do escopo deve responder exatamente como inexistente (mesmo status e
 * mensagem) — "Empresa não encontrada." revelaria que o ID existe.
 * Outros erros (inclusive falhas de banco) são repassados intactos.
 */
export function asNotFound(message: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof AppError && error.statusCode === 404) throw notFound(message);
    throw error;
  };
}
