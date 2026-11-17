import { useId } from 'react';

/** Escolha única entre poucas opções. Rádios nativos: as setas trocam a opção. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div className="segmented-track">
        {options.map((option) => (
          <label key={option.value} className="segmented-option" title={option.hint}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
