/*
 * Cabeçalho do AppShell: onde a pessoa está (organização › seção › página),
 * busca "ir para" e aparência. No celular mostra o símbolo e o seletor compacto
 * de organização. Ações de criação ficam na própria página (uma por tela).
 */
import { Fragment, type ReactNode } from 'react';
import { useBrandIdentity } from '../../theme/ThemeProvider';
import { Icon } from '../core/icons';
import { AppLink } from '../core/link';
import { OrgAvatar } from './account';
import { AppearanceMenu } from './appearance';

export function Header({
  organizationName,
  ancestors = [],
  current,
  organization,
  onSearch,
}: {
  organizationName: string;
  /** Seções acima da página atual, como links de volta. */
  ancestors?: readonly { label: string; href: string }[];
  /** Nome da página atual. */
  current: string;
  /** Seletor compacto de organização para o celular (`OrgSwitcher compact`). */
  organization?: ReactNode;
  /** Abre a busca "ir para"; sem isso a busca não aparece. */
  onSearch?: () => void;
}) {
  const { logos } = useBrandIdentity();
  return (
    <header className="px-header">
      <div className="px-header-inner">
        <nav className="px-header-context" aria-label="Você está em">
          <span className="px-header-org">{organizationName}</span>
          <Icon name="chevronRight" size={14} />
          {ancestors.map((item) => (
            <Fragment key={item.href}>
              <AppLink href={item.href} className="px-header-crumb">
                {item.label}
              </AppLink>
              <Icon name="chevronRight" size={14} />
            </Fragment>
          ))}
          <span className="px-header-section" aria-current="page">
            {current}
          </span>
        </nav>
        <div className="px-header-mobile-brand">
          {logos ? (
            <img
              className="px-header-symbol"
              src={logos.symbol.src}
              width={logos.symbol.width}
              height={logos.symbol.height}
              alt=""
            />
          ) : (
            <OrgAvatar size={26} />
          )}
          {organization}
        </div>
        {onSearch && (
          <button
            type="button"
            className="px-search"
            onClick={onSearch}
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Icon name="search" size={17} />
            <span className="px-search-label">Buscar ou ir para…</span>
            <kbd className="px-kbd">Ctrl K</kbd>
          </button>
        )}
        <div className="px-header-actions">
          {onSearch && (
            <button
              type="button"
              className="px-icon-btn px-only-mobile"
              aria-label="Buscar ou ir para"
              onClick={onSearch}
            >
              <Icon name="search" size={19} />
            </button>
          )}
          <span className="px-only-desktop">
            <AppearanceMenu />
          </span>
        </div>
      </div>
    </header>
  );
}
