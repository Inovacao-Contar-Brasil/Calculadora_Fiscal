# Sprint 2A — Catálogo legal versionado e triagem de cobertura e divergências

**Status:** especificação proposta (16/11/2026), aguardando revisão de Henrique (produto) e Iza/Edson (Fiscal). **Não autoriza nenhuma fórmula de cálculo.**
**Issues:** #6 (escopo), #4 (requisito de revisão por exceção), #3 (matriz fiscal, gatilho da 2B). **Pré-requisito:** gate da Issue #5 (CI verde no PostgreSQL real) — cumprido, ver `docs/HANDOFF.md`.
**Decisão arquitetural correspondente:** `docs/adr/ADR-007-catalogo-legal-e-triagem.md`.

---

## 1. Objetivo e limites

**Objetivo do produto (Issue #4):** o sistema resolve automaticamente os itens cobertos por regras **homologadas** e envia à revisão fiscal **somente** os casos divergentes, ambíguos ou não cobertos. A fila "todo produto novo vai para revisão" da Sprint 1 é provisória.

**O que a Sprint 2A entrega:** o catálogo de fontes e regras versionadas e um motor de **triagem** que, para cada item de NF-e, diz *se* e *por que* ele está coberto, divergente, incompleto, sem cobertura ou afetado por mudança legal — com evidência e fundamento.

**O que a Sprint 2A NÃO entrega (inviolável):**

- Nenhuma fórmula de ICMS-ST, antecipação, DIFAL, ST interna, MVA, alíquota, base de cálculo, rateio de frete ou custo. O esquema do catálogo **não tem campos numéricos de cálculo** nesta etapa.
- Classificação homologada **não** autoriza cálculo. Incidência determinada **não** autoriza cálculo. O cálculo só existe na 2B, por cenário, após homologação item a item da matriz da Issue #3.
- Nenhum conteúdo licenciado (Econet ou outro) coletado, copiado ou reproduzido sem confirmação documentada dos direitos de uso. Nenhum scraper.
- Nenhum dado real em fixtures, commits ou prompts externos.
- A fila de revisão continua recebendo **todos** os itens até a ativação explícita do modo por exceção (seção 9).

## 2. Três camadas separadas

A confusão mais perigosa do domínio é tratar "o produto é autopeça" como "há ST de R$ X". Cada camada tem status, aprovação e versão próprios; a seguinte só roda se a anterior estiver resolvida.

| Camada | Pergunta | Exemplo (sintético) | Quem homologa | Sprint |
|---|---|---|---|---|
| **1. Classificação do produto** | A que segmento/item normativo este produto pertence, considerando NCM, CEST, descrição e aplicação? | "Pastilha de freio → segmento autopeças, item X do anexo de ST" | Fiscal, por regra de classificação | 2A |
| **2. Incidência** | Nesta operação (UF origem/destino, regime, finalidade, data, contribuinte, CFOP), quais regimes se aplicam e por qual dispositivo? | "Compra interestadual para revenda, destinatário MG contribuinte → há ST por antecipação conforme dispositivo Y" | Fiscal, por regra de incidência | 2A |
| **3. Cálculo** | Quanto? Com qual base, MVA, alíquota, arredondamento e memória? | — | Fiscal, por cenário da matriz #3 com caso comparativo | **2B** |

Consequências no código:

- Tipos distintos no domínio: `ProductClassification`, `IncidenceDetermination`, `CalculationResult` (este último já existe e continua retornando `pendingReview` na 2A).
- Um portão explícito `CalculationGate` exige `IncidenceDetermination` coberta **e** uma `CalculationRuleApproval` (inexistente na 2A) — na 2A ele sempre responde `CALCULO_NAO_HOMOLOGADO`. Teste garante isso.
- A decisão de revisão da Sprint 1 (`review_items` HOMOLOGADO) passa a ser lida como **decisão de classificação** (camada 1) e nunca como incidência ou cálculo.

## 3. Catálogo de fontes normativas

### 3.1 Fontes oficiais e hierarquia

Somente fontes oficiais são normativas. Ferramentas de confronto e bases de terceiros são registradas como tal e nunca fundamentam uma regra sozinhas.

| Fonte | Tipo | Uso | Observação |
|---|---|---|---|
| RICMS/2023 MG — Decreto 48.589/2023 | Decreto estadual | normativa | https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/sumario2023_1.html |
| RICMS/2023 MG — Anexo VII (ST) | Decreto estadual | normativa | https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexovii2023_1.html |
| Convênio ICMS 142/2018 e alterações | Convênio CONFAZ | normativa (CEST, segmentos, regras gerais de ST) | localizar e registrar a publicação oficial no CONFAZ e o *Diário Oficial*, por versão/alteração |
| Tabela NCM vigente | Ato federal | validação de NCM | registrar ato, data e origem oficial do arquivo usado |
| Tabela de CFOP | Convênio SINIEF | validação CFOP × finalidade | confirmar o ato oficial vigente antes de importar |
| ST MinasGerais (SEF/MG) | Ferramenta oficial de consulta | **confronto**, não fundamento | https://www.fazenda.mg.gov.br/empresas/substituicao_tributaria/stminasgerais.html |
| Econet e bases privadas | Conteúdo licenciado | **bloqueado** até confirmação de licença | sem coleta automatizada, sem cópia de texto, sem uso em prompts |
| Interpretação do escritório | Orientação interna | complementa, nunca substitui norma | registrada como tipo próprio, com autor e data |

Texto de lei, decreto e convênio publicado oficialmente pode ser armazenado (atos oficiais não são objeto de proteção autoral — Lei 9.610/1998, art. 8º, IV). Compilações, comentários e consolidações de terceiros podem ser protegidos: guardar só a referência.

### 3.2 Modelo de dados (proposta — migrações novas, nada altera tabelas existentes)

```
legal_sources            -- a norma
  id, kind (LEI|DECRETO|CONVENIO|PROTOCOLO|AJUSTE_SINIEF|PORTARIA|RESOLUCAO|ATO_TABELA|FERRAMENTA_CONFRONTO|INTERPRETACAO_ESCRITORIO)
  jurisdiction (FEDERAL|CONFAZ|UF), uf (nullable), issuer (órgão), number, title
  published_at (date), official_url, normative (bool: false p/ confronto e interpretação)
  license_status (OFICIAL_PUBLICO|LICENCIADO_CONFIRMADO|LICENCA_NAO_VERIFICADA)  -- regra só aprova com OFICIAL_PUBLICO ou LICENCIADO_CONFIRMADO + referência do contrato
  created_by, created_at

legal_source_snapshots   -- proveniência: o que exatamente foi consultado
  id, source_id, retrieved_at, retrieved_by, url, method (MANUAL|IMPORTACAO_ASSISTIDA)
  content_sha256, storage_ref (área restrita; nunca no Git), notes

legal_provisions         -- o dispositivo citado
  id, source_id, reference (art./§/inciso/anexo/parte/item), heading, official_text (opcional; só fonte pública)
  effects_from (date), effects_to (date|null), published_at, snapshot_id

legal_amendments         -- norma nova que altera/revoga dispositivo anterior
  id, amending_provision_id, amended_provision_id, kind (ALTERA|REVOGA|ACRESCENTA|PRORROGA)
  effects_from (date), registered_by, registered_at
  -- ao registrar: dispara reavaliação das regras que citam o dispositivo alterado (seção 6.3)

tax_rules                -- a regra curada pelo escritório (cabeçalho estável)
  id, layer (CLASSIFICACAO|INCIDENCIA), kind (SEGMENTO_ST|INCIDENCIA_ST|INCIDENCIA_ANTECIPACAO|INCIDENCIA_DIFAL|INCIDENCIA_ST_INTERNA|OUTRO)
  code (legível e único), organization_id (regras são do escritório; empresas não têm regras próprias)

tax_rule_versions        -- append-only; nunca UPDATE de conteúdo
  id, rule_id, version, status (RASCUNHO|EM_REVISAO_TECNICA|APROVADA|ATIVA|SUSPENSA|SUBSTITUIDA|REVOGADA)
  conditions (jsonb VALIDADO por schema Zod versionado — seção 3.3), effects_from, effects_to
  author_id, created_at, superseded_by_version_id, change_reason
  -- sem colunas de alíquota/MVA/base: a 2A não calcula

tax_rule_version_provisions  -- n:m; toda versão APROVADA cita >= 1 dispositivo normativo
  rule_version_id, provision_id, role (FUNDAMENTO|EXCECAO|CONFRONTO)

tax_rule_approvals       -- workflow e responsáveis
  id, rule_version_id, step (REVISAO_TECNICA|APROVACAO_FISCAL|ATIVACAO|SUSPENSAO|REVOGACAO)
  decided_by, decided_at, decision (APROVA|DEVOLVE), justification
  -- regra de quatro olhos: aprovador != autor (constraint + teste)
```

Workflow: `RASCUNHO → EM_REVISAO_TECNICA → APROVADA → ATIVA`; `ATIVA → SUSPENSA | SUBSTITUIDA | REVOGADA`. Só `ATIVA` conta como cobertura. Conteúdo gerado por IA entra **sempre** como `RASCUNHO` com `method = IMPORTACAO_ASSISTIDA` e exige revisão humana. Toda transição grava `audit_events` na mesma transação.

### 3.3 Condições tipadas (não JSON livre)

`conditions` segue um schema versionado (`conditionsSchemaVersion`), validado no backend:

```ts
type RuleConditions = {
  schemaVersion: 1;
  // Camada 1 (classificação): todos os critérios são conjuntivos
  ncm?: { include: NcmPattern[]; exclude?: NcmPattern[] };      // código completo ou prefixo explícito ("8708", "87083090")
  cest?: { include: string[] } | { required: false };
  descriptionSignals?: { mustMatchAny?: string[]; mustNotMatch?: string[] }; // SINAL de divergência, nunca critério único
  segment?: string;                                              // segmento normativo resultante da classificação
  // Camada 2 (incidência)
  segmentIn?: string[];
  ufOrigem?: UF[]; ufDestino?: UF[];
  regimeDestinatario?: RegimeTributario[];
  contribuinteIcms?: boolean;
  finalidade?: FinalidadeProduto[];                              // NAO_INFORMADA nunca casa
  cfop?: string[];
  regimeEspecial?: { requires?: string[]; excludes?: string[] }; // parâmetros do perfil fiscal
};
```

Regras de casamento: ausência de um fator **exigido** pela regra gera `DADOS_INSUFICIENTES`, nunca "casa por omissão". **Nunca classificar só por NCM ou só por CNAE** (Issue #4): uma regra de classificação precisa de NCM **e** de pelo menos mais um critério (CEST ou sinais de descrição com aprovação explícita); o validador recusa a versão caso contrário.

## 4. Contexto de avaliação e proveniência de cada fator

O resolvedor monta um `EvaluationContext` por item, na **data da operação** (emissão), e registra a origem de cada fator:

| Fator | Origem | Validação |
|---|---|---|
| NCM, CEST, descrição, CFOP, CST/CSOSN, origem, valores | XML (imutável, SHA-256) | NCM na tabela vigente; CEST × NCM compatível (Conv. 142/2018); formato |
| UF emitente/destinatário, data de emissão, CRT do emitente | XML | coerência com o cadastro |
| Regime, CNAE, contribuinte, regimes especiais/TTD | perfil fiscal **vigente na data** (`company_fiscal_profiles`) | sem perfil vigente → `DADOS_INSUFICIENTES` |
| Finalidade | **declarada pelo cliente por item** (nova entidade `item_declarations`, auditada) ou padrão por produto confirmado pelo Fiscal | `NAO_INFORMADA` → `DADOS_INSUFICIENTES` com ação "informar finalidade" |
| Segmento | derivado da camada 1 | ≥ 2 candidatos → `DIVERGENCIA (CLASSIFICACAO_AMBIGUA)` |

Cada fator no contexto carrega `{ value, source: "XML"|"PERFIL_FISCAL"|"DECLARACAO_CLIENTE"|"DERIVADO", sourceRef, observedAt }`. O contexto inteiro é gravado junto da avaliação (seção 7).

## 5. Estados de triagem

Estado **novo e separado** do `classificationStatus` da Sprint 1 (que continua sendo o status da revisão humana). Nomes propostos; a nomenclatura final é decisão de produto.

| Estado | Significado | Vai para a fila do Fiscal? | O cliente vê |
|---|---|---|---|
| `COBERTO_REGRA_HOMOLOGADA` | Exatamente uma classificação e um conjunto de incidência **ATIVOS**, vigentes na data, com todos os fatores exigidos presentes e sem sinal de divergência | **Não** (no modo por exceção) | enquadramento, incidência, dispositivo, versão da regra — e "valores: cálculo ainda não homologado" |
| `DIVERGENCIA` | Evidência concreta de inconsistência (subtipos abaixo) | Sim, com motivo objetivo | "em análise pelo Fiscal" + motivo resumido |
| `DADOS_INSUFICIENTES` | Falta fator exigido (finalidade, perfil fiscal vigente, CEST exigido, descrição genérica demais) | Não, enquanto o dado puder vir do cliente; Sim se só o Fiscal pode resolver | o que falta e como informar |
| `SEM_COBERTURA` | Nenhuma regra ativa cobre o contexto; nada indica erro | Vai para o **backlog de cobertura** (agrupado por NCM/segmento), não item a item | "sem regra homologada" |
| `REVISAR_MUDANCA_LEGAL` | Havia cobertura/decisão, mas dispositivo foi alterado, regra substituída/expirada, ou o contexto mudou (regime, UF, finalidade, data) | Sim | "reavaliação por mudança legal" |

Subtipos de `DIVERGENCIA` (cada um com evidência `{campo, valor no XML, esperado, dispositivo}`):

- `NCM_INEXISTENTE_NA_DATA` — NCM não consta da tabela vigente na emissão.
- `CEST_INCOMPATIVEL_NCM` — CEST não corresponde ao NCM no anexo vigente.
- `DESCRICAO_INCOMPATIVEL_SEGMENTO` — ex.: NCM/CEST de material de construção com descrição de autopeça (caso ilustrativo da reunião de 13/11).
- `CLASSIFICACAO_AMBIGUA` — mais de um segmento candidato.
- `REGRAS_CONFLITANTES` — mais de uma regra de incidência ativa com conclusões diferentes.
- `CFOP_INCOMPATIVEL_FINALIDADE` — ex.: CFOP de revenda com finalidade uso/consumo declarada.
- `XML_DIVERGE_DA_REGRA` — ex.: CST/valores indicam ST retida e a regra conclui não-incidência (ou o contrário). Achado já registrado em `docs/VALIDACAO_FISCAL.md`.

**Precedência determinística** (o primeiro que se aplica vence; **todos** os motivos encontrados são registrados, não só o vencedor):
1. Erro de integridade do documento → item não é triado (já tratado na importação).
2. `DIVERGENCIA` da camada 1 (NCM, CEST, descrição, classificação ambígua) — depende só do XML e do catálogo; não pode ficar escondida atrás de um pedido de dado ao cliente.
3. `DADOS_INSUFICIENTES` (fatores da camada 2: finalidade, perfil fiscal vigente, regimes especiais).
4. `DIVERGENCIA` da camada 2 (regras conflitantes, CFOP × finalidade, XML × regra).
5. `REVISAR_MUDANCA_LEGAL`.
6. `SEM_COBERTURA`.
7. `COBERTO_REGRA_HOMOLOGADA`.

Um produto novo **não** é divergente por ser novo: sem regra é `SEM_COBERTURA`; com regra e dados coerentes é `COBERTO`.

## 6. Reaproveitamento seguro de classificações anteriores

### 6.1 Chave de reaproveitamento

Uma decisão (humana ou por regra) só é reaproveitada quando **todas** as condições forem iguais:

```
reuseKey = companyId
         + productFingerprint (NCM|CEST|descrição normalizada — já existe)
         + contextKey(ufOrigem, ufDestino, regime vigente, contribuinte, finalidade, CFOP-grupo, regimes especiais)
         + ruleVersionIds referenciados (camadas 1 e 2)
```

e a data de emissão estiver dentro da vigência da decisão **e** de todas as versões de regra referenciadas.

### 6.2 Quando NÃO reaproveitar (vira `REVISAR_MUDANCA_LEGAL` ou reavaliação)

- Qualquer componente do `contextKey` mudou (troca de regime no perfil fiscal, outra UF, outra finalidade).
- Alguma versão referenciada não está mais `ATIVA` na data, ou existe `legal_amendment` com `effects_from <=` data de emissão sobre dispositivo citado.
- Uma nova versão de regra aplicável foi ativada depois da decisão.
- A decisão é de **outra empresa**: no máximo sugestão para o Fiscal, nunca automático (ADR-004).
- NCM, CEST ou descrição diferentes geram outro fingerprint → avaliação nova (comportamento atual preservado).

### 6.3 Mudança legal sem reescrever o passado

- Registrar uma alteração legal ou suspender/substituir uma versão de regra **não altera** avaliações existentes.
- Gera um evento `LEGAL_CHANGE_REGISTERED { provisionId, effectsFrom }` que agenda **reprocessamento** dos itens com emissão `>= effectsFrom` que referenciam as versões afetadas; cada reprocessamento cria uma **nova** avaliação (seção 7) e, se necessário, um novo item na fila.
- Itens com emissão anterior mantêm a avaliação vigente na época (mesma semântica do `reopen` da Sprint 1 e da regra `classificationFor`).

## 7. Memória e rastreabilidade das decisões

```
item_evaluations   -- append-only; nunca UPDATE
  id, nfe_item_id, company_id, organization_id
  engine_version, catalog_snapshot_hash      -- hash do conjunto de versões ATIVAS consultadas
  context (jsonb com proveniência por fator), context_sha256
  status (estado de triagem), reasons (jsonb: código, mensagem, evidência, dispositivo)
  missing_factors, rule_version_ids, reused_from_evaluation_id
  trigger (IMPORTACAO|REPROCESSAMENTO_MUDANCA_LEGAL|DECLARACAO_CLIENTE|DECISAO_FISCAL|MANUAL)
  created_at, created_by (null = sistema)
nfe_items.current_evaluation_id              -- ponteiro para a avaliação vigente
```

- A triagem é uma **função pura** no domínio (`packages/domain/src/tributario/triagem/`): `triage(context, catalogSnapshot, priorDecisions) → TriageResult`. Mesmos insumos → mesmo resultado (testável e reproduzível).
- Toda decisão do Fiscal referencia a avaliação que a motivou e as versões de regra consideradas.
- O cliente sempre consegue ver: estado, motivo, dispositivo e versão — nunca um valor não homologado.

## 8. Testes (somente dados sintéticos)

**Regras de fixture:** normas fictícias ("Norma Sintética nº 1/2099"), URLs `https://normas.example.invalid/...`, segmentos `SEGMENTO_TESTE_*`, CNPJs gerados, XML do gerador existente. Um teste-guarda falha se uma fixture usar domínio oficial (`fazenda.mg.gov.br`, `confaz.fazenda.gov.br`, etc.) ou se uma regra de fixture tiver `license_status = OFICIAL_PUBLICO`.

Matriz mínima de decisão (domínio, função pura):

| Caso sintético | Esperado |
|---|---|
| Produto conhecido, regra ATIVA cobrindo todos os fatores | `COBERTO_REGRA_HOMOLOGADA`, não vai à fila, registra regra e versão |
| CEST incompatível com NCM | `DIVERGENCIA/CEST_INCOMPATIVEL_NCM` com evidência |
| NCM válido, descrição de outro segmento | `DIVERGENCIA/DESCRICAO_INCOMPATIVEL_SEGMENTO` |
| NCM válido, descrição genérica ("PECA DIVERSA") | `DADOS_INSUFICIENTES` (ou ambígua) — automação bloqueada |
| Finalidade `NAO_INFORMADA` | `DADOS_INSUFICIENTES`, ação "informar finalidade" |
| Perfil fiscal sem vigência na data | `DADOS_INSUFICIENTES` |
| Duas regras de incidência ativas e conflitantes | `DIVERGENCIA/REGRAS_CONFLITANTES` |
| Regra expirada antes da emissão | `REVISAR_MUDANCA_LEGAL` (se havia decisão) ou `SEM_COBERTURA` |
| Alteração legal com efeitos antes da emissão | `REVISAR_MUDANCA_LEGAL` |
| Mesma decisão, regime mudou / UF mudou / finalidade mudou | não reaproveita |
| Mesmo produto em outra empresa | não reaproveita (no máximo sugestão) |
| Nenhuma regra | `SEM_COBERTURA` (não divergência) |
| Classificação HOMOLOGADA + incidência coberta | `CalculationGate` responde `CALCULO_NAO_HOMOLOGADO` |
| Regra de classificação só com NCM | versão recusada pelo validador |

Integração (API, PGlite + PostgreSQL real): workflow e quatro olhos; auditoria na mesma transação; reprocessamento não altera avaliações anteriores; modo `OFF` idêntico à Sprint 1 (regressão); RBAC/isolamento de **toda** rota nova em `isolation.test.ts` (cliente não lê nem altera catálogo; fiscal de outra organização recebe 404); concorrência na ativação de versões (409).

Guardas permanentes: teste que falha se o esquema de `tax_rule_versions` ganhar colunas de alíquota/MVA/base; teste que falha se `CalculationGate` liberar qualquer caso na 2A.

## 9. Migração incremental — feature flag por empresa

`TRIAGE_MODE` por empresa (e global), gravado e auditado:

1. `OFF` (padrão): comportamento da Sprint 1 — todos os itens vão para a fila.
2. `SHADOW`: triagem roda e grava `item_evaluations`, mas a fila continua recebendo tudo. Relatório compara triagem × decisões humanas (concordância por estado) — é a evidência para o Fiscal autorizar o passo seguinte.
3. `EXCECOES`: itens `COBERTO_REGRA_HOMOLOGADA` deixam de entrar na fila. Ativação exige aprovação registrada do Fiscal **para a empresa e o segmento** e taxa de concordância do modo sombra aceita por ele.

Fallback seguro: erro no motor, catálogo indisponível ou estado desconhecido → item vai para a fila como na Sprint 1.

## 10. Incrementos (ordem e critério de pronto)

Cada incremento: código → testes (PGlite + PostgreSQL) → `npm run verify` → commit → HANDOFF.

1. **2A.1 Catálogo** — migrações de `legal_*` e `tax_rule*`; rotas staff-only de rascunho, revisão, aprovação (quatro olhos), ativação, suspensão; auditoria; UI mínima de cadastro. *Pronto:* uma regra sintética percorre o workflow com dois usuários; autor não aprova; cliente recebe 403/404.
2. **2A.2 Tabelas de referência** — importação curada de NCM e CEST×NCM com snapshot, hash e vigência. *Pronto:* validação de NCM/CEST por data, com proveniência visível.
3. **2A.3 Declaração de finalidade por item** — cliente informa; auditado; padrão por produto confirmado pelo Fiscal. *Pronto:* item sem finalidade fica `DADOS_INSUFICIENTES` com ação.
4. **2A.4 Motor de triagem (domínio puro)** — tipos, precedência, evidências, `CalculationGate`. *Pronto:* matriz da seção 8 verde.
5. **2A.5 Avaliações persistidas + modo SHADOW** — `item_evaluations`, ponteiro no item, tela de comparação. *Pronto:* importar com `SHADOW` grava avaliação sem mudar a fila.
6. **2A.6 Mudança legal e reprocessamento** — `legal_amendments`, evento, job idempotente. *Pronto:* alteração com efeitos em D reavalia só emissões ≥ D, sem tocar nas anteriores.
7. **2A.7 Modo EXCECOES** — habilitação por empresa/segmento com aprovação. *Pronto:* item coberto não entra na fila; demais entram com motivo; `OFF` sem regressão.

## 11. Decisões pendentes (não presumir aprovação pelo silêncio)

| # | Decisão | Responsável |
|---|---|---|
| 1 | Escopo do piloto (sugestão da #6: compras interestaduais de autopeças para revenda, destinatário contribuinte MG) | Iza/Edson + Henrique |
| 2 | Quem pode aprovar regras e se a ativação exige uma terceira pessoa | Fiscal |
| 3 | Fonte oficial e periodicidade de atualização das tabelas NCM e CEST | Fiscal |
| 4 | Licença Econet: existe contrato que permita uso? Em quais termos? | Henrique / jurídico |
| 5 | O que o cliente vê em `COBERTO` enquanto o cálculo não existe | Henrique |
| 6 | `SEM_COBERTURA`: backlog agrupado ou fila item a item | Fiscal |
| 7 | Reaproveitamento entre empresas como sugestão: sim/não | Fiscal |
| 8 | Canal de atendimento para divergências (WhatsApp/e-mail/solicitação) | Henrique |
| 9 | Nomes finais dos estados de triagem | Henrique |

## 12. Gatilho da Sprint 2B (cálculo)

Somente após a matriz da Issue #3 homologada **item a item** por Iza/Edson, com caso comparativo, norma, parâmetros, arredondamento, memória e aceite registrado. Um cenário de cálculo por vez, cada um com regressão item a item e conferência contra A10/ST MinasGerais; frete por item, frete global e CT-e sem dupla contagem; imposto a recolher, tributo recuperável e custo de estoque distintos.
