/*
 * Diálogos modais nativos. O comportamento (foco preso, Esc, retorno do foco)
 * vem de `useModalDialog`; aqui fica só a apresentação.
 */
import { useId, type ReactNode } from 'react';
import { useModalDialog } from '../core/useModalDialog';

/** Diálogo central com título, corpo e rodapé de ações. */
export function Dialog({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { ref, onCancel } = useModalDialog(onClose);
  const titleId = useId();
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={onCancel}>
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="btn btn-ghost dialog-close"
          aria-label="Fechar"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </dialog>
  );
}

/** Painel modal ancorado a uma borda (no celular); clique no fundo fecha. */
export function Sheet({
  label,
  side = 'bottom',
  onClose,
  children,
  className = '',
}: {
  label: string;
  side?: 'bottom' | 'top';
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { ref, onCancel, onBackdropClick } = useModalDialog(onClose);
  return (
    <dialog
      ref={ref}
      className={`px-sheet px-sheet-${side} ${className}`.trim()}
      aria-label={label}
      onCancel={onCancel}
      onClick={onBackdropClick}
    >
      <div className="px-sheet-body">{children}</div>
    </dialog>
  );
}
