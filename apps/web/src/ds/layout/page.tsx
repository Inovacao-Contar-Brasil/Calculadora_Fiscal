/*
 * Layout do Design System: página, cabeçalho de página, grade e painel.
 *
 * Um único sistema de colunas para todas as telas: 12 colunas com divisão fixa
 * principal/lateral (8/4, em components.css). Painéis não escolhem proporção
 * própria — só `main`, `side` ou `full` —, então as bordas dos cartões seguem
 * as mesmas linhas-guia em todas as linhas e em todas as páginas.
 */
import { createContext, useContext, useId, type ReactNode } from 'react';

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={narrow ? 'px-page px-page-narrow' : 'px-page'}>{children}</div>;
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  /** Ação principal da página (no máximo uma preenchida). */
  actions?: ReactNode;
  /** Metadados abaixo do título (ex.: situação e prazo no detalhe). */
  children?: ReactNode;
}) {
  return (
    <header className="px-page-head">
      <div className="px-page-titles">
        {eyebrow && <p className="px-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="px-page-sub">{subtitle}</p>}
        {children}
      </div>
      {actions}
    </header>
  );
}

/** Coluna ocupada na grade: principal (8/12), lateral (4/12) ou a largura toda. */
export type PanelSpan = 'main' | 'side' | 'full';

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="px-grid">{children}</div>;
}

/** Empilha painéis dentro de uma mesma coluna da grade. */
export function PanelStack({ span, children }: { span: PanelSpan; children: ReactNode }) {
  return (
    <div className="px-stack" data-span={span}>
      {children}
    </div>
  );
}

/**
 * Nível do título dos painéis: 2 por padrão; 3 dentro de uma seção de módulo
 * da Home (que já tem o próprio h2). Mantém a hierarquia correta sem props.
 */
export const PanelLevelContext = createContext<2 | 3>(2);

export function Panel({
  title,
  description,
  actions,
  children,
  span,
  className = '',
  flush = false,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  span?: PanelSpan;
  className?: string;
  /** Conteúdo de borda a borda (listas e tabelas); sem isso, ganha a margem interna padrão. */
  flush?: boolean;
}) {
  const id = useId();
  const Heading = useContext(PanelLevelContext) === 3 ? 'h3' : 'h2';
  return (
    <section
      className={`px-panel px-panel-flush ${className}`.trim()}
      aria-labelledby={id}
      data-span={span}
    >
      <header className="px-panel-head">
        <div className="px-panel-titles">
          <Heading id={id}>{title}</Heading>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="px-panel-actions">{actions}</div>}
      </header>
      {flush ? children : <div className="px-panel-body">{children}</div>}
    </section>
  );
}
