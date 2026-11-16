# ADR-007 — Catálogo legal versionado e triagem por exceção, separados do cálculo

**Status:** proposta · **Data:** 2026-11-16 · **Detalhe:** `docs/SPRINT2A_ESPECIFICACAO.md`

## Contexto

A Issue #4 muda o requisito da Sprint 1: a revisão fiscal deve tratar só exceções, e os itens cobertos por regras homologadas devem ser resolvidos automaticamente. A Issue #6 pede catálogo de fontes e regras versionadas e um resolvedor de cobertura/divergências **sem cálculo**. A Issue #3 continua sendo o único caminho para qualquer fórmula. O risco central é confundir classificação do produto, incidência tributária e cálculo — e reaproveitar decisões depois de mudanças legais ou de contexto.

## Decisão

1. **Três camadas com aprovação própria:** classificação do produto (camada 1), incidência por operação (camada 2) e cálculo (camada 3, Sprint 2B). Classificação homologada não autoriza incidência; incidência determinada não autoriza cálculo. Um `CalculationGate` explícito responde sempre `CALCULO_NAO_HOMOLOGADO` na 2A.
2. **Catálogo normativo append-only:** `legal_sources` → `legal_source_snapshots` (proveniência com hash) → `legal_provisions` (dispositivo com efeitos) → `legal_amendments`. Regras curadas em `tax_rules` + `tax_rule_versions` (append-only) com workflow `RASCUNHO → EM_REVISAO_TECNICA → APROVADA → ATIVA` e quatro olhos (autor ≠ aprovador). Só `ATIVA` conta como cobertura. Sem colunas de alíquota/MVA/base na 2A.
3. **Fontes:** só fontes oficiais fundamentam regras; ferramentas de confronto (ST MinasGerais) e interpretações do escritório são tipos próprios, nunca fundamento único. Conteúdo licenciado fica bloqueado (`license_status`) até confirmação documentada; nada de scraper.
4. **Condições tipadas** por schema versionado; fator exigido ausente nunca casa por omissão; regra de classificação não pode depender só de NCM (nem só de CNAE).
5. **Triagem como função pura do domínio**, com precedência determinística e estados próprios (`COBERTO_REGRA_HOMOLOGADA`, `DIVERGENCIA`+subtipo, `DADOS_INSUFICIENTES`, `SEM_COBERTURA`, `REVISAR_MUDANCA_LEGAL`), separados do `classificationStatus` da revisão humana.
6. **Avaliações append-only** (`item_evaluations`) com contexto e proveniência por fator, hash do catálogo consultado e versão do motor. Mudança legal gera reprocessamento de emissões a partir da data de efeitos, criando avaliações novas; o passado não é reescrito.
7. **Reaproveitamento por chave completa** (empresa + fingerprint do produto + contexto da operação + versões de regra) e dentro da vigência; entre empresas, só sugestão.
8. **Ativação gradual por empresa:** `OFF` (Sprint 1) → `SHADOW` (grava, não muda a fila) → `EXCECOES` (com aprovação do Fiscal por empresa/segmento). Falha do motor = fila, como hoje.

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Estender `review_items` com campos de regra e cálculo | Mistura decisão humana de classificação com incidência e cálculo; impede reavaliar uma camada sem a outra. |
| Regras como JSON livre | Impossível validar "fator exigido ausente", garantir quatro olhos sobre o conteúdo e detectar regra só por NCM. |
| Importar base consolidada de terceiros como verdade | Viola a Issue #6, pode violar licença e esconde a proveniência. |
| Ativar exceções direto, sem modo sombra | Sem evidência de concordância com o Fiscal; um erro silencioso deixaria de enviar itens à revisão. |
| Reescrever avaliações antigas após mudança legal | Perde a reprodutibilidade "como foi avaliado na data" exigida pela ADR-004. |

## Consequências

- Mais tabelas e um passo de curadoria antes de qualquer automação — intencional: cobertura só existe quando alguém responsável a aprovou.
- A fila da Sprint 1 continua sendo o comportamento padrão até o Fiscal habilitar `EXCECOES` com base no modo sombra.
- A Sprint 2B herda um portão explícito e o catálogo com proveniência, sem precisar refatorar a camada de classificação.
