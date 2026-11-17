/*
 * Seleção binária com controles nativos: caixa de marcação e interruptor.
 * O rótulo envolve o controle (clique no texto alterna) e a dica fica associada
 * por aria-describedby. Estado e mudança são de quem usa (props nativas).
 */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
};

function Toggle({
  kind,
  label,
  hint,
  className = '',
  ...props
}: ToggleProps & { kind: 'check' | 'switch' }) {
  const id = useId();
  return (
    <label className={`px-${kind} ${className}`.trim()}>
      <input
        {...props}
        type="checkbox"
        role={kind === 'switch' ? 'switch' : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <span className={`px-${kind}-text`}>
        {label}
        {hint && <small id={`${id}-hint`}>{hint}</small>}
      </span>
    </label>
  );
}

/** Caixa de marcação: uma opção independente ou item de uma lista de escolhas. */
export function Checkbox(props: ToggleProps) {
  return <Toggle kind="check" {...props} />;
}

/** Interruptor: liga/desliga com efeito imediato (preferências e configurações). */
export function Switch(props: ToggleProps) {
  return <Toggle kind="switch" {...props} />;
}
