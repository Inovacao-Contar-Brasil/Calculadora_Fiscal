/* Pessoas e contagens: avatar com iniciais, pessoa (avatar + nome) e etiqueta de contagem. */
import type { ReactNode } from 'react';
import { initials } from '../core/format';

export function Avatar({
  name,
  size = 24,
  tone = 'neutral',
}: {
  name: string;
  size?: number;
  tone?: 'neutral' | 'brand';
}) {
  return (
    <span
      className={`px-avatar px-avatar-${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** Pessoa: avatar + nome. Sem nome, mostra `emptyLabel` (o texto é de quem usa). */
export function Person({
  name,
  size = 22,
  emptyLabel = '—',
}: {
  name: string | null;
  size?: number;
  emptyLabel?: string;
}) {
  if (!name) return <span className="px-person px-person-empty">{emptyLabel}</span>;
  return (
    <span className="px-person">
      <Avatar name={name} size={size} />
      <span className="px-person-name">{name}</span>
    </span>
  );
}

export function CountTag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  return <span className={`px-count px-count-${tone}`}>{children}</span>;
}
