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

## Refinamentos propostos na implementação da 2A.1 (18/11/2026)

Registrados pela sessão de implementação para revisão humana. **O status desta ADR continua "proposta"**: nada aqui foi aprovado por Henrique, Iza ou Edson. Detalhes em `docs/CATALOGO_LEGAL.md`.

1. **Catálogo por organização, com FKs compostas.** Fontes, snapshots e dispositivos também têm `organization_id` (a especificação só o previa em `tax_rules`); as referências usam FKs `(organization_id, id)`, então o banco impede citação entre organizações. Consequência: a mesma norma oficial é cadastrada por escritório.
2. **Garantias no banco, não só no backend.** Triggers append-only (sem DELETE; conteúdo imutável), mudança de status só com linha na trilha da mesma transação, vínculos de dispositivo só na criação da versão, CHECK de quatro olhos com autor garantido por FK composta, uma versão ATIVA e uma em revisão por regra.
3. **Trilha única do workflow.** `tax_rule_approvals` registra toda transição (`SUBMETE`, `APROVA`, `DEVOLVE`, `ATIVA`, `SUSPENDE`, `REATIVA`, `REVOGA`, `SUBSTITUI`) com origem/destino, em vez de só os passos de aprovação.
4. **Quatro olhos ampliado.** O autor também não devolve, não ativa e não reativa a própria versão. Ativação/suspensão/revogação restritas a `admin` e ativação exige `authorizationReference` (registro externo da autorização de negócio) — **provisório até a decisão nº 2**. Terceira pessoa (ativador ≠ aprovador) disponível por configuração (`RULE_ACTIVATION_REQUIRES_THIRD_PERSON`), desligada por padrão.
5. **Devolução** volta a versão a `RASCUNHO` sem permitir edição; a correção é uma nova versão, que substitui o rascunho anterior (preservado como `SUBSTITUIDA`).
6. **Encerramento sem reescrever:** `effects_to` da versão é imutável; substituição/revogação gravam `effects_ended_on`.
7. **`legal_amendments` adiada para a 2A.6**, com o reprocessamento; na 2A.1 a mudança legal é registrada encerrando os efeitos do dispositivo (que bloqueia versões cujo fundamento deixou de cobrir a vigência).
8. **Licença:** valor `INTERNO` acrescentado para interpretação do escritório; espécie `BASE_LICENCIADA` acrescentada; licença não verificada bloqueia submissão, aprovação e ativação e impede envio de conteúdo/importação assistida.
9. **Condições v1:** classificação exige NCM + (CEST ou descrição aceita expressamente); sem critério por CNAE; capítulo de NCM isolado recusado; incidência exige `segmentIn` e `ufDestino` (salvaguarda a confirmar pelo Fiscal).
10. **Fixtures `OFICIAL_PUBLICO`:** a guarda da seção 8 da especificação que proíbe esse valor em fixtures conflita com o critério de pronto da 2A.1; substituída por guarda de domínios oficiais e TLD `.invalid`.
