/*
 * Organização ativa e conta da pessoa, para a barra lateral, o cabeçalho e o
 * painel "Mais". Apresentação pura: nomes, opções e ações chegam por
 * propriedade; o monograma vem da marca white-label do tema.
 */
import { useId, type ReactNode } from 'react';
import { useBrandIdentity } from '../../theme/ThemeProvider';
import { Icon } from '../core/icons';
import { Avatar } from '../data/people';
import { Sheet } from '../feedback/dialog';
import { AppearanceMenuItems, AppearanceSwitch } from './appearance';
import { MenuButton, MenuItem, MenuLabel, MenuSeparator } from './menu';
import { UpcomingList, type UpcomingGroup } from './Sidebar';

/** Monograma da organização ativa, na cor primária da marca. */
export function OrgAvatar({ size = 26 }: { size?: number }) {
  const { branding } = useBrandIdentity();
  return (
    <span className="px-org-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {branding.monogram}
    </span>
  );
}

export interface OrgOption {
  id: string;
  name: string;
  /** Linha de apoio (ex.: papel da pessoa nessa organização). */
  hint?: ReactNode;
}

/** Seletor da organização ativa. `compact` é a versão do cabeçalho no celular. */
export function OrgSwitcher({
  activeId,
  name,
  detail,
  options,
  onSelect,
  onShowAll,
  compact = false,
}: {
  activeId: string;
  name: string;
  /** Texto abaixo do nome (ex.: papel). Não aparece na versão compacta. */
  detail?: ReactNode;
  options: readonly OrgOption[];
  onSelect: (id: string) => void;
  /** Leva à lista completa de organizações; sem isso o item não aparece. */
  onShowAll?: () => void;
  compact?: boolean;
}) {
  return (
    <MenuButton
      label={`Organização ativa: ${name}. Trocar organização`}
      buttonClassName={compact ? 'px-org-switch px-org-switch-compact' : 'px-org-switch'}
      menuClassName="px-menu-wide"
      button={
        <>
          <OrgAvatar size={compact ? 24 : 28} />
          <span className="px-org-switch-text">
            <strong>{name}</strong>
            {!compact && detail && <small>{detail}</small>}
          </span>
          <Icon name={compact ? 'chevronDown' : 'chevronUpDown'} size={16} />
        </>
      }
    >
      {(close) => (
        <>
          <MenuLabel>Suas organizações</MenuLabel>
          {options.map((option) => (
            <MenuItem
              key={option.id}
              checked={option.id === activeId}
              hint={option.hint}
              onSelect={() => {
                close();
                onSelect(option.id);
              }}
            >
              {option.name}
            </MenuItem>
          ))}
          {onShowAll && (
            <>
              <MenuSeparator />
              <MenuItem
                icon="building"
                onSelect={() => {
                  close();
                  onShowAll();
                }}
              >
                Todas as organizações
              </MenuItem>
            </>
          )}
        </>
      )}
    </MenuButton>
  );
}

export interface AccountUser {
  name: string;
  email: string;
}

/** Conta da pessoa no rodapé da barra lateral: aparência e sair. */
export function AccountMenu({ user, onSignOut }: { user: AccountUser; onSignOut: () => void }) {
  return (
    <MenuButton
      label={`Conta de ${user.name}`}
      placement="top"
      buttonClassName="px-account"
      menuClassName="px-menu-wide"
      button={
        <>
          <Avatar name={user.name} size={30} tone="brand" />
          <span className="px-account-text">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <Icon name="chevronUpDown" size={16} />
        </>
      }
    >
      {(close) => (
        <>
          <AppearanceMenuItems close={close} />
          <MenuSeparator />
          <MenuItem
            icon="logout"
            onSelect={() => {
              close();
              onSignOut();
            }}
          >
            Sair
          </MenuItem>
        </>
      )}
    </MenuButton>
  );
}

/** Painel "Mais" do celular: conta, aparência, grupo "em breve" e ações da conta. */
export function MoreSheet({
  user,
  organizationName,
  upcoming,
  onSwitchOrganization,
  onSignOut,
  onClose,
}: {
  user: AccountUser;
  organizationName: string;
  upcoming?: UpcomingGroup;
  onSwitchOrganization: () => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const upcomingId = useId();
  return (
    <Sheet label="Mais opções" onClose={onClose}>
      <div className="px-sheet-head">
        <Avatar name={user.name} size={36} tone="brand" />
        <div className="px-account-text">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </div>
        <button type="button" className="px-icon-btn" aria-label="Fechar" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <AppearanceSwitch />
      {upcoming && (
        <div className="px-sheet-section">
          <h2 className="px-sheet-title" id={`${upcomingId}-t`}>
            {upcoming.label} {upcoming.badge && <span className="px-soon">{upcoming.badge}</span>}
          </h2>
          <UpcomingList group={upcoming} id={upcomingId} />
        </div>
      )}
      <div className="px-sheet-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            onClose();
            onSwitchOrganization();
          }}
        >
          <Icon name="swap" size={16} />
          Trocar organização
          <span className="sr-only">(atual: {organizationName})</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            onClose();
            onSignOut();
          }}
        >
          <Icon name="logout" size={16} />
          Sair
        </button>
      </div>
    </Sheet>
  );
}
