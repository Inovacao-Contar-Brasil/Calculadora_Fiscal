/*
 * Barra lateral do AppShell: identidade, organização ativa, navegação principal,
 * grupo opcional de itens "em breve" e conta no rodapé.
 *
 * Apresentação pura. Quem hospeda decide quais itens existem (permissões), para
 * onde levam (href) e qual está ativo; o Design System não conhece módulos,
 * rotas nem dados.
 */
import { useId, useState, type ReactNode } from 'react';
import { BrandLogo } from '../../theme/components';
import { Icon, type IconName } from '../core/icons';
import { AppLink } from '../core/link';

export interface NavItem {
  /** Identificador estável da seção (comparado com `currentId`). */
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** Contador ao lado do rótulo; só aparece quando maior que zero. */
  count?: number;
  /** Nome acessível do contador (ex.: "21 pendentes"). */
  countLabel?: string;
}

/** Grupo de itens ainda indisponíveis: aparecem sem link e marcados uma única vez. */
export interface UpcomingGroup {
  label: string;
  /** Etiqueta única do grupo (ex.: "Em breve"). */
  badge?: string;
  /** Complemento lido por leitores de tela em cada item (ex.: "(em breve)"). */
  itemHint?: string;
  items: readonly { label: string; icon: IconName }[];
  /** Chave para lembrar, neste dispositivo, se o grupo está aberto. */
  storageKey?: string;
}

export function UpcomingList({ group, id }: { group: UpcomingGroup; id?: string }) {
  return (
    <ul className="px-nav-list px-nav-future" id={id}>
      {group.items.map((item) => (
        <li key={item.label} aria-disabled="true">
          <span className="px-nav-item px-nav-item-disabled">
            <Icon name={item.icon} size={17} />
            <span className="px-nav-label">{item.label}</span>
            {group.itemHint && <span className="sr-only">{group.itemHint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Preferência pessoal do dispositivo; o armazenamento pode estar bloqueado.
function readOpen(key: string | undefined): boolean {
  if (!key) return true;
  try {
    return window.localStorage.getItem(key) !== 'false';
  } catch {
    return true;
  }
}
function writeOpen(key: string | undefined, open: boolean) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, String(open));
  } catch {
    /* fica só em memória */
  }
}

function UpcomingNavGroup({ group }: { group: UpcomingGroup }) {
  const [open, setOpen] = useState(() => readOpen(group.storageKey));
  const id = useId();
  return (
    <div className="px-nav-group">
      <button
        type="button"
        className="px-nav-group-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          writeOpen(group.storageKey, !open);
          setOpen(!open);
        }}
      >
        {group.label}
        {group.badge && <span className="px-soon">{group.badge}</span>}
        <Icon name="chevronDown" size={14} />
      </button>
      {/* Recolhe com transição de altura; fechado fica inerte (fora do foco e do leitor). */}
      <div className="px-collapse" data-open={open} inert={!open} id={id}>
        <div>
          <UpcomingList group={group} />
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  brandHref,
  brandLabel,
  organization,
  caption,
  items,
  currentId,
  upcoming,
  footer,
}: {
  /** Destino e nome acessível do logotipo no topo. */
  brandHref: string;
  brandLabel: string;
  /** Seletor da organização ativa (`OrgSwitcher`). */
  organization?: ReactNode;
  /** Rótulo discreto acima da navegação (ex.: "Espaço de trabalho"). */
  caption?: string;
  items: readonly NavItem[];
  currentId?: string;
  upcoming?: UpcomingGroup;
  /** Rodapé fixo (`AccountMenu`). */
  footer?: ReactNode;
}) {
  return (
    <aside className="px-sidebar" aria-label="Barra lateral">
      <div className="px-brand">
        <AppLink href={brandHref} className="px-brand-link" aria-label={brandLabel}>
          <BrandLogo decorative />
        </AppLink>
      </div>
      {organization}
      <nav className="px-nav" aria-label="Navegação principal">
        {caption && (
          <p className="px-nav-caption" aria-hidden="true">
            {caption}
          </p>
        )}
        <ul className="px-nav-list">
          {items.map((item) => (
            <li key={item.id}>
              <AppLink href={item.href} className="px-nav-item" current={currentId === item.id}>
                <Icon name={item.icon} size={18} />
                <span className="px-nav-label">{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className="px-nav-count num" aria-label={item.countLabel}>
                    {item.count}
                  </span>
                )}
              </AppLink>
            </li>
          ))}
        </ul>
        {upcoming && <UpcomingNavGroup group={upcoming} />}
      </nav>
      {footer && <div className="px-sidebar-foot">{footer}</div>}
    </aside>
  );
}
