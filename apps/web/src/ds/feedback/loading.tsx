/* Carregamento em linha: indicador + texto, anunciado como status. */
export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
