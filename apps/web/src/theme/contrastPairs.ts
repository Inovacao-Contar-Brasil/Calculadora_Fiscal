import { WCAG_AA } from './branding';

/**
 * Pares de tokens que precisam atender WCAG AA em toda marca e modo.
 * Verificados estaticamente em test/design-system-tokens.test.ts e ao vivo na galeria.
 */
export interface ContrastPair {
  label: string;
  foreground: string;
  background: string;
  min: number;
  /** Modos em que o par se aplica; ausente = claro e escuro. */
  modes?: readonly ('light' | 'dark')[];
}

const text = (label: string, foreground: string, background: string): ContrastPair => ({
  label,
  foreground,
  background,
  min: WCAG_AA.text,
});
const ui = (label: string, foreground: string, background: string): ContrastPair => ({
  label,
  foreground,
  background,
  min: WCAG_AA.ui,
});

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  text('Texto sobre fundo', '--color-text', '--color-bg'),
  text('Texto sobre superfície', '--color-text', '--color-surface'),
  text('Texto discreto sobre superfície', '--color-text-muted', '--color-surface'),
  text('Texto discreto sobre fundo', '--color-text-muted', '--color-bg'),
  text('Texto discreto sobre superfície rebaixada', '--color-text-muted', '--color-surface-muted'),
  text('Texto em botão primário', '--color-primary-contrast', '--color-primary'),
  text('Texto em botão primário (hover)', '--color-primary-contrast', '--color-primary-hover'),
  text('Link sobre superfície', '--color-primary', '--color-surface'),
  text('Link sobre fundo', '--color-primary', '--color-bg'),
  text('Link sobre superfície rebaixada', '--color-primary', '--color-surface-muted'),
  text('Item selecionado', '--color-selected-text', '--color-selected-bg'),
  ui('Foco sobre superfície', '--color-focus', '--color-surface'),
  ui('Foco sobre fundo', '--color-focus', '--color-bg'),
  ui('Borda de campo sobre superfície', '--color-border-control', '--color-surface'),
  ui('Borda de campo sobre fundo', '--color-border-control', '--color-bg'),
  ui('Botão perigo: borda', '--color-danger', '--color-surface'),
  text('Perigo', '--color-danger', '--color-danger-bg'),
  text('Atenção', '--color-warning', '--color-warning-bg'),
  text('Sucesso', '--color-success', '--color-success-bg'),
  text('Informação', '--color-info', '--color-info-bg'),
  text('Neutro', '--color-text', '--color-neutral-bg'),
];

/**
 * Pares adicionais da camada oficial (theme/premium.css): texto terciário,
 * superfície elevada (menus) e a placa clara do logotipo no modo escuro.
 * Verificados em test/premium-prototype.test.tsx junto com CONTRAST_PAIRS.
 */
export const DS_CONTRAST_PAIRS: readonly ContrastPair[] = [
  text('Texto terciário sobre superfície', '--color-text-subtle', '--color-surface'),
  text('Texto terciário sobre fundo', '--color-text-subtle', '--color-bg'),
  text(
    'Texto terciário sobre superfície rebaixada',
    '--color-text-subtle',
    '--color-surface-muted',
  ),
  text('Texto terciário sobre superfície elevada', '--color-text-subtle', '--color-surface-raised'),
  text('Texto sobre superfície elevada', '--color-text', '--color-surface-raised'),
  text('Texto discreto sobre neutro', '--color-text-muted', '--color-neutral-bg'),
  ui('Borda de campo sobre superfície elevada', '--color-border-control', '--color-surface-raised'),
  {
    ...text(
      'Logotipo azul-marinho sobre a superfície do logotipo (escuro)',
      '--brand-primary-700',
      '--color-brand-plate',
    ),
    // No claro a placa é transparente: o logotipo fica direto sobre o fundo.
    modes: ['dark'],
  },
];
