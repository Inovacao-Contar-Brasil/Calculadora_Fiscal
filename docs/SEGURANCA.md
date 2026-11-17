# Segurança — modelo de ameaças e checklist pré-produção

Documento de trabalho da Sprint 1. Complementa as ADRs 002, 003 e 005.

## Ativos

- XML de NF-e e itens extraídos (dados fiscais e pessoais de terceiros).
- Cadastro fiscal das empresas (regime, CNAEs, parâmetros).
- Decisões de classificação do Fiscal e, futuramente, regras legais e cálculos.
- Credenciais e sessões de usuários; trilha de auditoria.

## Atores

| Ator | Confiança | Pode |
|---|---|---|
| Cliente (`cliente`) | baixa | importar XML e consultar nas empresas concedidas |
| Fiscal (`fiscal`) | média | tudo do cliente em todas as empresas da organização + cadastro fiscal + decisões |
| Admin (`admin`) | alta | tudo do fiscal + usuários, empresas, acessos |
| Anônimo | nenhuma | login, health |

## Ameaças e controles

| Ameaça | Controle implementado | Teste |
|---|---|---|
| Acesso sem login | `requireAuth` em todas as rotas de negócio; 401 | `auth.test.ts` |
| Cliente A lê dados de B (listagem ou por ID) | escopo por empresa em toda consulta; 404 fora do escopo | `isolation.test.ts` |
| Cliente altera cadastro fiscal / decide revisão | `loadCompanyForStaff` / `loadReviewForStaff` → 403 (escopo verificado **antes** do papel: sem acesso à empresa = 404) | `isolation.test.ts` |
| Oráculo de existência por ID | fora do escopo responde o mesmo corpo de inexistente (`asNotFound`) em documento, XML e item de revisão | `isolation.test.ts` |
| Decisões concorrentes / reabertura dupla | atualização condicional ao status lido (concorrência otimista) → 409 | `review-consistency.test.ts` |
| Status de classificação contraditório | regra única `classificationFor` na importação e na propagação; homologação só dentro da vigência | `classification.test.ts`, `review-consistency.test.ts` |
| Cliente importa nota de terceiro para si | CNPJ do destinatário deve ser o da empresa → 422 | `documents.test.ts` |
| Roubo de sessão via XSS | cookie `HttpOnly`; CSP `script-src 'self'`; React escapa saída | manual (headers) |
| CSRF | `SameSite=Strict` + `Origin` em métodos mutáveis; sem `Origin`, `Sec-Fetch-Site: cross-site` → 403 | `auth.test.ts` |
| Força bruta de senha | rate limit por IP no login e na troca de senha (429); scrypt; resposta uniforme; falhas auditadas | `auth.test.ts` |
| Enumeração de usuários | mesma mensagem para e-mail inexistente e senha errada; verificação de hash fictício | `auth.test.ts` |
| Cookie forjado | token de 32 bytes aleatórios, só o SHA-256 no banco; formato validado | `auth.test.ts` |
| Sessão eterna / sessão roubada após troca de senha | `expires_at` absoluto; logout revoga; troca de senha revoga **todas** as sessões, inclusive a atual (transação) | `auth.test.ts` |
| XML malicioso (XXE, bomba de entidades) | DTD/ENTITY rejeitados antes do parse; `processEntities: false`; 5 MB; 2000 itens | `parser.test.ts`, `documents.test.ts` |
| Corpo gigante / DoS simples | `bodyLimit`, rate limit global 300/min e 60/min na importação | — |
| Vazamento de stack trace | `setErrorHandler`: 500 genérico, log interno | — |
| Clickjacking | `frame-ancestors 'none'` | manual |
| Dados reais no Git | `.gitignore` (`*.xml`, `.env*`, certificados); fixtures sintéticas | revisão de PR |
| Adulteração do XML armazenado | imutável; SHA-256 registrado; download recalcula o hash e recusa divergência (409 `INTEGRITY_FAILURE`, auditado); `X-Content-SHA256`; `contentDiffers` em reimportação | `isolation.test.ts`, `documents.test.ts` |
| Travessia de caminho no frontend servido | `@fastify/static` ≥ 10.1.11, `wildcard: false`; testes com `..`, `%2e%2e`, `%2f`, `%5c` | `app.test.ts` |
| Ações sem rastro | `audit_events` na mesma transação (inclusive login, logout e troca de senha) | `fiscal-profiles.test.ts`, `auth.test.ts` |
| Dependência vulnerável em produção | CI: `npm audit --omit=dev --audit-level=high` bloqueia | CI |

