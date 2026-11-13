# ADR-001 — Stack, estrutura do repositório e banco de dados

**Status:** aceita · **Data:** 2026-11-13 · **Sprint:** 1 (fundação SaaS)

## Contexto

A Calculadora Fiscal nasce como aplicação independente, mas deve virar módulo do Hub Contar Brasil sem reescrita. O PR #1 entregou um leitor de NF-e em React + TypeScript + Vite rodando só no navegador. A Sprint 1 exige backend com autenticação, PostgreSQL, isolamento multitenant e testes automatizados, sem introduzir complexidade desnecessária. A máquina de desenvolvimento não tem PostgreSQL nem Docker.

## Decisão

1. **Monorepo com npm workspaces** (sem Turborepo/Nx por ora):
   - `packages/domain` — domínio puro (leitor de NF-e, identidade de produto, CNPJ, contratos do motor tributário). Zero dependência de framework, banco ou interface. É o que o Hub poderá consumir diretamente.
   - `apps/api` — API HTTP.
   - `apps/web` — frontend React existente, evoluído.
2. **TypeScript estrito** em tudo (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), uma base única em `tsconfig.base.json`.
3. **Backend: Fastify 5** com validação **Zod 4** via `fastify-type-provider-zod`.
4. **Persistência: PostgreSQL** acessado com **Drizzle ORM**; migrações SQL geradas pelo `drizzle-kit` e versionadas em `apps/api/drizzle/`.
5. **PGlite (PostgreSQL compilado para WASM)** quando `DATABASE_URL` não está definida — desenvolvimento local e testes. Mesmo dialeto, mesmas migrações. Em produção `DATABASE_URL` é obrigatória (a configuração recusa iniciar sem ela).
6. **Build da API com esbuild** (bundle único, dependências externas); frontend com Vite.
7. **Sem microsserviços**: um processo de API, um banco. A separação por módulos (`modules/*`) e pelo pacote de domínio é o que garante evolução.

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Next.js full-stack | Acopla frontend e API no mesmo runtime; dificulta expor a API ao Hub e rodar o domínio isolado. |
| NestJS | Mais camadas (DI, decorators) do que o time precisa agora; Fastify puro é menor e igualmente tipado com Zod. |
| Express | Sem validação/tipagem integrada, menos performante, ecossistema de segurança mais fragmentado. |
| Hono | Excelente, mas plugins maduros de cookie/rate-limit/helmet pesaram a favor do Fastify. |
| Prisma | Gera engine binária, migrações menos transparentes, overhead em funções serverless; Drizzle é SQL-first e leve. |
| Kysely | Ótimo query builder, mas sem gerador de migrações a partir do esquema. |
| SQLite local para dev | Dialeto diferente do PostgreSQL de produção; PGlite elimina a divergência. |
| Docker Compose para PostgreSQL local | Indisponível na máquina atual; fica como opção documentada (`DATABASE_URL`). |

## Consequências

- Qualquer alteração no esquema passa por `npm run db:generate` e a migração gerada vai para o commit. Migrações aplicadas nunca são editadas.
- Testes de integração rodam sem infraestrutura (PGlite em memória) e, no CI, também contra PostgreSQL 16 real (`TEST_DATABASE_URL`).
- O domínio não pode importar nada de `apps/*`. A direção de dependência é sempre `apps → packages`.
