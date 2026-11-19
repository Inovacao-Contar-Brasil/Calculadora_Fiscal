# Calculadora Fiscal — instruções permanentes do projeto

Leia este arquivo e `docs/HANDOFF.md` antes de qualquer alteração. Este projeto é desenvolvido por sessões de IA e pessoas diferentes, em máquinas diferentes: **nada essencial pode viver só no histórico de uma conversa.**

## O que é

Plataforma SaaS da Contar Brasil para consulta tributária por produto a partir de XML de NF-e. Clientes importam notas; a equipe Fiscal controla cadastro tributário e homologa classificações; o motor de cálculo (ICMS-ST, antecipação, rateio de frete, custo) virá depois, somente com regras homologadas. Futuro módulo do Hub Contar Brasil — sem depender do repositório do Hub.

## Regras invioláveis

1. **Nenhuma fórmula tributária por suposição.** Não implemente alíquota, MVA, base de ST, antecipação, rateio ou custo sem caso real conferido e homologação expressa do Fiscal (Issue #3). Interfaces existem em `packages/domain/src/tributario`; implementações concretas só com fundamento legal, vigência e teste de regressão item a item.
2. **Nunca exponha ao cliente um valor não homologado como definitivo.** Itens sem decisão ficam `PENDENTE_REVISAO`.
3. **Nenhum dado real no repositório**: XML de clientes, CNPJs reais, certificados, `.env`, senhas. Testes usam XML sintético (`apps/api/src/test/fixtures.ts`) e CNPJs gerados.
4. **Autorização sempre no backend**, por empresa, antes de qualquer leitura/escrita. Fora do escopo = 404 com **o mesmo corpo** de inexistente (use `asNotFound` de `errors.ts`); verifique o escopo **antes** do papel (sem acesso = 404, sem papel = 403). Toda rota nova ganha teste negativo em `isolation.test.ts`.
5. **Não faça merge na `main`.** Trabalhe em branch, abra PR. Não publique em produção.
6. **Não modifique o Hub Contar Brasil.**
7. **Não anuncie como pronto o que não foi testado.** Rode `npm run verify` antes de cada commit.
8. **Atualize `docs/HANDOFF.md`** após cada marco e antes de encerrar a sessão.
9. **Classificação de item vem só de `classificationFor` e o vínculo item → decisão só de `selectReviewFor`** (`apps/api/src/modules/classification.ts`), na importação, na propagação, na reabertura e na resolução de pendência temporal. Decisão final (homologação **ou rejeição**) vale só dentro da vigência; vigências de decisões finais do mesmo produto são disjuntas e toda escrita na linha do tempo passa pelo lock do item aberto (`lockOpenReview`/UPSERT) — ADR-008. Nota fora da vigência não é homologada nem rejeitada: vira pendência temporal, resolvida por decisão do período, nunca editando a decisão existente. Mudou algo nessas regras? Rode `npm run test:mutations` (com `TEST_DATABASE_URL` para incluir a concorrência). Classificação homologada **não** autoriza cálculo (ADR-007).
10. **Catálogo legal é append-only e staff-only.** Conteúdo de versão nunca é editado (nova versão); status só muda com linha em `tax_rule_approvals` na mesma transação (trigger); autor não aprova/devolve/ativa. Nenhuma coluna ou código de alíquota/MVA/base no catálogo (`guards.test.ts`). Ver `docs/CATALOGO_LEGAL.md`.
11. **Testes nunca apagam nada em banco compartilhado.** Os arquivos de teste rodam em paralelo; com `TEST_DATABASE_URL` cada harness cria e remove o próprio banco `cf_test_*` (`apps/api/src/test/pg-test-database.ts`).
12. **Migração nunca é copiada, renomeada ou reordenada à mão.** O Drizzle aplica só entradas com `when` maior que o último registro aplicado e não compara hash: journal fora de ordem pula migração em silêncio. Branch que integra depois **regera** as próprias migrações (`npm run db:generate`) sobre o histórico de destino. `migrate()` recusa histórico não canônico (`apps/api/src/db/migration-history.ts`); banco com o histórico antigo do PR #9 só passa por `npm run db:reconcile`, com backup. Ver `docs/MIGRACOES.md` e ADR-009.

## Estrutura

```
packages/domain/      domínio puro (sem framework/banco/UI)
  src/nfe/            leitor de NF-e modelo 55 (parseNfe) — lê, não interpreta
  src/produto/        identidade de produto (fingerprint NCM|CEST|descrição)
  src/cadastro/       validação de CNPJ
  src/tributario/     SOMENTE interfaces do motor tributário
  src/catalogo/       workflow das versões de regra, tipos RuleConditions v1, JSON canônico (2A.1)
apps/api/             Fastify 5 + Zod 4 + Drizzle ORM (PostgreSQL / PGlite)
  src/app.ts          montagem do servidor (helmet, cookie, rate limit, CSRF, erros)
  src/auth/           senha (scrypt), sessão (token opaco + SHA-256), autorização
  src/modules/        auth, companies, fiscal-profiles, documents, review, temporal-pendencies (rotas + regras)
  src/modules/catalog/  catálogo legal 2A.1: fontes, snapshots, dispositivos, regras, versões, workflow (staff-only)
  src/modules/classification.ts  regra única de status e de vínculo do item (vigência, lacunas)
  src/db/schema.ts    esquema; drizzle/ migrações SQL geradas
  src/db/migration-history.ts  guarda do histórico de migrações + reconciliação do legado do PR #9 (CLI reconcile.ts)
  src/test/           harness (PGlite em memória ou banco exclusivo via TEST_DATABASE_URL) e fixtures
apps/web/             React 19 + Vite; SPA autenticada; roteador próprio (src/router.tsx)
docs/adr/             decisões arquiteturais (ADR-001…009; 007 = catálogo legal e triagem, proposta; 008 = pendência temporal, proposta; 009 = histórico de migrações, proposta)
docs/SPRINT2A_ESPECIFICACAO.md  plano técnico da Sprint 2A (catálogo + triagem, sem cálculo)
docs/CATALOGO_LEGAL.md          módulo implementado da 2A.1: modelo, workflow, permissões, endpoints
docs/MIGRACOES.md               histórico canônico de migrações, guarda e reconciliação (CF-INTEG-01)
docs/INTEGRACAO_CF-INTEG-01.md  relatório da pré-integração fundação + temporal + catálogo
docs/HANDOFF.md       estado atual e próxima ação — leia primeiro
docs/SEGURANCA.md     modelo de ameaças e checklist pré-produção
```

Direção de dependência: `apps → packages`. O domínio nunca importa de `apps/*`.

## Comandos

```bash
npm install                      # na raiz (workspaces)
npm run verify                   # typecheck + testes + build — obrigatório antes de commit
npm test                         # vitest (projetos "domain" e "api"); API usa PGlite em memória
TEST_DATABASE_URL=postgres://... npm test -- --project api   # contra PostgreSQL real (URL = conexão admin; requer CREATEDB)
npm run db:check                 # drizzle-kit check: migrações coerentes (também no CI)
npm run test:mutations           # mutações das garantias temporais (M1–M7, ADR-008) e do histórico de migrações (H1–H7); falha se alguma sobreviver
npm run db:reconcile             # diagnóstico do histórico de migrações; `-- --apply --confirm-database=<nome>` reconcilia o legado do PR #9 (docs/MIGRACOES.md)
npm run dev                      # API (3333) + web (5173, proxy /api) — PGlite em apps/api/.data
npm run db:generate              # após alterar src/db/schema.ts: gera migração em apps/api/drizzle
npm run db:seed                  # cria organização e admin a partir de SEED_* (apps/api/.env)
npm run build                    # esbuild (api) + vite (web)
```

Configuração: `apps/api/.env.example`. Sem `DATABASE_URL` a API usa PGlite (apenas dev/teste; a pasta é criada no primeiro uso). Em produção `DATABASE_URL` é obrigatória.

Windows: use `npm.cmd` no PowerShell; `npm run dev` não sobe os dois processos no `cmd.exe` — rode `dev:api` e `dev:web` em terminais separados.

Dependências: o CI bloqueia vulnerabilidade high/critical de produção (`npm audit --omit=dev --audit-level=high`). Nunca use `npm audit fix --force`. Riscos residuais aceitos ficam em `docs/SEGURANCA.md`. O npm 10 falha ao resolver a árvore do Vitest 4 (`edgesOut`): para mexer nela use `npx npm@11 install` e confirme com `npm ci`.

## Convenções

- TypeScript estrito; imports relativos com extensão `.ts` dentro de `apps/api` e `packages`.
- Dinheiro em **centavos inteiros** (`number`), percentuais em pontos-base. Nunca float.
- Datas de vigência como `YYYY-MM-DD` (coluna `date`); timestamps com fuso.
- Erros de negócio via `AppError` (`apps/api/src/errors.ts`); mensagens em português, seguras para o usuário.
- Toda escrita relevante grava `audit_events` **na mesma transação**.
- Migrações aplicadas são imutáveis; alteração = nova migração.
- Commits em português, no formato `tipo(escopo): resumo`, com corpo explicando o porquê.
- Textos de interface e documentação em português do Brasil.

## Fluxo de trabalho esperado

1. Ler `docs/HANDOFF.md` → confirmar branch e último commit.
2. Implementar em incrementos pequenos; para cada um: código → testes → `npm run verify` → commit.
3. Registrar decisões novas em `docs/adr/ADR-00N-*.md`.
4. Atualizar `docs/HANDOFF.md` (branch, commit, concluído, em andamento, próxima ação exata).
5. Push da branch e PR para `main` (sem merge automático).
