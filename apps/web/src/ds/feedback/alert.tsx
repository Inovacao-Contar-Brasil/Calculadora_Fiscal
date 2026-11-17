import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ALERT_PREFIX: Record<AlertTone, string> = {
  info: 'Informação',
  success: 'Sucesso',
  warning: 'Atenção',
  danger: 'Erro',
};

/** Alerta com os quatro tons; o prefixo textual garante que a cor não é o único sinal. */
export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <strong>{ALERT_PREFIX[tone]}:</strong> {children}
    </div>
  );
}
