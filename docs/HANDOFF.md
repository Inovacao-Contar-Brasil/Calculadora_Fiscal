# HANDOFF — continuidade entre sessões

> Leia junto com `CLAUDE.md`. Atualize este arquivo após cada marco e antes de encerrar a sessão.

## Objetivo da sprint

**Sprint 1 — Fundação SaaS segura** (Issue #2): autenticação e sessões; papéis `admin`/`fiscal`/`cliente` com isolamento por organização e empresa; cadastro fiscal versionado com vigência e auditoria; importação persistente de XML de NF-e com deduplicação; histórico; fila de revisão (`PENDENTE_REVISAO`) sem cálculo tributário; estrutura de domínio pronta para o motor tributário e para o Hub.

## Estado

- **Branch de trabalho:** `feat/sprint1-fundacao-segura` (criada a partir de `origin/feat/fundacao-importacao-nfe`, o PR #1, que continua aberto e **não** foi mergeado).
- **Base:** `main` tem só o README inicial (`82b7497`). O PR #1 tem `d3bb210` e `1f62c4f`.
- **Commits desta sprint (em ordem):**
  1. `9f54287` chore: monorepo + pacote de domínio + contratos do motor tributário
  2. `bc61554` feat(api): fundação segura (auth, RBAC, cadastro fiscal, importação, revisão)
  3. `71cceec` feat(web): SPA autenticada
  4. (este commit) docs: ADRs, CLAUDE.md, HANDOFF, segurança, README, arquitetura
- **Push:** ainda **não enviado** ao GitHub — a máquina da sessão de 13/11/2026 não tinha credencial (`git push` falhou com "could not read Username"). **Primeira ação da próxima sessão: `git push -u origin feat/sprint1-fundacao-segura` e abrir o PR** (ver "Próxima ação").
- **Verificação (13/11/2026, local, Node 22.20):** `npm run verify` verde — typecheck nos 3 workspaces, **46 testes** (14 domínio + 32 API) com PGlite em memória, build da API (esbuild) e do web (Vite). Smoke ponta a ponta via curl contra o servidor real (seed → login → empresa → perfil fiscal → cliente importa → duplicado → fila → 403 para cliente → homologação → documento `REVISADA` → 401 sem login → 403 origem estranha): OK.
- **Não executado:** testes contra PostgreSQL real (não há PostgreSQL nem Docker na máquina; o CI faz isso com `TEST_DATABASE_URL`). CI ainda não rodou porque não houve push.

## Concluído

- Monorepo npm workspaces (`packages/domain`, `apps/api`, `apps/web`), TS estrito, vitest com dois projetos, CI com PostgreSQL 16 como serviço.
- Domínio: parser de NF-e movido intacto; fingerprint de produto; validação de CNPJ; **interfaces** do motor tributário (identificação, classificação, catálogo de regras com vigência, ICMS-ST, antecipação, rateio, custo unitário, memória de cálculo, aprovação/auditoria) + `NotHomologatedClassifier`.
- API (Fastify 5, Zod 4, Drizzle, PostgreSQL/PGlite): esquema com 11 tabelas e migração `0000_fundacao`; sessões opacas + cookie HttpOnly/Strict; scrypt; rate limit; CSRF por Origin; Helmet; erros seguros; seed idempotente; API opcionalmente serve o build do web (`WEB_DIST_DIR`).
- Rotas: `auth` (login/logout/me/password), `organizations`, `companies` (+ users, access), `fiscal-profiles` (histórico, vigente em data, nova versão, auditoria), `documents` (importar, histórico, detalhe, XML original), `review-items` (fila, detalhe, transições, reabertura por vigência).
- Web: login, empresas, empresa (importar/histórico/cadastro fiscal/acessos), documento, fila e detalhe de revisão, administração.
- Documentação: ADR-001…006, `CLAUDE.md`, `docs/SEGURANCA.md`, README e `docs/ARQUITETURA.md` atualizados.

## Em andamento / não iniciado

- Nada em andamento com código parcial. Tudo que está na branch compila, passa nos testes e está commitado.
- Não iniciado (fora do sprint ou dependente de decisão): motor de cálculo, catálogo de regras legais persistido, relatórios PDF/Excel, importação em lote, SSO/Hub, MFA, recuperação de senha, RLS, retenção LGPD.

## Arquivos e módulos relevantes

| Para… | Veja |
|---|---|
| Montagem do servidor, hooks de sessão/CSRF, erros | `apps/api/src/app.ts` |
| Autorização por empresa/papel | `apps/api/src/auth/authorize.ts` |
| Sessões e senha | `apps/api/src/auth/session.ts`, `password.ts` |
| Esquema e migrações | `apps/api/src/db/schema.ts`, `apps/api/drizzle/` |
| Importação de NF-e (transação completa) | `apps/api/src/modules/documents.ts` → `importNfe` |
| Vigência do cadastro fiscal | `apps/api/src/modules/fiscal-profiles.ts` |
| Fila de revisão e memória de classificação | `apps/api/src/modules/review.ts` |
| Harness de teste e XML sintético | `apps/api/src/test/harness.ts`, `fixtures.ts` |
| Parser de NF-e | `packages/domain/src/nfe/parser.ts` |
| Contratos do motor tributário | `packages/domain/src/tributario/index.ts` |
| Frontend: rotas e páginas | `apps/web/src/App.tsx`, `apps/web/src/pages/*` |

## Decisões arquiteturais

`docs/adr/ADR-001` stack/monorepo/Drizzle/PGlite · `ADR-002` sessões próprias + scrypt + CSRF · `ADR-003` tenancy orgs→empresas, 404 fora do escopo · `ADR-004` vigência append-only (cadastro, decisões, regras) · `ADR-005` XML íntegro em banco, SHA-256, auditoria, retenção pendente · `ADR-006` parser no backend.

## Pendências e riscos

1. **Push + PR** não feitos (credencial). CI nunca rodou nesta branch — pode haver diferença de comportamento no PostgreSQL real (ex.: `select count(*)::int`, índice único parcial, `date` como string). Os testes foram escritos para os dois motores, mas só o PGlite foi executado.
2. Rate limit em memória (uma réplica). Redis quando escalar.
3. Decisão de negócio pendente: retenção/exclusão de XML (ADR-005), hospedagem/PostgreSQL gerenciado, serviço de e-mail (recuperação de senha).
4. Reaproveitamento de classificação entre empresas não existe (decisão por empresa — ADR-004).
5. O PR #1 segue aberto; este PR o contém. Sugestão: fechar o #1 apontando para o novo PR, ou mergear o #1 primeiro e rebasear.
6. Frontend sem testes automatizados (só typecheck + build). Fluxo verificado manualmente via API.

## Próxima ação exata para outro agente

1. `git fetch && git checkout feat/sprint1-fundacao-segura && npm install && npm run verify` — deve estar verde (46 testes).
2. Se ainda não houver push: `git push -u origin feat/sprint1-fundacao-segura`.
3. Abrir PR para `main` com título **"feat: Sprint 1 — fundação SaaS segura (auth, cadastro fiscal versionado, importação persistente, isolamento, revisão)"**; corpo: resumo deste HANDOFF + referência `Closes #2` **somente após** revisão humana confirmar os critérios de aceite; linkar ADRs. Rodapé: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. Acompanhar o CI (job com PostgreSQL real). Se falhar só no PostgreSQL, corrigir a query e adicionar o caso ao teste.
5. Depois do PR: (a) decidir com Henrique/Edson retenção LGPD e hospedagem; (b) iniciar Issue #3 (matriz de cenários) **sem** codar fórmulas; (c) opcional de qualidade: testes de componente no web, `npm audit` no CI.
