/*
 * Design System oficial do Hub — API pública.
 *
 * Único ponto de importação para a Fundação e para os módulos:
 *   import { AppShell, Page, Panel, Button } from '../ds';
 * e, uma vez na entrada da aplicação, `import '../ds/styles'`.
 *
 * Regras (verificadas por teste — docs/17):
 *  - nada aqui conhece API, roteador, autenticação, módulos ou dados;
 *  - cores só por tokens (--color-*), nunca fixas: o white-label vem do tema;
 *  - componentes não importam folhas de estilo (a ordem fica em ./styles).
 */

/* Tema white-label: modo de cor (pessoa) + marca (organização) */
export {
  BrandProvider,
  ColorModeProvider,
  ThemeProvider,
  useBrandIdentity,
  useBranding,
  useColorMode,
  useMediaQuery,
  isColorModePreference,
  COLOR_MODE_PREFERENCES,
  type ColorMode,
  type ColorModePreference,
} from '../theme/ThemeProvider';
export { BrandLogo, OrganizationMark, type BrandLogoVariant } from '../theme/components';

/* Base */
export { Icon, type IconName } from './core/icons';
export { AppLink, AppLinkProvider, type AppLinkProps, type AppNavigate } from './core/link';
export { useModalDialog } from './core/useModalDialog';
export {
  addDays,
  daysBetween,
  formatLongDate,
  formatShortDate,
  greeting,
  initials,
  normalizeSearch,
  relativeTime,
} from './core/format';

/* Layout */
export { AppShell, DesignSystemRoot, MAIN_CONTENT_ID, SkipLink } from './layout/AppShell';
export {
  Page,
  PageHeader,
  Panel,
  PanelGrid,
  PanelLevelContext,
  PanelStack,
  type PanelSpan,
} from './layout/page';
export {
  HomeModules,
  type HomeModule,
  type HomeModuleHeader,
  type QuickAction,
} from './layout/home';

/* Navegação */
export { Sidebar, UpcomingList, type NavItem, type UpcomingGroup } from './navigation/Sidebar';
export { Header } from './navigation/Header';
export { BottomNav } from './navigation/BottomNav';
export {
  AccountMenu,
  MoreSheet,
  OrgAvatar,
  OrgSwitcher,
  type AccountUser,
  type OrgOption,
} from './navigation/account';
export {
  AppearanceMenu,
  AppearanceMenuItems,
  AppearanceSwitch,
  AppearanceToggle,
  COLOR_MODE_OPTIONS,
} from './navigation/appearance';
export { MenuButton, MenuItem, MenuLabel, MenuSeparator } from './navigation/menu';
export { Breadcrumbs } from './navigation/breadcrumbs';
export { Tabs, type TabItem } from './navigation/tabs';
export { CommandPalette, type PaletteItem } from './navigation/CommandPalette';

/* Formulários */
export { Button, Field, Input, Select, Textarea, type ButtonVariant } from './forms/controls';
export { SegmentedControl } from './forms/segmented';
export { Checkbox, Switch } from './forms/toggles';

/* Feedback */
export { Alert, type AlertTone } from './feedback/alert';
export { Dialog, Sheet } from './feedback/dialog';
export { Toast } from './feedback/toast';
export { Loading } from './feedback/loading';
export { EmptyState, ErrorState, PageSkeleton } from './feedback/states';

/* Dados */
export { Badge, type Tone } from './data/badge';
export { Avatar, CountTag, Person } from './data/people';
export { Pagination, Status, Table, type StatusTone } from './data/table';

/* Tokens (índice para documentação e testes; os valores vivem no CSS) */
export { MEASURE_TOKENS, SEMANTIC_TOKENS, type TokenInfo } from './tokens';
