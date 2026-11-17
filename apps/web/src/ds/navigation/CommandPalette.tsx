/*
 * Paleta "buscar ou ir para": combobox + listbox dentro de um diálogo modal
 * (setas, Enter e Esc). Não busca nada sozinha: quem hospeda entrega os itens
 * para cada texto digitado (`search`) e decide o que fazer com o escolhido.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../core/icons';
import { useModalDialog } from '../core/useModalDialog';

export interface PaletteItem {
  id: string;
  /** Título do grupo; itens consecutivos do mesmo grupo ficam sob um cabeçalho. */
  group: string;
  label: string;
  icon: IconName;
  /** Informação de apoio à direita (ex.: situação). */
  meta?: ReactNode;
}

export function CommandPalette<T extends PaletteItem>({
  search,
  onSelect,
  onClose,
  placeholder,
  emptyMessage,
  scopeNote,
}: {
  /** Itens para o texto digitado. Passe uma função estável (`useCallback`). */
  search: (query: string) => readonly T[];
  onSelect: (item: T) => void;
  onClose: () => void;
  placeholder: string;
  emptyMessage: (query: string) => ReactNode;
  /** Nota de rodapé sobre o alcance da busca. */
  scopeNote?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { ref, onCancel, onBackdropClick } = useModalDialog(onClose);
  const listId = useId();
  const items = useMemo(() => search(query), [search, query]);

  const safeActive = Math.min(active, Math.max(items.length - 1, 0));
  const go = (item: T | undefined) => {
    if (!item) return;
    onClose();
    onSelect(item);
  };

  return (
    <dialog
      ref={ref}
      className="px-palette"
      aria-label="Buscar ou ir para"
      onCancel={onCancel}
      onClick={onBackdropClick}
    >
      <div className="px-palette-input">
        <Icon name="search" size={18} />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            items[safeActive] ? `${listId}-${items[safeActive].id}` : undefined
          }
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((safeActive + 1) % Math.max(items.length, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((safeActive - 1 + items.length) % Math.max(items.length, 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(items[safeActive]);
            }
          }}
        />
        <kbd className="px-kbd">Esc</kbd>
      </div>
      <ul className="px-palette-list" id={listId} role="listbox" aria-label="Resultados">
        {items.map((item, index) => {
          // Cabeçalho só no primeiro item de cada grupo consecutivo.
          const header = items[index - 1]?.group !== item.group ? item.group : null;
          return (
            <li key={item.id} role="presentation">
              {header && (
                <div className="px-palette-group" role="presentation">
                  {header}
                </div>
              )}
              <div
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={index === safeActive}
                className="px-palette-item"
                onPointerMove={() => setActive(index)}
                onClick={() => go(item)}
              >
                <Icon name={item.icon} size={17} />
                <span className="px-palette-label">{item.label}</span>
                {item.meta && <span className="px-palette-meta">{item.meta}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length === 0 && <p className="px-palette-empty">{emptyMessage(query)}</p>}
      <footer className="px-palette-foot">
        <span>
          <kbd className="px-kbd">↑</kbd> <kbd className="px-kbd">↓</kbd> navegar
        </span>
        <span>
          <kbd className="px-kbd">Enter</kbd> abrir
        </span>
        {scopeNote && <span className="px-palette-scope">{scopeNote}</span>}
      </footer>
    </dialog>
  );
}
