# Catálogo legal versionado — Sprint 2A.1

**Status:** implementado e testado (PGlite + PostgreSQL 16) na branch `feat/sprint2a1-catalogo-legal`, PR dependente do PR #7. **Não homologado por pessoas.** Detalhes de produto: `docs/SPRINT2A_ESPECIFICACAO.md` (seções 3 e 10.1). Decisão: `docs/adr/ADR-007-catalogo-legal-e-triagem.md`.

> O catálogo **não calcula nada** e regras ATIVAS **ainda não são aplicadas a NF-e** (isso começa na 2A.4/2A.5). A capacidade técnica de ativar uma versão **não é** autorização de negócio para usar uma regra tributária real: essa autoridade ainda depende de Henrique/Iza/Edson (decisão nº 2).

## 1. Modelo de dados (migrações `0001_catalogo_legal` e `0002_catalogo_legal_integridade`)

Todas as tabelas têm `organization_id`. Referências entre tabelas usam **FKs compostas com `organization_id`** — o banco impede que a organização A cite fonte, snapshot, dispositivo ou versão da organização B.

| Tabela | Papel | Pontos-chave |
|---|---|---|
| `legal_sources` | A norma (ou ferramenta/interpretação/base registrada como tal) | `kind` (11 espécies), `jurisdiction` + `uf`, `issuer`, `number`, `title`, `published_at`, `official_url`; `normative` derivado da espécie (CHECK); `license_status` (`OFICIAL_PUBLICO`, `LICENCIADO_CONFIRMADO` + `license_reference` obrigatória, `LICENCA_NAO_VERIFICADA`, `INTERNO` só para interpretação). Única por (org, espécie, jurisdição, UF, número, publicação). Só a licença pode mudar (trigger). |
| `legal_source_snapshots` | Proveniência: o que foi consultado | `retrieved_at`, `retrieved_by`, `url`, `method` (`MANUAL`/`IMPORTACAO_ASSISTIDA`), `content_sha256`, `storage_ref`. Imutável. Único por (fonte, hash). O conteúdo enviado serve só para o servidor calcular o hash; **não é armazenado**. |
| `legal_provisions` | Dispositivo citado | `reference`, `heading`, `official_text` (só fonte oficial pública) + `official_text_sha256`, `published_at` **separado** de `effects_from`/`effects_to`, `snapshot_id` obrigatório (FK composta garante que o snapshot é da mesma fonte). Encerramento de efeitos: uma vez, sem ampliar a vigência, com autor/motivo/data; nada é apagado. |
| `tax_rules` | Cabeçalho estável da regra | `layer` (`CLASSIFICACAO`/`INCIDENCIA`), `kind` coerente com a camada (CHECK), `code` único por organização. Imutável. |
| `tax_rule_versions` | Versões append-only | `version` sequencial, `status`, `conditions` (jsonb validado) + `conditions_schema_version`, `content_sha256` (JSON canônico de condições + vigência + dispositivos), `effects_from`/`effects_to` (previstos, imutáveis), `effects_ended_on` (encerramento por substituição/revogação), `author_id`, `superseded_by_version_id`. Uma versão ATIVA e uma EM_REVISAO_TECNICA por regra (índices parciais). **Sem colunas de alíquota, MVA, base ou valor.** |
| `tax_rule_version_provisions` | Dispositivos citados (n:m) | `role`: `FUNDAMENTO`, `EXCECAO`, `CONFRONTO`, `INTERPRETACAO`. Só podem ser gravados na transação que cria a versão (trigger). |
| `tax_rule_approvals` | Trilha do workflow | `action`, `from_status`, `to_status`, `decided_by`, `decided_at` (sempre o instante da transação no servidor), `justification`, `authorization_reference`, `version_author_id` (cópia garantida por FK composta). CHECKs: transição válida, **quatro olhos** (`decided_by <> version_author_id` em APROVA/DEVOLVE/ATIVA/REATIVA), justificativa e referência de autorização. Uma APROVA e uma ATIVA por versão. Imutável. |

### Garantias no próprio banco (migração 0002)

- `DELETE` proibido em todas as tabelas do catálogo.
- Conteúdo imutável; só mudam colunas de ciclo de vida (licença da fonte, encerramento de efeitos do dispositivo, status/encerramento/substituição da versão).
- Versão nasce `RASCUNHO`. **Mudança de status exige linha correspondente em `tax_rule_approvals` na mesma transação**; a trilha precisa partir do status atual.
- Testes em `apps/api/src/db/catalog-schema.test.ts` tentam burlar tudo isso com SQL direto.

### `legal_amendments` — adiado de propósito

