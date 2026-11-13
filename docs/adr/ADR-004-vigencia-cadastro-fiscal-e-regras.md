# ADR-004 — Modelo de vigência do cadastro fiscal, das decisões de classificação e das regras legais

**Status:** aceita · **Data:** 2026-11-13

## Contexto

Regime tributário, CNAEs e parâmetros de uma empresa mudam ao longo do tempo, e uma NF-e deve ser avaliada pela configuração vigente **na data do fato gerador**, não pela atual. O mesmo vale para classificações homologadas pelo Fiscal e para as regras legais (alíquotas, MVA, protocolos), que mudam por legislação. A Issue #2 exige "histórico, vigência, origem da informação, responsável pela alteração e trilha de auditoria".

## Decisão

### Cadastro fiscal (`company_fiscal_profiles`)

- **Append-only**: cada alteração cria uma nova linha com `version = anterior + 1`. Nunca há `UPDATE` de regime/CNAE em linha existente.
- **Vigência** por `valid_from` (obrigatório) e `valid_to` (nulo = vigente). Ao criar a versão N+1, a versão N recebe `valid_to = valid_from(N+1) − 1 dia`, `superseded_at` e `superseded_by_id`.
- `valid_from` da nova versão tem que ser **posterior** ao da anterior (422 caso contrário). Correções retroativas exigem decisão explícita — não há "editar versão".
- Autoria: `created_by`, `source` (origem da informação, texto obrigatório) e `notes`. Cada criação gera `audit_events` com `previousVersion`/`previousRegime`.
- Consulta "vigente em D": `valid_from <= D AND (valid_to IS NULL OR valid_to >= D)`.

### Decisões de classificação (`review_items`)

- Um item por `(empresa, fingerprint do produto)` **enquanto vigente** (índice único parcial `valid_to IS NULL`).
- Estados: `PENDENTE_REVISAO → EM_ANALISE → HOMOLOGADO | REJEITADO` (voltar a pendente só a partir de `EM_ANALISE`). Estados finais não mudam.
- Homologação registra `decision` (enquadramento + fundamento legal + observações), `justification`, `decided_by`, `decided_at`, `valid_from`. **Sem campos de valor**: a decisão é de enquadramento, não de cálculo.
- **Memória**: ao importar uma NF-e, cada item herda o status da decisão vigente na data de emissão; produto já homologado não volta à fila.
- **Mudança legislativa**: `POST /review-items/:id/reopen` fecha a decisão (`valid_to`) e abre um novo item pendente para o mesmo produto; notas emitidas após `valid_to` voltam a pendente, as anteriores mantêm a decisão antiga.

### Regras legais (futuro — só interface)

- `LegalRule` em `packages/domain/src/tributario` exige `legalBasis` (norma, artigo, URL), `vigencia`, `conditions`, `parameters` em pontos-base e `approval` (quem homologou). Regra sem `approval` não pode entrar em cálculo.
- A tabela correspondente só será criada quando a Issue #3 entregar a matriz de cenários.

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Atualizar a linha e guardar diff em log | Perde a consulta "vigente em D" e dificulta reprocessamento. |
| Tabelas temporais (`tstzrange` + constraint de exclusão) | Mais rigoroso, mas PGlite/Drizzle têm suporte limitado; o modelo atual já impede sobreposição pela regra "valid_from estritamente posterior". Reavaliar quando houver correção retroativa. |
| Classificação por organização em vez de por empresa | Produtos iguais podem ter tratamentos distintos por regime/UF da empresa; decisões por empresa são mais seguras. Reaproveitamento entre empresas pode vir depois como sugestão, nunca automático. |

## Consequências

- Reprocessar uma NF-e antiga é determinístico: basta consultar perfil e decisões vigentes na emissão.
- O frontend exibe a versão vigente e o histórico; clientes só leem.
