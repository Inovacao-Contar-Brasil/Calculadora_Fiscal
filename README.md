# Calculadora Fiscal — Contar Brasil

Plataforma web independente de consulta tributária por produto a partir de XML de NF-e. Clientes da contabilidade importam notas; a equipe Fiscal controla o cadastro tributário das empresas e homologa a classificação de cada produto; o motor de cálculo (ICMS-ST, antecipação, rateio de frete, custo de aquisição) entra depois, apenas com regras homologadas. Preparada para virar módulo do Hub Contar Brasil.

**Estado atual (Sprint 1):** fundação SaaS funcional — autenticação, papéis, isolamento por empresa, cadastro fiscal versionado, importação persistente de NF-e com histórico e fila de revisão. **Nenhum cálculo tributário está implementado ou homologado;** produtos aparecem como `PENDENTE_REVISAO` até decisão do Fiscal. Não usar para precificação ou apuração.

## Como rodar

Requisitos: Node 22+. Não precisa de PostgreSQL para desenvolver (usa PGlite, PostgreSQL embarcado).

```bash
npm install
cp apps/api/.env.example apps/api/.env   # ajuste SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
npm run db:seed                          # cria organização e primeiro admin
npm run dev                              # API em http://127.0.0.1:3333, web em http://localhost:5173
```

Com PostgreSQL real: defina `DATABASE_URL` no `.env`. Em produção ela é obrigatória.

Verificação completa (obrigatória antes de commit):

```bash
npm run verify        # typecheck + testes + build
```

## Estrutura

- `packages/domain` — domínio puro: leitor de NF-e, identidade de produto, CNPJ, **interfaces** do motor tributário.
- `apps/api` — Fastify + Zod + Drizzle (PostgreSQL/PGlite): auth, empresas, cadastro fiscal, documentos, revisão, auditoria.
- `apps/web` — React + Vite: SPA autenticada.
- `docs/adr` — decisões arquiteturais. `docs/HANDOFF.md` — estado atual e próxima ação. `docs/SEGURANCA.md` — ameaças e checklist. `CLAUDE.md` — instruções permanentes.

## Fluxo implementado

1. Admin cadastra empresa e usuários; libera acesso de clientes por empresa.
2. Fiscal registra o cadastro fiscal da empresa (regime, CNAEs, parâmetros) com vigência — cada alteração é uma nova versão; a anterior é preservada.
3. Cliente importa o XML; a API valida, confere o CNPJ do destinatário, guarda o original com SHA-256, deduplica por chave e persiste os itens.
4. Cada produto novo entra na fila de revisão. O Fiscal homologa ou rejeita o enquadramento com fundamento legal; a decisão vale para importações futuras até ser encerrada por mudança legislativa.
5. Cliente consulta histórico e documentos; vê o status de classificação de cada item, nunca um valor calculado.

## Regras do repositório

- Nenhum XML de cliente, CNPJ real, certificado, `.env` ou senha é versionado. Testes usam dados sintéticos.
- Nenhuma fórmula tributária sem caso real conferido e homologação do Fiscal (Issue #3).
- Alterações passam por branch + PR; sem merge direto na `main`.