Não foi criada. Uma tabela de alterações sem o reprocessamento da 2A.6 daria a falsa impressão de que a mudança legal está sendo tratada. Na 2A.1 a alteração é registrada **encerrando os efeitos do dispositivo** (`POST /api/legal-provisions/:id/close-effects`, que devolve as versões que o citam) e cadastrando o novo dispositivo; versões cujo fundamento não cobre mais a vigência ficam bloqueadas para submissão/aprovação/ativação (`VIGENCIA_ALEM_DO_FUNDAMENTO`). A 2A.6 cria `legal_amendments` e o reprocessamento.

## 2. Condições de aplicação — `RuleConditions` v1

Tipos no domínio (`packages/domain/src/catalogo/conditions.ts`); schema Zod estrito em `apps/api/src/modules/catalog/conditions.ts`, verificado em tempo de compilação contra os tipos do domínio. Campo desconhecido em qualquer nível é **recusado** (não ignorado).

**Classificação** (`layer: "CLASSIFICACAO"`): `ncm.include` (8 dígitos ou prefixo de 4–7; capítulo isolado recusado), `ncm.exclude` (contido em algum incluído), `cest` (`{ include: [...] }` ou `{ required: false }`), `descriptionSignals` (`mustMatchAny`, `mustNotMatch`, termos literais, sem regex; `acceptedAsCriterion`), `segment` (obrigatório).
- **Nunca só por NCM:** exige CEST incluído ou `descriptionSignals.mustMatchAny` com `acceptedAsCriterion: true` (aceite explícito, revisado na aprovação).
- **Nunca por CNAE:** não existe critério de CNAE no v1.

**Incidência** (`layer: "INCIDENCIA"`): `segmentIn` (obrigatório), `ufDestino` (obrigatório — salvaguarda técnica, a confirmar pelo Fiscal), `ufOrigem`, `regimeDestinatario`, `contribuinteIcms`, `finalidade` (`NAO_INFORMADA` recusada), `cfop` (4 dígitos, 1/2/3/5/6/7), `regimeEspecial.requires/excludes` (chaves do perfil fiscal).

Recusados também: repetições, termo exigido e proibido ao mesmo tempo, parâmetro exigido e excluído, `regimeEspecial` vazio, camada das condições diferente da camada da regra (422), qualquer campo numérico de cálculo. `schemaVersion` fica gravado em cada versão.

**A 2A.1 só cadastra e valida.** Nenhuma condição é interpretada sobre itens de NF-e antes da 2A.4.

## 3. Workflow

```
RASCUNHO ──submit──▶ EM_REVISAO_TECNICA ──approve──▶ APROVADA ──activate──▶ ATIVA
   ▲                        │                                                 │  ▲
   └─────────return─────────┘                                         suspend │  │ reactivate
                                                                              ▼  │
RASCUNHO/APROVADA/ATIVA/SUSPENSA ──(efeito colateral)──▶ SUBSTITUIDA      SUSPENSA
ATIVA/SUSPENSA ──revoke──▶ REVOGADA
```

- Tabela única em `packages/domain/src/catalogo/workflow.ts`; o banco repete as mesmas transições em CHECK.
- **Conteúdo nunca é editado.** Alteração material = nova versão. Criar versão nova substitui (SUBSTITUIDA) o rascunho anterior; com versão em revisão técnica, a criação é recusada (409).
- **Ativar** a versão N substitui a versão ATIVA/SUSPENSA anterior (registra `effects_ended_on` = véspera do início de N quando há sobreposição) e versões APROVADAS mais antigas. Só ativa versão mais recente e com início posterior.
- **Prontidão** (submeter, aprovar, ativar, reativar): ao menos um `FUNDAMENTO` de norma oficial; nenhuma fonte com licença não verificada; fundamento produzindo efeitos no início da versão e cobrindo toda a sua vigência. Recalculada a cada etapa (licença e vigência podem mudar).
- Fontes × papéis: norma oficial → `FUNDAMENTO`/`EXCECAO`; ferramenta de confronto e base licenciada → `CONFRONTO`; interpretação do escritório → `INTERPRETACAO`.
- **Concorrência:** cada transição bloqueia a regra (`SELECT … FOR UPDATE`), relê a versão e aplica atualização condicional; quem chega depois recebe **409** (`INVALID_TRANSITION` ou `CONFLICT`). `expectedStatus` opcional no corpo detecta tela desatualizada. Índices únicos são a barreira final (violação → 409). Auditoria e trilha na mesma transação: tentativa recusada não deixa rastro de sucesso.

## 4. Matriz de permissões

