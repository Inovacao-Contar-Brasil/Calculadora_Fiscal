/*
 * Home modular. Cada módulo do produto contribui com:
 *  - ações rápidas (pílulas no topo);
 *  - uma seção própria, com cabeçalho e painéis na grade compartilhada.
 * A Home só mostra módulos cuja permissão mínima a pessoa tem na organização
 * ativa, e não conhece os dados de nenhum módulo: cada um lê os próprios dados
 * (sempre da organização ativa) em `useHome` e em `Body`.
 * Módulos novos só entram quando existirem de fato — nada de blocos de exemplo.
 * Ver docs/16 §9.
 */
import { useId, type ComponentType, type ReactNode } from 'react';
import { Icon, type IconName } from '../core/icons';
import { EmptyState } from '../feedback/states';
import { Panel, PanelLevelContext } from './page';
import { AppLink } from '../core/link';

export interface QuickAction {
  label: string;
  icon: IconName;
  href: string;
  count?: number;
  /** Ação preenchida. A Home só aceita a do primeiro módulo (uma por tela). */
  primary?: boolean;
}

export interface HomeModuleHeader {
  /** Página principal do módulo e o texto do link no cabeçalho da seção. */
  href: string;
  linkLabel: string;
  /** Resumo curto ao lado do título (ex.: "21 em aberto"). */
  summary?: ReactNode;
  /** Ações rápidas do módulo, já filtradas pelas permissões da pessoa. */
  quickActions?: readonly QuickAction[];
}

/** `P` é o tipo de permissão de quem hospeda (no Hub, o `Permission` dos contratos). */
export interface HomeModule<P extends string = string> {
  id: string;
  title: string;
  icon: IconName;
  /** Permissão mínima, na organização ativa, para o módulo aparecer na Home. */
  requires: P;
  /** Hook do módulo: cabeçalho e ações a partir dos dados da organização ativa. */
  useHome: () => HomeModuleHeader;
  /** Painéis do módulo, dentro de um `PanelGrid`. */
  Body: ComponentType;
}

function QuickChip({ action, allowPrimary }: { action: QuickAction; allowPrimary: boolean }) {
  return (
    <AppLink
      href={action.href}
      className={action.primary && allowPrimary ? 'px-chip px-chip-primary' : 'px-chip'}
    >
      <Icon name={action.icon} size={16} />
      {action.label}
      {action.count !== undefined && (
        <span className="px-chip-count num" aria-label={`(${action.count})`}>
          {action.count}
        </span>
      )}
    </AppLink>
  );
}

function ModuleActions({ module, allowPrimary }: { module: HomeModule; allowPrimary: boolean }) {
  const { quickActions = [] } = module.useHome();
  return quickActions.map((action) => (
    <QuickChip key={action.label} action={action} allowPrimary={allowPrimary} />
  ));
}

/** Seção de um módulo: título h2, resumo, link e painéis com título h3. */
function HomeSection({ module }: { module: HomeModule }) {
  const id = useId();
  const { href, linkLabel, summary } = module.useHome();
  const { Body } = module;
  return (
    <section className="px-home-module" aria-labelledby={id} data-module={module.id}>
      <header className="px-home-module-head">
        <span className="px-home-module-icon" aria-hidden="true">
          <Icon name={module.icon} size={16} />
        </span>
        <h2 id={id}>{module.title}</h2>
        {summary && <span className="px-home-module-summary">{summary}</span>}
        <AppLink href={href} className="px-link-subtle px-home-module-link">
          {linkLabel}
          <Icon name="chevronRight" size={14} />
        </AppLink>
      </header>
      <PanelLevelContext.Provider value={3}>
        <Body />
      </PanelLevelContext.Provider>
    </section>
  );
}

/**
 * Composição da Home: ações rápidas e seções dos módulos permitidos, na ordem
 * de registro. `extraActions` são atalhos que não pertencem a um módulo.
 */
export function HomeModules<P extends string>({
  modules,
  can,
  extraActions = [],
}: {
  modules: readonly HomeModule<P>[];
  can: (permission: P) => boolean;
  extraActions?: readonly QuickAction[];
}) {
  const visible = modules.filter((module) => can(module.requires));
  return (
    <>
      {(visible.length > 0 || extraActions.length > 0) && (
        <nav className="px-quick" aria-label="Ações rápidas">
          {visible.map((module, index) => (
            <ModuleActions key={module.id} module={module} allowPrimary={index === 0} />
          ))}
          {extraActions.map((action) => (
            <QuickChip key={action.label} action={action} allowPrimary={false} />
          ))}
        </nav>
      )}
      {visible.length === 0 ? (
        <Panel title="Nada para mostrar ainda" flush>
          <EmptyState icon="layers" title="Nenhum módulo disponível para o seu papel">
            <p>Peça ao administrador da organização acesso aos módulos de que você precisa.</p>
          </EmptyState>
        </Panel>
      ) : (
        visible.map((module) => <HomeSection key={module.id} module={module} />)
      )}
    </>
  );
}