## Riscos residuais e pendências

- Rate limit em memória: com múltiplas réplicas precisa de store compartilhado (Redis).
- Sem MFA, sem recuperação de senha por e-mail, sem bloqueio de conta por tentativas (só por IP).
- Sem Row-Level Security no banco (segunda camada de isolamento) — colunas já preparadas.
- Sem validação de assinatura digital/autorização da NF-e na SEFAZ.
- Retenção/exclusão LGPD não definida (ADR-005).
- Sem Dependabot/Renovate (o CI só bloqueia high/critical de produção na hora do build).
- Sem expiração por inatividade (só TTL absoluto); `last_seen_at` já é gravado.
- `X-Content-SHA256` protege contra corrupção no banco, não contra quem controla banco **e** hash; assinatura digital da NF-e não é validada.
- Logs: garantir que o ambiente de produção não capture corpo de requisições.
- Segredos: `SEED_ADMIN_PASSWORD` só em ambiente; trocar após o primeiro login.

## Checklist antes de qualquer ambiente externo

- [ ] `NODE_ENV=production`, `DATABASE_URL` definido, `COOKIE_SECURE=true`, `TRUST_PROXY` conforme o proxy, `ALLOWED_ORIGINS` só com o domínio real.
- [ ] TLS terminado no proxy; HSTS ativo (Helmet já envia).
- [ ] Backup do PostgreSQL e teste de restauração.
- [ ] Usuário de banco da aplicação sem privilégios de DDL além das migrações.
- [ ] Revisão de acessos (`company_access`) e remoção de usuários de teste.
- [ ] Política de retenção aprovada; canal de resposta a incidentes definido.
- [ ] Testes de isolamento executados contra o banco de produção vazio (CI com PostgreSQL real já cobre).

## Dependências — auditoria de 16/11/2026 (Issue #5)

`npm audit` no estado de `b63b94e`: **11 vulnerabilidades (2 critical, 2 high, 7 moderate)**. Correção sem `npm audit fix --force` (que propunha `vitest@5`, `drizzle-kit@0.18` e outras quebras).

| Pacote | Sev. | Escopo | Advisory | Tratamento |
|---|---|---|---|---|
| `drizzle-orm` < 0.45.2 | high | **produção** | GHSA-gpj5-g38j-94v9 (SQL injection por escape de identificadores) | ^0.44 → **^0.45.4**; testes PGlite + PostgreSQL; `drizzle-kit check` ok |
| `@fastify/static` ≤ 10.1.8 | high | **produção** | GHSA-pr96-94w5-mx2h, -x428-ghpx-8j92, -8pvw-jcv7-9cmj, -83w8-p2f5-377r (travessia / bypass de guarda) | ^8 → **^10.1.11**; testes de travessia em `app.test.ts`. Na prática só é usado com `WEB_DIST_DIR` |
| `glob` 9–14.0.1, `minimatch` 7–11.0.0 | moderate | produção (transitivo de `@fastify/static`) | GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | resolvidos pela atualização do `@fastify/static` |
| `tinypool` ≤ 2.1.1 | **critical** | dev (Vitest) | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (prototype pollution → RCE) | `vitest` ^3.2 → **^4.1.12** (não 5.x) |
| `@vitest/mocker` ≤ 4.1.11, `vitest` | moderate | dev | GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | idem |
| `esbuild` ≤ 0.24.2 (via `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils`) | moderate (4 entradas, 1 causa) | dev | GHSA-67mh-4wv8-2f99 (servidor de dev do esbuild responde a qualquer origem) | **Risco aceito.** Só afeta `esbuild serve`, que nunca é executado: o `@esbuild-kit` usa apenas `transform`. `drizzle-kit` roda só localmente para gerar/checar migrações e não entra no bundle. `overrides` testado e descartado: o npm 10 não o aplica sobre o lockfile existente. Reavaliar quando o `drizzle-kit` remover `@esbuild-kit` |

Resultado: `npm audit --omit=dev` → **0**; `npm audit` → **4 moderate**, todas da linha do `esbuild` acima.

Nota operacional: com npm 10.9 o `npm install` da árvore do Vitest 4 falha com `Cannot read properties of null (reading 'edgesOut')` (bug do arborist). O lockfile foi resolvido com `npx npm@11 install` e validado com npm 10 em `npm ci` e `npm install`. Se precisar mexer de novo na árvore do Vitest, use `npx npm@11 install` e depois `npm ci` com o npm do Node 22.
