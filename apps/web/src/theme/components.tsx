/*
 * Identidade visual white-label: logotipo oficial da plataforma ou monograma da
 * organização. Os demais componentes vivem no Design System oficial (`src/ds`).
 */
import { useBrandIdentity, useBranding } from './ThemeProvider';
import './components.css';

/** Marca da organização: monograma com a cor primária (organizações sem logotipo). */
export function OrganizationMark() {
  const { monogram } = useBranding();
  return (
    <span className="brand-mark" aria-hidden="true">
      {monogram}
    </span>
  );
}

export type BrandLogoVariant = 'horizontal' | 'vertical' | 'symbol';

/**
 * Identidade visual da organização ativa.
 *  - Identidade da plataforma com logotipo (hoje nenhum: ver PLATFORM_LOGOS), sem filtros
 *    nem recriação. Versões com escrita ficam sobre `--color-brand-plate`
 *    (clara no modo escuro).
 *  - Marca própria (ou inválida): monograma + nome. Nunca o logotipo da plataforma.
 * `decorative` zera o texto alternativo quando o nome já aparece ao lado.
 */
export function BrandLogo({
  variant = 'horizontal',
  decorative = false,
  className = '',
}: {
  variant?: BrandLogoVariant;
  decorative?: boolean;
  className?: string;
}) {
  const { logos, branding, source } = useBrandIdentity();
  if (logos) {
    const asset = logos[variant];
    const plated = variant !== 'symbol';
    return (
      <span
        className={`brand-logo brand-logo-${variant} ${plated ? 'brand-logo-plate' : ''} ${className}`.trim()}
        data-brand-source={source}
      >
        <img
          src={asset.src}
          width={asset.width}
          height={asset.height}
          alt={decorative ? '' : logos.alt}
          decoding="async"
          draggable={false}
        />
      </span>
    );
  }
  return (
    <span
      className={`brand-logo brand-logo-${variant} brand-logo-mark ${className}`.trim()}
      data-brand-source={source}
    >
      <OrganizationMark />
      {variant === 'symbol' ? (
        !decorative && <span className="sr-only">{branding.displayName}</span>
      ) : (
        <span className="brand-logo-name" aria-hidden={decorative || undefined}>
          {branding.displayName}
        </span>
      )}
    </span>
  );
}
