import {
  BRAND_SCALE_STEPS,
  organizationBrandingSchema,
  type OrganizationBranding,
} from './branding';

/** Monta uma escala a partir de 11 valores, do tom 50 ao 950. */
export function brandScale(values: readonly string[]): OrganizationBranding['primary'] {
  return Object.fromEntries(
    BRAND_SCALE_STEPS.map((step, i) => [String(step), values[i] ?? '']),
  ) as OrganizationBranding['primary'];
}

/**
 * Identidade padrão da plataforma: Calculadora Fiscal (adaptado do Hub, que usa a
 * Contar Brasil). Escala verde derivada das cores da Calculadora antes do Design
 * System (#366847 ação, #244e34 destaque): 600 é a ação no modo claro, 700 o
 * hover, 400 a ação no escuro e 300 o foco no escuro. Contraste WCAG AA
 * verificado em apps/web/test/design-system-tokens.test.ts.
 * Verde é cor de MARCA (ação, link, foco); sucesso continua vindo dos tokens de
 * status, nunca da marca.
 */
export const DEFAULT_BRANDING: OrganizationBranding = {
  schemaVersion: 1,
  displayName: 'Calculadora Fiscal',
  monogram: 'CF',
  primary: brandScale([
    '#eef6f0',
    '#d8eadc',
    '#b3d6bc',
    '#86bd96',
    '#5ea272',
    '#448657',
    '#366847',
    '#244e34',
    '#1c3d29',
    '#142c1e',
    '#0b1a11',
  ]),
};

/**
 * Identidade neutra para marca recebida porém inválida: cores da plataforma,
 * sem o nome do produto. Nunca usa a marca de outra organização.
 */
export const FALLBACK_BRANDING: OrganizationBranding = {
  ...DEFAULT_BRANDING,
  displayName: 'Calculadora',
  monogram: 'C',
};

export interface BrandLogoAsset {
  src: string;
  width: number;
  height: number;
}

export interface PlatformLogos {
  /** Texto alternativo único para todas as versões. */
  alt: string;
  horizontal: BrandLogoAsset;
  vertical: BrandLogoAsset;
  symbol: BrandLogoAsset;
}

/**
 * A Calculadora ainda não tem logotipo oficial: a identidade da plataforma é o
 * monograma + nome (mesmo caminho visual de uma organização sem logotipo no Hub).
 * Os arquivos da Contar Brasil NÃO foram copiados. Quando houver logotipo
 * aprovado, coloque os arquivos em apps/web/public/branding/ e preencha aqui.
 */
export const PLATFORM_LOGOS: PlatformLogos | null = null;

/**
 * Origem da identidade exibida:
 *  - `platform`: a organização não definiu marca → Calculadora Fiscal (logotipos, se houver);
 *  - `organization`: marca própria válida → cores e monograma dela, SEM logotipo da plataforma;
 *  - `fallback`: marca própria inválida → cores da plataforma e identidade neutra, sem logotipo.
 */
export type BrandSource = 'platform' | 'organization' | 'fallback';

export interface BrandIdentity {
  source: BrandSource;
  branding: OrganizationBranding;
  /** Somente na identidade da plataforma. */
  logos: PlatformLogos | null;
}

const PLATFORM_IDENTITY: BrandIdentity = {
  source: 'platform',
  branding: DEFAULT_BRANDING,
  logos: PLATFORM_LOGOS,
};
const FALLBACK_IDENTITY: BrandIdentity = {
  source: 'fallback',
  branding: FALLBACK_BRANDING,
  logos: null,
};

/**
 * Valida dados de marca não confiáveis (futuro: vindos da API da organização).
 * Ausência de marca → identidade da plataforma. Qualquer erro → identidade
 * neutra com as cores da plataforma — nunca a marca de outra organização.
 */
export function resolveBrandIdentity(input: unknown): BrandIdentity {
  if (input === undefined || input === null) return PLATFORM_IDENTITY;
  const parsed = organizationBrandingSchema.safeParse(input);
  return parsed.success
    ? { source: 'organization', branding: parsed.data, logos: null }
    : FALLBACK_IDENTITY;
}

/** Somente a paleta: dado inválido ou ausente devolve a paleta padrão. */
export function resolveBranding(input: unknown): OrganizationBranding {
  const parsed = organizationBrandingSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_BRANDING;
}

/** Única ponte entre a marca e o CSS: nomes fixos e valores já validados. */
export function brandStyle(branding: OrganizationBranding): Record<string, string> {
  const style: Record<string, string> = {};
  for (const step of BRAND_SCALE_STEPS) style[`--brand-primary-${step}`] = branding.primary[step];
  return style;
}
