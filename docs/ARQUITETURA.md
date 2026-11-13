# Arquitetura

Visão da arquitetura após a Sprint 1. Decisões detalhadas em `docs/adr/`.

## Visão geral

```
┌──────────────┐  cookie HttpOnly   ┌───────────────────────────┐        ┌──────────────┐
│ apps/web     │ ─────────────────▶ │ apps/api (Fastify)        │ ─────▶ │ PostgreSQL   │
│ React + Vite │  JSON / XML cru    │ auth · authorize · módulos │ Drizzle│ (PGlite dev) │
└──────────────┘                    └─────────────┬─────────────┘        └──────────────┘
                                                  │ importa
                                    ┌─────────────▼─────────────┐
                                    │ packages/domain            │
                                    │ nfe · produto · cadastro   │
                                    │ tributario (interfaces)    │
                                    └────────────────────────────┘
```

- **Domínio** (`packages/domain`): código puro, sem framework, banco ou UI. Contém o leitor de NF-e (lê e confere, não interpreta), a identidade de produto, validação de CNPJ e os **contratos** do motor tributário. É a parte que o Hub poderá consumir como biblioteca.
- **API** (`apps/api`): única porta de entrada. Autentica (sessão opaca em banco), autoriza por organização/empresa, valida entradas com Zod, persiste com Drizzle, grava auditoria na mesma transação. Pode servir o build do frontend no mesmo origin.
- **Web** (`apps/web`): SPA React que só exibe o que a API devolve. Não processa XML nem decide nada.

## Módulos da API

| Módulo | Responsabilidade | Principais rotas |
|---|---|---|
| `auth` | login/logout, sessão, troca de senha | `POST /api/auth/login`, `/logout`, `GET /api/auth/me`, `POST /api/auth/password` |
| `companies` | organizações, empresas, usuários, acessos | `GET /api/companies`, `POST /api/organizations/:id/companies`, `/users`, `POST|DELETE /api/companies/:id/access` |
| `fiscal-profiles` | cadastro fiscal versionado com vigência | `GET|POST /api/companies/:id/fiscal-profiles`, `/current?date=`, `/audit` |
| `documents` | importação de NF-e, histórico, detalhe, XML original | `POST|GET /api/companies/:id/documents`, `GET /api/documents/:id`, `/xml` |
| `review` | fila de classificação, decisões, memória, reabertura | `GET /api/review-items`, `GET|PATCH /api/review-items/:id`, `POST /api/review-items/:id/reopen` |

## Modelo de dados (resumo)

`organizations` → `memberships` (papel) → `users`; `organizations` → `companies` → `company_access`; `companies` → `company_fiscal_profiles` (versões com `valid_from/valid_to`), `nfe_documents` (XML íntegro + SHA-256, único por chave na empresa) → `nfe_items` (status de classificação, `fingerprint`); `review_items` (um por produto/empresa vigente; decisão com vigência); `sessions`; `audit_events`.

## Fluxo de importação

autenticação → empresa acessível → corpo XML (≤ 5 MB) → `parseNfe` (DTD proibido, modelo 55, centavos) → chave 44 dígitos → CNPJ destinatário = empresa → já existe? devolve duplicado → transação: documento + itens + fila de revisão (herda decisão vigente na emissão) + auditoria → status `COM_PENDENCIAS` ou `REVISADA`.

## Preparação para o motor tributário

As interfaces em `packages/domain/src/tributario` definem o pipeline futuro:

`ProductIdentifier` → `TaxClassifier` (usa `LegalRuleCatalog` com vigência e `approval`) → `IcmsStCalculator` / `AntecipacaoCalculator` → `FreightAllocator` (item vs. total vs. CT-e, sem dupla contagem) → `UnitCostComposer` (separa recuperável de custo) — tudo produzindo `CalculationMemory` auditável e passando por `ApprovalWorkflow`/`AuditTrail`.

A implementação padrão (`NotHomologatedClassifier`) devolve `PENDENTE_REVISAO`. Implementações reais só entram com regra homologada (Issue #3), uma por regra, com fixtures de regressão item a item.

## Integração futura com o Hub

- A API é independente do frontend: o Hub pode consumir as rotas `/api/*` com a mesma autorização, ou embutir o pacote de domínio.
- Identidade: `users`/`memberships` permanecem como modelo local; um provedor SSO do Hub pode criar sessões sem alterar a autorização (ADR-002).
- Tenancy já contempla múltiplas organizações (ADR-003).
- Nada neste repositório depende do repositório do Hub.

## Limites conhecidos

- Não valida assinatura digital nem situação da NF-e na SEFAZ.
- Sem cálculo tributário, rateio ou custo.
- Rate limit em memória; sem RLS; retenção LGPD pendente (ver `docs/SEGURANCA.md` e ADR-005).
