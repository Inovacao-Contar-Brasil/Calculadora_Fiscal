/*
 * Tema = duas entradas independentes:
 *  - modo de cor: preferência da pessoa neste dispositivo (claro, escuro, sistema);
 *  - marca: identidade da organização (dado validado; futuramente vindo da API).
 * Contextos separados: um nunca sobrescreve o outro.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { OrganizationBranding } from './branding';
import { brandStyle, resolveBrandIdentity, type BrandIdentity } from './brand';

export type ColorModePreference = 'light' | 'dark' | 'system';
export type ColorMode = 'light' | 'dark';
export const COLOR_MODE_PREFERENCES: readonly ColorModePreference[] = ['light', 'dark', 'system'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isColorModePreference(value: unknown): value is ColorModePreference {
  return COLOR_MODE_PREFERENCES.includes(value as ColorModePreference);
}

/** Assina uma media query; seguro em ambientes sem matchMedia. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

interface ColorModeValue {
  preference: ColorModePreference;
  /** O que é pintado: `system` resolvido pelo sistema operacional. */
  mode: ColorMode;
  setPreference: (preference: ColorModePreference) => void;
}
const ColorModeContext = createContext<ColorModeValue | null>(null);
const BrandContext = createContext<BrandIdentity | null>(null);

// O armazenamento pode estar bloqueado (modo privado, políticas); o tema continua funcionando.
function readStored(key: string | null): ColorModePreference | null {
  if (!key) return null;
  try {
    const value = window.localStorage.getItem(key);
    return isColorModePreference(value) ? value : null;
  } catch {
    return null;
  }
}
function writeStored(key: string | null, value: ColorModePreference) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* preferência fica apenas em memória */
  }
}

export function ColorModeProvider({
  children,
  initialPreference,
  storageKey = 'hub.color-mode',
}: {
  children: ReactNode;
  /** Prevalece sobre o valor salvo (ex.: link com `?mode=`). */
  initialPreference?: ColorModePreference;
  /** null desativa a persistência. Nunca inclui a organização: é preferência pessoal. */
  storageKey?: string | null;
}) {
  const [preference, setState] = useState<ColorModePreference>(
    () => initialPreference ?? readStored(storageKey) ?? 'system',
  );
  const systemDark = useMediaQuery(DARK_QUERY);
  const setPreference = useCallback(
    (next: ColorModePreference) => {
      setState(next);
      writeStored(storageKey, next);
    },
    [storageKey],
  );
  const mode: ColorMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  const value = useMemo(
    () => ({ preference, mode, setPreference }),
    [preference, mode, setPreference],
  );
  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

/**
 * A marca é sempre revalidada. Sem marca → identidade da plataforma (Calculadora
 * Fiscal, com logotipos se houver); marca própria → nunca recebe os logotipos da plataforma;
 * dado inválido → identidade neutra com as cores padrão.
 */
export function BrandProvider({ branding, children }: { branding?: unknown; children: ReactNode }) {
  const identity = useMemo(() => resolveBrandIdentity(branding), [branding]);
  return <BrandContext.Provider value={identity}>{children}</BrandContext.Provider>;
}

export function useColorMode(): ColorModeValue {
  const value = useContext(ColorModeContext);
  if (!value) throw new Error('useColorMode deve ser usado dentro de ColorModeProvider');
  return value;
}
export function useBrandIdentity(): BrandIdentity {
  const value = useContext(BrandContext);
  if (!value) throw new Error('useBranding deve ser usado dentro de BrandProvider');
  return value;
}
export function useBranding(): OrganizationBranding {
  return useBrandIdentity().branding;
}

/**
 * Elemento que carrega o tema: `data-theme` escolhe a camada semântica em
 * theme.css; o estilo inline leva somente as variáveis `--brand-primary-*`.
 * Diálogos nativos abertos dentro dele herdam o tema.
 */
export function ThemeRoot({
  children,
  className = '',
  organizationId,
}: {
  children: ReactNode;
  className?: string;
  /** Identifica o escopo para testes e depuração (não é dado sensível). */
  organizationId?: string;
}) {
  const { mode, preference } = useColorMode();
  const { branding, source } = useBrandIdentity();
  const style = useMemo(() => brandStyle(branding) as CSSProperties, [branding]);
  return (
    <div
      className={`hub-theme ${className}`.trim()}
      data-theme={mode}
      data-color-preference={preference}
      data-organization={organizationId}
      data-brand-source={source}
      style={style}
    >
      {children}
    </div>
  );
}

/** Atalho: modo de cor + marca + elemento raiz. */
export function ThemeProvider({
  branding,
  children,
  className,
  organizationId,
  initialPreference,
  storageKey,
}: {
  branding?: unknown;
  children: ReactNode;
  className?: string;
  organizationId?: string;
  initialPreference?: ColorModePreference;
  storageKey?: string | null;
}) {
  return (
    <ColorModeProvider initialPreference={initialPreference} storageKey={storageKey}>
      <BrandProvider branding={branding}>
        <ThemeRoot className={className} organizationId={organizationId}>
          {children}
        </ThemeRoot>
      </BrandProvider>
    </ColorModeProvider>
  );
}
