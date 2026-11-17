/*
 * Navegação inferior do AppShell no celular: os mesmos itens da barra lateral
 * e o botão "Mais", que abre um painel modal fornecido por quem hospeda.
 */
import { useState, type ReactNode } from 'react';
import { Icon } from '../core/icons';
import { AppLink } from '../core/link';
import type { NavItem } from './Sidebar';

export function BottomNav({
  items,
  currentId,
  more,
}: {
  items: readonly NavItem[];
  currentId?: string;
  /** Conteúdo do painel "Mais" (`MoreSheet`); recebe a função que o fecha. */
  more?: (close: () => void) => ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      <nav className="px-bottom-nav" aria-label="Navegação principal (celular)">
        {items.map((item) => (
          <AppLink
            key={item.id}
            href={item.href}
            className="px-bottom-item"
            current={currentId === item.id}
          >
            <span className="px-bottom-icon">
              <Icon name={item.icon} size={21} />
              {item.count !== undefined && item.count > 0 && (
                <span className="px-bottom-badge num" aria-hidden="true">
                  {item.count}
                </span>
              )}
            </span>
            {item.label}
          </AppLink>
        ))}
        {more && (
          <button
            type="button"
            className="px-bottom-item"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <span className="px-bottom-icon">
              <Icon name="menu" size={21} />
            </span>
            Mais
          </button>
        )}
      </nav>
      {more && moreOpen && more(() => setMoreOpen(false))}
    </>
  );
}
