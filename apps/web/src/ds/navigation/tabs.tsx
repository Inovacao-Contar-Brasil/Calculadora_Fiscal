import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

/** Abas WAI-ARIA com ativação automática (setas, Home, End). */
export function Tabs({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = items.find((item) => item.id === selected) ?? items[0];
  if (!current) return null;
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const target = next === null ? undefined : items[next];
    if (!target) return;
    event.preventDefault();
    onSelect(target.id);
    refs.current[target.id]?.focus();
  }
  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tab-list">
        {items.map((item, index) => {
          const active = item.id === current.id;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-${item.id}-tab`}
              aria-selected={active}
              aria-controls={`${base}-${item.id}-panel`}
              tabIndex={active ? 0 : -1}
              className="tab"
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-${current.id}-panel`}
        aria-labelledby={`${base}-${current.id}-tab`}
        tabIndex={0}
        className="tab-panel"
      >
        {current.content}
      </div>
    </div>
  );
}
