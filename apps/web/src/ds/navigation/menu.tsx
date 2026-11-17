/*
 * Menu suspenso (padrão WAI-ARIA "menu button"). Só tokens semânticos; sem
 * dados, sem rede e sem regra de negócio.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../core/icons';

interface MenuButtonProps {
  label: string;
  /** Conteúdo visível do botão. */
  button: ReactNode;
  buttonClassName?: string;
  placement?: 'bottom' | 'top';
  align?: 'start' | 'end';
  menuClassName?: string;
  children: (close: () => void) => ReactNode;
}

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"]';

/**
 * Botão com menu (padrão WAI-ARIA "menu button"): setas, Home/End, Esc fecha
 * e devolve o foco ao botão, clique fora fecha.
 */
export function MenuButton({
  label,
  button,
  buttonClassName = '',
  placement = 'bottom',
  align = 'start',
  menuClassName = '',
  children,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Fechar só muda o estado; o foco volta ao botão na limpeza do efeito,
  // exceto quando o fechamento vem de clique fora ou Tab (o foco segue adiante).
  const close = useCallback(() => setOpen(false), []);
  const keepFocus = useRef(false);

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      keepFocus.current = true;
      setOpen(false);
    };
    const button = buttonRef.current;
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      if (!keepFocus.current && button?.isConnected) button.focus();
      keepFocus.current = false;
    };
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      keepFocus.current = true;
      setOpen(false);
    }
  }

  return (
    <div className="px-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {button}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`px-menu px-menu-${placement} px-menu-${align} ${menuClassName}`.trim()}
          onKeyDown={onMenuKeyDown}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  onSelect,
  checked,
  danger = false,
}: {
  icon?: IconName;
  children: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
  /** Definido → item de escolha única (menuitemradio). */
  checked?: boolean;
  danger?: boolean;
}) {
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      tabIndex={-1}
      className={`px-menu-item ${danger ? 'px-menu-item-danger' : ''}`.trim()}
      onClick={onSelect}
    >
      {icon && <Icon name={icon} size={16} />}
      <span className="px-menu-item-label">
        {children}
        {hint && <small>{hint}</small>}
      </span>
      {radio && checked && <Icon name="check" size={16} className="px-menu-check" />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-menu-label" role="presentation">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="px-menu-sep" role="separator" />;
}
