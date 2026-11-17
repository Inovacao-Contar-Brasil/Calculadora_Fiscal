/*
 * Dados tabulares: tabela, situação e paginação. Apresentação pura — linhas,
 * rótulos e totais chegam por propriedade; nada aqui busca ou ordena dados.
 */
import type { ReactNode, TableHTMLAttributes } from 'react';
import { Icon } from '../core/icons';

/**
 * Tabela do Design System. Use marcação nativa (thead/tbody/th scope) e, em cada
 * célula de dado, `data-label` com o nome da coluna: no celular as linhas viram
 * blocos compactos e o cabeçalho fica só para leitores de tela.
 * Dentro de um `Panel flush` ou de uma `section.px-panel.px-panel-flush`.
 */
export function Table({ className = '', ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={`px-table ${className}`.trim()} {...props} />;
}

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/**
 * Situação: ponto + texto (a cor nunca é o único sinal). O módulo traduz os
 * próprios estados em um tom; `outline` marca o estado inicial/pendente.
 */
export function Status({
  tone = 'neutral',
  outline = false,
  children,
}: {
  tone?: StatusTone;
  outline?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="px-status" data-tone={tone} data-outline={outline || undefined}>
      <span className="px-status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * Paginação de uma lista: faixa exibida, total e páginas anterior/próxima.
 * `page` começa em 1. Fica no rodapé do painel que contém a tabela.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  label = 'Paginação',
  itemsLabel = 'itens',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Nome acessível da navegação (ex.: "Paginação de membros"). */
  label?: string;
  /** Substantivo do total (ex.: "pessoas"). */
  itemsLabel?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);
  return (
    <nav className="px-table-foot px-pagination" aria-label={label}>
      <span role="status">
        Exibindo{' '}
        <span className="num">
          {first}–{last}
        </span>{' '}
        de <span className="num">{total}</span> {itemsLabel}
      </span>
      <span className="px-pagination-controls">
        <button
          type="button"
          className="px-icon-btn"
          aria-label="Página anterior"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <span className="num">
          Página {current} de {pages}
        </span>
        <button
          type="button"
          className="px-icon-btn"
          aria-label="Próxima página"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </span>
    </nav>
  );
}
