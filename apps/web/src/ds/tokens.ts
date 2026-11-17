/*
 * Índice dos tokens do Design System oficial. Os VALORES têm uma única fonte:
 *   - marca (--brand-primary-50…950): dado validado da organização (theme/brand.ts);
 *   - semânticos por modo (--color-*, --shadow-*): theme/theme.css (base) e
 *     theme/premium.css (camada oficial);
 *   - medidas (--px-*): ds/styles/base.css.
 * Este arquivo só nomeia e descreve os tokens, para a documentação viva
 * (/design-system/) e para os testes de paridade. Componentes usam os tokens
 * direto no CSS — nunca valores fixos.
 */

export interface TokenInfo {
  token: string;
  label: string;
}

export const SEMANTIC_TOKENS: readonly { group: string; tokens: readonly TokenInfo[] }[] = [
  {
    group: 'Superfícies',
    tokens: [
      { token: '--color-bg', label: 'Fundo da aplicação' },
      { token: '--color-chrome', label: 'Barra lateral e cabeçalho' },
      { token: '--color-surface', label: 'Cartões e painéis' },
      { token: '--color-surface-raised', label: 'Menus e superfícies elevadas' },
      { token: '--color-surface-muted', label: 'Superfície rebaixada' },
      { token: '--color-neutral-bg', label: 'Fundo neutro (etiquetas, avatar)' },
    ],
  },
  {
    group: 'Texto e bordas',
    tokens: [
      { token: '--color-text', label: 'Texto' },
      { token: '--color-text-muted', label: 'Texto discreto' },
      { token: '--color-text-subtle', label: 'Texto terciário' },
      { token: '--color-border', label: 'Borda decorativa' },
      { token: '--color-border-strong', label: 'Borda reforçada' },
      { token: '--color-border-control', label: 'Borda de campo (3:1)' },
    ],
  },
  {
    group: 'Ação (derivada da marca)',
    tokens: [
      { token: '--color-primary', label: 'Ação principal e links' },
      { token: '--color-primary-hover', label: 'Ação principal (hover)' },
      { token: '--color-primary-contrast', label: 'Texto sobre a ação principal' },
      { token: '--color-focus', label: 'Foco por teclado' },
      { token: '--color-selected-bg', label: 'Item selecionado' },
    ],
  },
  {
    group: 'Estados (nunca vêm da marca)',
    tokens: [
      { token: '--color-success', label: 'Sucesso' },
      { token: '--color-success-bg', label: 'Fundo de sucesso' },
      { token: '--color-warning', label: 'Atenção' },
      { token: '--color-warning-bg', label: 'Fundo de atenção' },
      { token: '--color-danger', label: 'Perigo' },
      { token: '--color-danger-bg', label: 'Fundo de perigo' },
      { token: '--color-info', label: 'Informação' },
      { token: '--color-info-bg', label: 'Fundo de informação' },
    ],
  },
];

export const MEASURE_TOKENS: readonly TokenInfo[] = [
  { token: '--px-sidebar', label: 'Largura da barra lateral' },
  { token: '--px-content-max', label: 'Largura máxima do conteúdo' },
  { token: '--px-gutter', label: 'Margem lateral do conteúdo' },
  { token: '--px-gap', label: 'Espaço entre painéis da grade' },
  { token: '--px-panel-x', label: 'Margem interna horizontal do painel' },
  { token: '--px-panel-y', label: 'Margem interna vertical do painel' },
  { token: '--px-panel-radius', label: 'Raio do painel' },
];
