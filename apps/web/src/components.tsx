import { useEffect, useState, type ReactNode } from "react";
import { ApiError, type ClassificationStatus, type DocumentStatus } from "./api";
import { useAuth } from "./auth";
import { Link, navigate, usePath } from "./router";

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout, hasRole } = useAuth();
  const path = usePath();
  const isActive = (prefix: string) => (path === prefix || path.startsWith(prefix + "/") ? "navlink active" : "navlink");
  return (
    <div className="site">
      <header className="topbar">
        <div className="brandmark" aria-hidden="true">CB</div>
        <div className="brand"><strong>Contar Brasil</strong><span>Calculadora Fiscal</span></div>
        {me && (
          <nav className="nav" aria-label="Principal">
            <Link to="/empresas" className={isActive("/empresas")}>Empresas</Link>
            {hasRole("admin", "fiscal") && <Link to="/revisao" className={isActive("/revisao")}>Revisão fiscal</Link>}
            {hasRole("admin") && <Link to="/admin" className={isActive("/admin")}>Administração</Link>}
          </nav>
        )}
        {me && (
          <div className="userbox">
            <span>{me.user.name}</span>
            <button type="button" className="linkbutton" onClick={() => void logout().then(() => navigate("/login"))}>Sair</button>
          </div>
        )}
      </header>
      <main>{children}</main>
      <footer>Contar Brasil · Fundação SaaS · Nenhum cálculo tributário homologado nesta versão</footer>
    </div>
  );
}

const CLASSIFICATION_LABEL: Record<ClassificationStatus, string> = {
  PENDENTE_REVISAO: "Pendente de revisão",
  EM_ANALISE: "Em análise",
  HOMOLOGADO: "Homologado",
  REJEITADO: "Rejeitado",
};

export function ClassificationBadge({ status }: { status: ClassificationStatus }) {
  return <span className={"badge " + status.toLowerCase()}>{CLASSIFICATION_LABEL[status]}</span>;
}

const DOCUMENT_LABEL: Record<DocumentStatus, string> = {
  IMPORTADA: "Importada",
  COM_PENDENCIAS: "Com pendências",
  REVISADA: "Revisada",
};

export function DocumentBadge({ status }: { status: DocumentStatus }) {
  return <span className={"badge " + status.toLowerCase()}>{DOCUMENT_LABEL[status]}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as { path?: string; message?: string }[]) : null;
  return (
    <div className="error" role="alert">
      {message}
      {details && details.length > 0 && (
        <ul>{details.map((d, index) => <li key={index}>{d.path ? d.path.replace(/^\//, "") + ": " : ""}{d.message}</li>)}</ul>
      )}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  return <div className={"notice " + tone} role="note">{children}</div>;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return <p className="muted">{label}</p>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
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