| Ação | admin | fiscal | cliente (mesma org.) | outra organização / sem sessão |
|---|---|---|---|---|
| Listar fontes, dispositivos, regras | ✓ | ✓ | 403 | 404 / 401 |
| Ler fonte, regra, versão, histórico por ID | ✓ | ✓ | 404 (igual a inexistente) | 404 / 401 |
| Cadastrar fonte, snapshot, dispositivo | ✓ | ✓ | 403/404 | 404 / 401 |
| Alterar situação de licença | ✓ | 403 | 404 | 404 / 401 |
| Encerrar efeitos de dispositivo | ✓ | ✓ | 404 | 404 / 401 |
| Criar regra / nova versão | ✓ | ✓ | 403/404 | 404 / 401 |
| Submeter | ✓ | ✓ (inclusive o autor) | 404 | 404 / 401 |
| Aprovar / devolver | ✓ se ≠ autor | ✓ se ≠ autor | 404 | 404 / 401 |
| Ativar / reativar | ✓ se ≠ autor (+ ≠ aprovador com `RULE_ACTIVATION_REQUIRES_THIRD_PERSON=true`) | 403 | 404 | 404 / 401 |
| Suspender / revogar | ✓ | 403 | 404 | 404 / 401 |

Organização sempre resolvida pela URL conferida contra as associações do usuário autenticado; corpos são estritos e recusam `organizationId`. Testes: `apps/api/src/modules/isolation.test.ts` (bloco "isolamento do catálogo legal"). **Restrição de ativação a admin é provisória** até a decisão nº 2.

## 5. Endpoints

| Método e rota | Função |
|---|---|
| `GET/POST /api/organizations/:id/legal-sources` | listar (filtros `kind`, `q`) / cadastrar fonte |
| `GET /api/legal-sources/:id` | fonte + snapshots + dispositivos (+ versões que os citam) |
| `PATCH /api/legal-sources/:id/license` | situação de licença (admin; justificativa) |
| `POST /api/legal-sources/:id/snapshots` | snapshot (conteúdo → hash no servidor, ou hash informado) |
| `POST /api/legal-sources/:id/provisions` | dispositivo |
| `POST /api/legal-provisions/:id/close-effects` | encerrar efeitos (devolve versões afetadas) |
| `GET /api/organizations/:id/legal-provisions` | busca de dispositivos (`q`) |
| `GET/POST /api/organizations/:id/tax-rules` | listar (`layer`) / criar regra com versão 1 |
| `GET /api/tax-rules/:id` | regra + versões + trilha + auditoria |
| `POST /api/tax-rules/:id/versions` | nova versão |
| `GET /api/tax-rule-versions/:id` | versão + dispositivos + trilha + prontidão + operações disponíveis |
| `POST /api/tax-rule-versions/:id/{submit,approve,return,activate,suspend,reactivate,revoke}` | transições (corpo: `justification`, `authorizationReference`, `effectsEndedOn`, `expectedStatus` conforme a operação) |

Eventos de auditoria: `LEGAL_SOURCE_CREATED`, `LEGAL_SOURCE_LICENSE_CHANGED`, `LEGAL_SOURCE_SNAPSHOT_CREATED`, `LEGAL_PROVISION_CREATED`, `LEGAL_PROVISION_EFFECTS_CLOSED`, `TAX_RULE_CREATED`, `RULE_VERSION_CREATED`, `RULE_VERSION_{SUBMITTED,APPROVED,RETURNED,ACTIVATED,SUSPENDED,REACTIVATED,REVOKED,SUPERSEDED}`.

## 6. Interface

Menu **Catálogo legal** (admin/fiscal): `/catalogo` (abas Regras e Fontes), `/catalogo/fontes/:id`, `/catalogo/regras/:id`, `/catalogo/versoes/:id`. Os botões de workflow vêm de `availableOperations` da API; a tela não decide permissão.

## 7. Dados de teste

Somente sintéticos: "Norma Sintética nº N/2099", URLs `https://normas.example.invalid/…`, segmentos `SEGMENTO_TESTE_*`, CNPJs gerados. `apps/api/src/guards.test.ts` falha se teste/fixture citar domínio oficial ou base licenciada real, se o catálogo ganhar coluna/código de cálculo ou se surgir implementação concreta das interfaces de cálculo.

**Divergência com a especificação (seção 8):** ela pede guarda que falhe se fixture tiver `license_status = OFICIAL_PUBLICO`. Isso impediria o critério de pronto da 2A.1 (regra sintética percorrer o workflow até ATIVA, que exige fonte oficial ou licenciada confirmada). Mantida a fixture `OFICIAL_PUBLICO` com URL `.invalid` e a guarda de domínios; registrar a decisão na revisão.
