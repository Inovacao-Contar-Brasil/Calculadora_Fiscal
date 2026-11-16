# HANDOFF — continuidade entre sessões

> Leia junto com `CLAUDE.md`. Atualize este arquivo após cada marco e antes de encerrar a sessão. Não dependa do histórico de nenhuma conversa: tudo o que importa está aqui, nos commits e nas Issues.

## Situação em 16/11/2026

- **Sprint 1 (Issue #2):** fundação implementada. **Gate de qualidade (Issue #5): CI verde no PostgreSQL real**, vulnerabilidades tratadas, PGlite corrigido, revisão de segurança feita. Falta só o que depende de pessoas (ver "Pendências").
- **Sprint 2A (Issue #6):** especificação pronta em `docs/SPRINT2A_ESPECIFICACAO.md` + `docs/adr/ADR-007` (proposta). **Nenhum código da 2A foi escrito** — aguarda revisão de Henrique/Iza/Edson.
- **PR:** [Inovacao-Contar-Brasil/Calculadora_Fiscal#7](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/7) — **draft**, base `main`, sem merge. Contém também os commits do PR #1 (sobreposição a resolver na revisão).

## Branch e commits

- **Branch:** `feat/sprint1-fundacao-segura` (é a branch do PR #7). Push normal, sem force.
- Base: `main` = `82b7497` (README). PR #1 = `d3bb210`, `1f62c4f`. Sprint 1 original = `9f54287`, `bc61554`, `71cceec`, `b63b94e`.
- **Estabilização (16/11/2026), em ordem:**

| Commit | O quê |
|---|---|
| `aedf40d` | fix(test): banco PostgreSQL exclusivo por suíte; limpeza garantida no harness |
| `cf6e413` | fix(db): diretório do PGlite criado recursivamente no primeiro uso |
| `a82c74e` | fix(deps): drizzle-orm 0.45.4, @fastify/static 10.1.11, vitest 4.1.12 |
| `a7d781f` | fix(auth): sessões/auditoria atômicas, troca de senha endurecida, CSRF sem Origin |
| `5c52b51` | fix(review): regra única de classificação, vigência na propagação, concorrência, integridade do XML, sem oráculo de existência |
| `b16da2d` | ci(docs): gate de `npm audit` de produção, `npm ci`, `drizzle-kit check`; SEGURANCA/README |
| `7fd26bd` | docs(sprint2a): especificação + ADR-007 |
| (este) | docs: HANDOFF e CLAUDE.md |

## CI (GitHub Actions, PostgreSQL 16 real + PGlite)

| SHA | Push | Pull request | Resultado |
|---|---|---|---|
| `b63b94e` (antes) | [43461045963](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/43461045963) | 43483068628 | **falha** (schemas) |
| `aedf40d` | [43862538374](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/43862538374) | 43862546367 | verde |
| `cf6e413` | 43862710179 | 43862718579 | verde |
| `a82c74e` | 43863511714 | 43863521274 | verde |
| `5c52b51` | 43864502473 | 43864510368 | verde |
| `b16da2d` | [43864657021](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/43864657021) | 43864665712 | verde (com audit + db:check) |

Critério "duas execuções consecutivas verdes após a correção" (Issue #5): cumprido — 10 execuções verdes seguidas em 5 SHAs. Os commits só de documentação depois de `b16da2d` têm CI próprio: confira a aba Actions.

Passos do CI: `npm ci` → `npm audit --omit=dev --audit-level=high` → `npm run db:check` → typecheck → testes PGlite → testes PostgreSQL (`TEST_DATABASE_URL`) → build.

## Verificação local (Linux, Node 22.23, npm 10.9, PostgreSQL 16 local)

- `npm run verify`: typecheck nos 3 workspaces, **69 testes** (68 + 1 que só roda no PostgreSQL) em 13 arquivos, build API + web — verde.
- `TEST_DATABASE_URL=... npm test -- --project api`: **56/56**, 5 execuções seguidas, nenhum banco `cf_test_*` remanescente.
- Seed em `apps/api/.data` inexistente: cria; segunda execução não duplica.
- **Não executado nesta sessão:** `npm.cmd run verify` no Windows (fazer na próxima máquina Windows) e teste E2E em navegador.

## O que foi corrigido e por quê

1. **CI PostgreSQL (causa raiz):** no Vitest 3.2/4, `fileParallelism` é opção global e é **ignorada dentro de `projects`**. Os arquivos da API rodavam em paralelo e cada um fazia `DROP SCHEMA public CASCADE` no mesmo banco. Agora `TEST_DATABASE_URL` é só conexão administrativa e cada harness cria/remove um banco exclusivo `cf_test_<pid>_<ts>_<rand>` (nome validado por regex; `DROP DATABASE ... WITH (FORCE)` só nele). Setup com falha libera tudo. `harness.test.ts` cobre corrida, idempotência de migração, limpeza em falha e preservação do banco admin.
2. **PGlite ENOENT:** PGlite faz mkdir não recursivo; `ensurePgliteDataDir` cria a árvore (no-op se existe; ignora `memory://`/`idb://`).
3. **Vulnerabilidades:** 11 → produção **0**, dev **4 moderate** (uma causa: esbuild 0.18 dentro do drizzle-kit, só afeta `esbuild serve`, nunca usado — risco aceito). Tabela completa em `docs/SEGURANCA.md`.
4. **Revisão (Issue #5 item 6):** `EM_ANALISE` não era propagado aos itens já importados (status contraditórios no mesmo produto) e `HOMOLOGADO` ignorava a vigência ao propagar. Agora uma regra única `classificationFor` serve importação e propagação. **Semântica documentada:** `review_items.status` é o fluxo da decisão; `nfe_items.classification_status` é a classificação aplicável **àquela nota na data de emissão** — podem diferir só quando a nota está fora da vigência de uma homologação (fica `PENDENTE_REVISAO`).
5. **Concorrência:** decisões e reaberturas simultâneas → uma vence, a outra 409 (antes: ambas gravadas, ou 500 no PostgreSQL).
6. **Autorização:** cliente sem acesso à empresa recebia 403 numa decisão (revelava o item) → 404; inexistente e fora do escopo agora têm resposta idêntica (antes a mensagem diferia).
7. **Integridade:** download do XML confere o SHA-256 e recusa divergência (409, auditado).
8. **Sessões:** login/logout/troca de senha atômicos com auditoria; troca de senha revoga todas as sessões e tem rate limit; CSRF recusa `Sec-Fetch-Site: cross-site` sem `Origin`.

## Pendências e riscos

1. **Revisão humana do PR #7** e decisão sobre o PR #1 (fechar apontando para o #7, ou mergear o #1 antes e rebasear).
2. **Windows:** rodar `npm.cmd ci` e `npm.cmd run verify` e o seed em diretório novo (critério da Issue #5).
3. **E2E em navegador** do fluxo completo (recomendado pela Issue #5; não feito). Frontend continua sem testes automatizados.
4. **Decisões de negócio:** retenção LGPD do XML (ADR-005), hospedagem/PostgreSQL gerenciado, e-mail para recuperação de senha, licença Econet, e as 9 decisões listadas na seção 11 da especificação 2A.
5. Rate limit em memória (uma réplica); sem MFA; sem expiração por inatividade; sem RLS; sem Dependabot.
6. Homologação com `validFrom` posterior a notas já importadas deixa essas notas `PENDENTE_REVISAO` sem item de revisão aberto que as cubra (lado seguro; a Sprint 2A trata com reprocessamento).
7. Se um processo de teste for morto, pode sobrar banco `cf_test_*` no PostgreSQL local; remover manualmente.

## Arquivos e módulos relevantes

| Para… | Veja |
|---|---|
| Servidor, sessão/CSRF, erros | `apps/api/src/app.ts`, `apps/api/src/errors.ts` (`asNotFound`) |
| Autorização por empresa/papel | `apps/api/src/auth/authorize.ts`, `loadReviewForStaff` em `modules/review.ts` |
| Regra de classificação do item | `apps/api/src/modules/classification.ts` |
| Importação de NF-e / XML íntegro | `apps/api/src/modules/documents.ts` |
| Harness e banco exclusivo de teste | `apps/api/src/test/harness.ts`, `pg-test-database.ts` |
| PGlite em disco | `apps/api/src/db/client.ts` (`ensurePgliteDataDir`) |
| Contratos do motor (só interfaces) | `packages/domain/src/tributario/index.ts` |
| Plano da Sprint 2A | `docs/SPRINT2A_ESPECIFICACAO.md`, `docs/adr/ADR-007-*` |
| Ameaças, audit de dependências | `docs/SEGURANCA.md` |

## Próxima ação exata para outro agente

1. `git fetch origin feat/sprint1-fundacao-segura && git checkout feat/sprint1-fundacao-segura && npm ci && npm run verify` — deve dar verde (69 testes).
2. Confirmar na aba Actions que o último SHA da branch está verde. Se não estiver, **corrigir antes de qualquer outra coisa**.
3. Não iniciar código da Sprint 2A até: (a) revisão humana do PR #7; (b) Henrique/Iza/Edson responderem às decisões da seção 11 de `docs/SPRINT2A_ESPECIFICACAO.md`, no mínimo o escopo do piloto (#1) e quem aprova regras (#2).
4. Liberada a 2A: criar branch nova a partir da `main` já com a Sprint 1 integrada (ou desta branch, se o PR #7 ainda não tiver sido mergeado — combinar com o revisor) e começar pelo incremento **2A.1 Catálogo** (seção 10 da especificação), com testes de isolamento e quatro olhos.
5. Nunca: fórmula de ICMS-ST/antecipação/DIFAL/rateio, conteúdo Econet sem licença confirmada, dados reais, merge na `main`, push forçado.
