# ADR-003 — Isolamento multitenant e modelo de autorização

**Status:** aceita · **Data:** 2026-11-13

## Contexto

A Contar Brasil atende várias empresas clientes. Um usuário cliente só pode ver a própria empresa; a equipe interna (administração e Fiscal) vê todas as empresas da organização. O sistema deve suportar, no futuro, outras organizações (ex.: operação dentro do Hub). Critério de aceite da Issue #2: "Cliente A não acessa NF-e, cadastros ou histórico do cliente B: teste por API e acesso direto por ID".

## Decisão

### Modelo

```
organizations ──< memberships >── users
      │                (role: admin | fiscal | cliente)
      └──< companies ──< company_access >── users
                 │
                 ├──< company_fiscal_profiles (versionado)
                 ├──< nfe_documents ──< nfe_items
                 └──< review_items
```

- **Organização** = tenant (hoje, a Contar Brasil). **Empresa** = cliente da contabilidade, sempre dentro de uma organização.
- **Papéis por organização**: `admin` (gerencia usuários, empresas e acessos), `fiscal` (cadastro fiscal, decisões de revisão), `cliente` (importa e consulta).
- **`company_access`**: concessão explícita de empresa a usuário. Obrigatória para `cliente`. `admin`/`fiscal` enxergam todas as empresas da organização.

### Aplicação

- Toda rota resolve o recurso e passa por `loadAccessibleCompany` / `loadCompanyForStaff` / `requireRole` (`apps/api/src/auth/authorize.ts`) **antes** de qualquer leitura ou escrita.
- Recursos acessados por ID (documento, item de revisão) são verificados pela empresa à qual pertencem.
- **Fora do escopo = 404**, nunca 403, para não revelar existência de dados de terceiros. 403 é reservado a "você vê, mas não pode alterar" (ex.: cliente tentando mudar cadastro fiscal).
- Colunas `organization_id` e `company_id` redundantes nas tabelas de documento e revisão, para permitir índices e, no futuro, Row-Level Security.
- Testes negativos obrigatórios em `apps/api/src/modules/isolation.test.ts`: listagem, acesso direto por ID, importação para empresa alheia, download de XML, fila de revisão, concessão de acesso cruzada.

## Alternativas consideradas

| Opção | Por que não agora |
|---|---|
| Banco/schema por tenant | Operacionalmente caro para dezenas de empresas pequenas; o isolamento lógico com testes negativos atende ao estágio atual. |
| Row-Level Security no PostgreSQL | Desejável como segunda camada; exige `SET LOCAL` por transação e usuário de aplicação sem bypass. Adiado — o esquema já carrega as colunas necessárias. |
| Autorização apenas por `organization_id` | Insuficiente: o requisito é por **empresa**, com clientes distintos na mesma organização. |
| CASL/Oso/OPA | Abstração a mais para três papéis e duas dimensões de escopo. |

## Consequências

- Um usuário pode ter papéis em várias organizações; a interface mostra a navegação pelo papel mais alto e a API verifica por organização em cada rota.
- Novas rotas devem reutilizar os helpers de `authorize.ts` e ganhar um teste negativo em `isolation.test.ts`. Não é aceitável consultar por ID sem verificar o escopo.
