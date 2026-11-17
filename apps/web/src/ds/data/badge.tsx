/* Etiquetas de estado: sempre com texto (a cor nunca é o único sinal). */
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
