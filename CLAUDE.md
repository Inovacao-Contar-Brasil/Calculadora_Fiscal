# Calculadora Fiscal — instruções permanentes do projeto

Leia este arquivo e `docs/HANDOFF.md` antes de qualquer alteração. Este projeto é desenvolvido por sessões de IA e pessoas diferentes, em máquinas diferentes: **nada essencial pode viver só no histórico de uma conversa.**

## O que é

Plataforma SaaS da Contar Brasil para consulta tributária por produto a partir de XML de NF-e. Clientes importam notas; a equipe Fiscal controla cadastro tributário e homologa classificações; o motor de cálculo (ICMS-ST, antecipação, rateio de frete, custo) virá depois, somente com regras homologadas. Futuro módulo do Hub Contar Brasil — sem depender do repositório do Hub.

## Regras invioláveis

1. **Nenhuma fórmula tributária por suposição.** Não implemente alíquota, MVA, base de ST, antecipação, rateio ou custo sem caso real conferido e homologação expressa do Fiscal (Issue #3). Interfaces existem em `packages/domain/src/tributario`; implementações concretas só com fundamento legal, vigência e teste de regressão item a item.
2. **Nunca exponha ao cliente um valor não homologado como definitivo.** Itens sem decisão ficam `PENDENTE_REVISAO`.
3. **Nenhum dado real no repositório**: XML de clientes, CNPJs reais, certificados, `.env`, senhas. Testes usam XML sintético (`apps/api/src/test/fixtures.ts`) e CNPJs gerados.
4. **Autorização sempre no backend**, por empresa, antes de qualquer leitura/escrita. Fora do escopo = 404. Toda rota nova ganha teste negativo em `isolation.test.ts`.
5. **Não faça merge na `main`.** Trabalhe em branch, abra PR. Não publique em produção.
6. **Não modifique o Hub Contar Brasil.**
7. **Não anuncie como pronto o que não foi testado.** Rode `npm run verify` antes de cada commit.
8. **Atualize `docs/HANDOFF.md`** após cada marco e antes de encerrar a sessão.

## Estrutura

```
packages/domain/      domínio puro (sem framework/banco/UI)
  src/nfe/            leitor de NF-e modelo 55 (parseNfe) — lê, não interpreta
  src/produto/        identidade de produto (fingerprint NCM|CEST|descrição)
  src/cadastro/       validação de CNPJ
  src/tributario/     SOMENTE interfaces do motor tributário
apps/api/             Fastify 5 + Zod 4 + Drizzle ORM (PostgreSQL / PGlite)
  src/app.ts          montagem do servidor (helmet, cookie, rate limit, CSRF, erros)
  src/auth/           senha (scrypt), sessão (token opaco + SHA-256), autorização
  src/modules/        auth, companies, fiscal-profiles, documents, review (rotas + regras)
  src/db/schema.ts    esquema; drizzle/ migrações SQL geradas
  src/test/           harness (PGlite em memória ou TEST_DATABASE_URL) e fixtures
apps/web/             React 19 + Vite; SPA autenticada; roteador próprio (src/router.tsx)
docs/adr/             decisões arquiteturais (ADR-001…006)
docs/HANDOFF.md       estado atual e próxima ação — leia primeiro
docs/SEGURANCA.md     modelo de ameaças e checklist pré-produção
```

Direção de dependência: `apps → packages`. O domínio nunca importa de `apps/*`.

## Comandos

```bash
npm install                      # na raiz (workspaces)
npm run verify                   # typecheck + testes + build — obrigatório antes de commit
npm test                         # vitest (projetos "domain" e "api"); API usa PGlite em memória
TEST_DATABASE_URL=postgres://... npm test -- --project api   # contra PostgreSQL real
npm run dev                      # API (3333) + web (5173, proxy /api) — PGlite em apps/api/.data
npm run db:generate              # após alterar src/db/schema.ts: gera migração em apps/api/drizzle
npm run db:seed                  # cria organização e admin a partir de SEED_* (apps/api/.env)
npm run build                    # esbuild (api) + vite (web)
```

Configuração: `apps/api/.env.example`. Sem `DATABASE_URL` a API usa PGlite (apenas dev/teste). Em produção `DATABASE_URL` é obrigatória.

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
