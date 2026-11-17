/*
 * Adaptadores da Calculadora sobre o Design System (src/ds). Não são componentes
 * de apresentação novos: traduzem dados do produto (erros da API, situações de
 * classificação e de documento) para os componentes oficiais.
 */
import { useEffect, useState } from "react";
import { ApiError, type ClassificationStatus, type DocumentStatus } from "./api";
import { Alert, ErrorState, Status, type StatusTone } from "./ds";

/** Mensagem segura para exibição a partir de qualquer erro. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return String(error);
}

function detailsOf(error: unknown): { path?: string; message?: string }[] {
  return error instanceof ApiError && Array.isArray(error.details) ? (error.details as { path?: string; message?: string }[]) : [];
}

/** Erro de uma ação (formulário, importação): alerta com os detalhes de validação. */
export function ApiErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const details = detailsOf(error);
  return (
    <Alert tone="danger">
      {messageOf(error)}
      {details.length > 0 && (
        <ul className="cf-error-details">
          {details.map((detail, index) => (
            <li key={index}>
              {detail.path ? detail.path.replace(/^\//, "") + ": " : ""}
              {detail.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/** Erro ao carregar uma área: estado de erro do Design System, com nova tentativa. */
export function LoadError({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const code = error instanceof ApiError && error.status ? "HTTP " + error.status : undefined;
  return <ErrorState title={title ?? "Não foi possível carregar"} message={messageOf(error)} code={code} onRetry={onRetry} />;
}

const CLASSIFICATION: Record<ClassificationStatus, { label: string; tone: StatusTone; outline?: boolean }> = {
  PENDENTE_REVISAO: { label: "Pendente de revisão", tone: "warning", outline: true },
  EM_ANALISE: { label: "Em análise", tone: "info" },
  HOMOLOGADO: { label: "Homologado", tone: "success" },
  REJEITADO: { label: "Rejeitado", tone: "danger" },
};

export const CLASSIFICATION_STATUSES = Object.keys(CLASSIFICATION) as ClassificationStatus[];
export const classificationLabel = (status: ClassificationStatus) => CLASSIFICATION[status].label;

/** Situação de classificação: ponto + texto (a cor nunca é o único sinal). */
export function ClassificationBadge({ status }: { status: ClassificationStatus }) {
  const { label, tone, outline } = CLASSIFICATION[status];
  return <Status tone={tone} outline={outline}>{label}</Status>;
}

const DOCUMENT: Record<DocumentStatus, { label: string; tone: StatusTone }> = {
  IMPORTADA: { label: "Importada", tone: "info" },
  COM_PENDENCIAS: { label: "Com pendências", tone: "warning" },
  REVISADA: { label: "Revisada", tone: "success" },
};

export function DocumentBadge({ status }: { status: DocumentStatus }) {
  const { label, tone } = DOCUMENT[status];
  return <Status tone={tone}>{label}</Status>;
}

/** Hook utilitário para carregar dados com estado de erro/carregamento. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((failure) => { if (!cancelled) setError(failure); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
