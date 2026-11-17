# Origem do Design System

Cópia do **Design System oficial do Hub Contar Brasil (Premium v1.2)**, sem alterar o repositório de origem.

- **Origem:** `Inovacao-Contar-Brasil/Hub_ContarBrasil`, commit `10f40b2` (17/11/2026), pastas `apps/web/src/ds`, `apps/web/src/theme`, `apps/web/src/styles/global.css` e `packages/contracts/src/branding.ts`.
- **Documentação de referência:** `docs/17-design-system-oficial.md` do Hub (arquitetura, contratos e fronteiras). Decisão local: `docs/adr/ADR-008-design-system-hub.md`.

## Copiado sem alteração

- `apps/web/src/ds/**` (componentes, `index.ts`, `styles.ts`, `tokens.ts`, folhas `styles/*.css`).
- `apps/web/src/theme/{theme.css,premium.css,components.css}`.
- `apps/web/src/styles/global.css` (base canônica exigida por `ds/styles.ts`; inclui classes legadas v1.1 que as telas da Calculadora não usam — `.brand-mark`, usada pelo monograma, só existe nela).

## Adaptado

| Arquivo | Mudança | Por quê |
|---|---|---|
| `theme/branding.ts` | cópia de `@hub/contracts/branding` (schema zod + contraste WCAG) | a Calculadora não depende do pacote de contratos do Hub |
| `theme/brand.ts` | identidade **Calculadora Fiscal** (`CF`, escala verde); `PLATFORM_LOGOS = null` | marca deste projeto; logotipos da Contar Brasil não foram copiados |
| `theme/ThemeProvider.tsx`, `theme/contrastPairs.ts` | import de `./branding`; comentários | idem |
| `theme/components.tsx` | comentário | idem |

## Não copiado (de propósito)

- `design-system/` (galeria, protótipo Premium, dashboard v1.0) — usa dados fictícios do Hub.
- `ui/` e `styles/operational.css` — fachada e estilos legados do Hub.
- Logotipos em `public/branding/contarbrasil`, autenticação, APIs, módulos e dados do Hub.

## Ao sincronizar com uma versão nova do Hub

1. Copie de novo os arquivos "sem alteração" e reaplique só as adaptações da tabela.
2. Rode `npm run verify` (inclui `apps/web/test/design-system-*.test.ts`).
3. Atualize o commit de origem acima.
