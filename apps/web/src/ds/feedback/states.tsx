/*
 * Estados de uma área de conteúdo: vazio, erro e carregamento de página.
 * Apresentação pura — mensagens, códigos e ações chegam por propriedade.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../core/icons';
import type { PanelSpan } from '../layout/page';

/** Estado vazio: ícone, título e, opcionalmente, texto e ação. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-empty">
      <span className="px-empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      {children && <div className="px-empty-text">{children}</div>}
    </div>
  );
}

/**
 * Estado de erro de uma área. Não conhece o cliente da API: quem usa traduz o
 * erro em `message` e, se houver, no `code` de suporte (ex.: requestId).
 */
export function ErrorState({
  title = 'Algo deu errado',
  message,
  code,
  onRetry,
  retryLabel = 'Tentar novamente',
}: {
  title?: string;
  message: ReactNode;
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="px-empty" role="alert">
      <span className="px-empty-icon">
        <Icon name="alert" size={20} />
      </span>
      <strong>{title}</strong>
      <div className="px-empty-text">
        <p>{message}</p>
        {code && <p className="num">Código para suporte: {code}</p>}
        {onRetry && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

const SKELETON_SPANS: readonly PanelSpan[] = ['main', 'side', 'main', 'side'];

/** Carregamento: blocos na mesma grade da página, anunciados como status. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="px-page px-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="px-skeleton">
        <span className="px-skel" style={{ width: 220, height: 14 }} />
        <span className="px-skel" style={{ width: 300, height: 28 }} />
        <span className="px-skel" style={{ width: '60%', height: 36, borderRadius: 999 }} />
        <div className="px-grid">
          {SKELETON_SPANS.map((span, i) => (
            <div key={i} className="px-panel px-skeleton-panel" data-span={span}>
              <span className="px-skel" style={{ width: '40%', height: 14 }} />
              <span className="px-skel" style={{ width: '25%', height: 36 }} />
              <span className="px-skel" style={{ width: '100%', height: 10 }} />
              <span className="px-skel" style={{ width: '90%', height: 10 }} />
              <span className="px-skel" style={{ width: '70%', height: 10 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
