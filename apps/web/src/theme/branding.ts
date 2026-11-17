import { z } from 'zod';

/*
 * Identidade visual de uma organização (white-label). É DADO, nunca CSS:
 * somente estas chaves existem e as cores são hexadecimais validados.
 * Sem logotipo enviado, domínio próprio ou CSS arbitrário nesta versão.
 * Ver docs/adr/003-design-system-white-label.md.
 */

export const BRAND_SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type BrandScaleStep = (typeof BRAND_SCALE_STEPS)[number];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const hexColor = z
  .string()
  .regex(HEX_COLOR, { message: 'Use uma cor hexadecimal no formato #rrggbb.' })
  .transform((value) => value.toLowerCase());

/** Escala de 11 tons, do mais claro (50) ao mais escuro (950). */
export const brandScaleSchema = z
  .object(
    Object.fromEntries(BRAND_SCALE_STEPS.map((step) => [String(step), hexColor])) as Record<
      `${BrandScaleStep}`,
      typeof hexColor
    >,
  )
  .strict();
export type BrandScale = z.infer<typeof brandScaleSchema>;

export const organizationBrandingSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Nome curto exibido na navegação. */
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[^<>{};]+$/, { message: 'O nome não pode conter < > { } ;' }),
    /** 1 a 3 letras ou dígitos desenhados como marca (substitui logotipo nesta versão). */
    monogram: z
      .string()
      .trim()
      .regex(/^[\p{L}\p{N}]{1,3}$/u, { message: 'Use de 1 a 3 letras ou números.' }),
    /** Cor de ação, links, foco e seleção. Status (sucesso, erro…) nunca vêm da marca. */
    primary: brandScaleSchema,
  })
  .strict();
export type OrganizationBranding = z.infer<typeof organizationBrandingSchema>;

// ---------- Contraste WCAG 2.x (regras puras, reutilizáveis na API) ----------

export const WCAG_AA = { text: 4.5, ui: 3 } as const;

export function parseHexColor(value: string): [number, number, number] | null {
  const text = value.trim();
  if (!HEX_COLOR.test(text)) return null;
  return [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Razão de contraste entre duas cores opacas (RGB 0–255). */
export function contrastRatioRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Razão de contraste entre duas cores `#rrggbb`, ou null se alguma for inválida. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  return ca && cb ? contrastRatioRgb(ca, cb) : null;
}
