# ADR-008 — Design System oficial do Hub (Premium v1.2) com a marca Calculadora Fiscal

**Status:** aceita para revisão humana · **Data:** 2026-11-17 · **Origem:** `Inovacao-Contar-Brasil/Hub_ContarBrasil` @ `10f40b2`, `docs/17-design-system-oficial.md`

## Contexto

A Calculadora é um futuro módulo do Hub, mas tinha uma folha própria (`styles.css`) com cores fixas, sem modo escuro, sem navegação no celular e componentes ad hoc. O Hub consolidou um Design System (`src/ds` + `src/theme`) com tokens semânticos, white-label por organização, temas claro/escuro, shell responsivo e acessibilidade verificada. Mesma stack (React 19 + Vite).

## Decisão

1. **Copiar** `ds/`, `theme/` e `styles/global.css` do Hub para `apps/web/src`, sem alterar o código dos componentes nem as folhas do kit. Proveniência e lista de adaptações em `apps/web/src/ds/ORIGEM.md`. O repositório do Hub não é modificado (CLAUDE.md, regra 6).
2. **Marca deste projeto** no lugar da Contar Brasil, preservando o sistema de tokens: `DEFAULT_BRANDING` = "Calculadora Fiscal", monograma `CF`, escala verde derivada das cores anteriores da Calculadora (#366847 ação). Sem logotipos (`PLATFORM_LOGOS = null`): monograma + nome. Status nunca vem da marca.
3. **Contrato de marca local** (`theme/branding.ts`, cópia de `@hub/contracts/branding`) em vez de depender do pacote do Hub.
4. **Composição como no Hub**: `App` → `ThemeProvider(hub-premium px-root)`; `AppLayout` monta `AppShell` + `Sidebar` + `Header` + `BottomNav` + `AccountMenu` + `CommandPalette`, com itens filtrados por papel e `AppLinkProvider` ligado ao roteador próprio. Telas usam só a API pública `ds/index`.
5. **O que não existe no DS fica no módulo**: `pages/pages.css` (prefixo `cf-`, só tokens) para importação de XML, totais da NF-e e tabelas fiscais rotuladas no celular; `pages/login.css` = trecho de login do Hub.
6. **Sem componentes paralelos**: o painel "Mais" do celular é composto com `Sheet` + `AppearanceSwitch` (o `MoreSheet` do Hub inclui "Trocar organização", inexistente aqui); nenhum componente do kit foi alterado.
7. **Fronteiras verificadas por teste** (`apps/web/test/design-system-boundaries.test.ts`) e contraste WCAG AA da marca nos dois modos (`design-system-tokens.test.ts`).

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Pacote npm compartilhado do DS | Não existe publicação do DS no Hub; criaria acoplamento de versão e de repositório antes da integração. Reavaliar quando o Hub publicar o pacote. |
| Reescrever o visual "inspirado" no Hub | Divergiria do aprovado e duplicaria o Design System. |
| Recortar `global.css` só no que as telas usam | `.brand-mark` (monograma) e a base de `.btn/.field/.badge/.alert/.tabs` vivem nela; recortar arriscaria diferença visual. As classes legadas não usadas ficam inertes. |
| Copiar galeria/protótipo do Hub para documentação viva | Trazem dados fictícios do Hub; a verificação foi feita nas telas reais com dados sintéticos. |

## Consequências

- Sincronizar com versões novas do Hub = recopiar os arquivos "sem alteração" e reaplicar a tabela de `ORIGEM.md`; o teste de fronteiras acusa desvios.
- Bundle do web (medido): JS 265 kB → 380 kB (80 → 114 kB gzip), principalmente zod (validação de marca) e o shell; CSS 10 kB → 62 kB (3 → 12 kB gzip). Fonte Inter auto-hospedada em woff2, carregada por subconjunto de caracteres (latin ≈ 73 kB).
- Aparência dos componentes do Hub ainda pendentes de aprovação lá (`Checkbox`, `Status`, `ErrorState`, `Dialog`, `Alert` na camada oficial — docs/17 §10) foi herdada como está.
