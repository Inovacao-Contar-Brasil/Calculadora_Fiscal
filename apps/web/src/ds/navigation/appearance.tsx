/*
 * Aparência (claro, escuro, automático): preferência pessoal deste dispositivo,
 * lida de `useColorMode`. Nunca é dado da organização.
 */
import { useColorMode, type ColorModePreference } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../core/icons';
import { MenuButton, MenuItem, MenuLabel } from './menu';

export const COLOR_MODE_OPTIONS: readonly {
  value: ColorModePreference;
  label: string;
  icon: IconName;
}[] = [
  { value: 'light', label: 'Claro', icon: 'sun' },
  { value: 'dark', label: 'Escuro', icon: 'moon' },
  { value: 'system', label: 'Automático', icon: 'monitor' },
];

/** Itens "Aparência" para compor dentro de um `MenuButton`. */
export function AppearanceMenuItems({ close }: { close: () => void }) {
  const { preference, setPreference } = useColorMode();
  return (
    <>
      <MenuLabel>Aparência</MenuLabel>
      {COLOR_MODE_OPTIONS.map((option) => (
        <MenuItem
          key={option.value}
          icon={option.icon}
          checked={preference === option.value}
          onSelect={() => {
            setPreference(option.value);
            close();
          }}
        >
          {option.label}
        </MenuItem>
      ))}
    </>
  );
}

/** Botão de ícone com o menu de aparência (cabeçalho). */
export function AppearanceMenu() {
  const { mode } = useColorMode();
  return (
    <MenuButton
      label="Aparência"
      align="end"
      buttonClassName="px-icon-btn"
      button={<Icon name={mode === 'dark' ? 'moon' : 'sun'} size={18} />}
    >
      {(close) => <AppearanceMenuItems close={close} />}
    </MenuButton>
  );
}

/** Alterna direto entre claro e escuro (telas sem cabeçalho, como o login). */
export function AppearanceToggle({ className = '' }: { className?: string }) {
  const { mode, setPreference } = useColorMode();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`px-icon-btn ${className}`.trim()}
      aria-label={next === 'dark' ? 'Usar aparência escura' : 'Usar aparência clara'}
      onClick={() => setPreference(next)}
    >
      <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

/** Escolha de aparência com rádios nativos (painel "Mais" do celular). */
export function AppearanceSwitch() {
  const { preference, setPreference } = useColorMode();
  return (
    <fieldset className="px-mode-switch">
      <legend>Aparência</legend>
      {COLOR_MODE_OPTIONS.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="px-mode"
            value={option.value}
            checked={preference === option.value}
            onChange={() => setPreference(option.value)}
          />
          <Icon name={option.icon} size={16} />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
