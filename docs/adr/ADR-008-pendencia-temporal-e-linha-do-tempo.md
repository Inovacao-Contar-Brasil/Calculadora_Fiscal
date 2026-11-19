# ADR-008 — Pendência temporal e linha do tempo das decisões de classificação

**Status:** proposta, aguardando revisão independente · **Data:** 2026-11-19 · **Issue:** #8 (achado 2, CF-FOUND-08-TEMPORAL) · **PR:** #10 (base `feat/sprint1-fundacao-segura`)
**Complementa:** ADR-004 (vigência das decisões), ADR-007 (catálogo e triagem, proposta)

## Contexto

Uma homologação com início de vigência em novembro **não cobre** uma NF-e de outubro. Pela regra `classificationFor`, a nota de outubro fica `PENDENTE_REVISAO`, o que está correto. Mas ela ficava sem fluxo administrativo: o único item de revisão do produto estava `HOMOLOGADO` (estado final, fora da fila de pendentes), o `PATCH` não admite transição a partir dele, e a reabertura atua só depois do fim da vigência.

Diagnóstico, com testes que falharam contra `70c5c17` (commit `48f211a`, CI [44522068608](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44522068608) vermelho no passo de testes):

1. **Causa raiz — vínculo pelo item aberto.** A importação vinculava cada item de NF-e ao item de revisão **aberto** do produto (`valid_to IS NULL`), e não à decisão que cobre a data de emissão. Consequências:
   - a nota fora da vigência ficava presa a uma decisão final, sem ação possível;
   - depois de uma reabertura, a mesma nota recebia conclusões diferentes conforme a ordem de importação. Uma nota de novembro importada antes da reabertura ficava `HOMOLOGADO`; importada depois, ficava `PENDENTE` e ligada à nova análise.
2. **Reabertura deixava órfãs.** Só movia para a nova análise as notas posteriores ao fim da vigência; as anteriores ao início ficavam presas à decisão encerrada, invisíveis na fila. Também aceitava reabrir item sem decisão final.
3. **Vigências sobrepostas aceitas.** Uma nova homologação podia começar dentro da vigência de uma decisão encerrada, com duas decisões possíveis para a mesma data.

## Requisitos

A homologação válida continua cobrindo o que cobre. Notas anteriores não são homologadas automaticamente. Toda pendência tem identidade, motivo, empresa, origem e ação. O Fiscal resolve sem alterar retroativamente a decisão válida, com histórico reprodutível. Reimportação não duplica. A ordem de importação não muda a conclusão. Mudanças de vigência e ações simultâneas não geram inconsistência. O modelo é compatível com a triagem da Sprint 2A. Nenhum cálculo tributário.

## Alternativas consideradas

| Opção | Avaliação |
|---|---|
| **A. Tabela `temporal_pendencies`** (entidade operacional persistida: aberta/resolvida, motivo, decisão de origem, contagem) | Identidade e ciclo de vida explícitos e espaço para atribuição/SLA. **Mas** cria uma segunda fonte de verdade sobre "esta nota está pendente por vigência", a sincronizar em quatro caminhos de escrita (importação, decisão, reabertura, resolução). Cada caminho exige UPSERT e índice único próprios e pode deixar pendência fantasma ou faltante numa corrida. Duplicaria o papel das `item_evaluations` da Sprint 2A (ADR-007 §6–7). Nenhum requisito exige estado que não possa ser derivado. **Rejeitada por ora** (ver "Quando reavaliar"). |
| **B. Estender/editar a homologação** (antecipar `valid_from`) | Viola "sem efeito retroativo sobre decisão válida" e o append-only das decisões (ADR-004). Além disso, a norma de outubro pode ser outra. **Rejeitada.** |
| **C. Item de revisão "de período" pendente na fila** (linhas `review_items` com escopo de datas em fluxo) | Reaproveita a fila e o `PATCH`. Porém sobrecarrega `valid_to` (fim de escopo × decisão encerrada) e exige mudar o índice parcial `review_items_open_idx`, o UPSERT e o controle otimista do PR #7. Risco alto de regressão na concorrência recém-corrigida. **Rejeitada.** |
| **D. Projeção derivada + decisão de período append-only + regra única de vínculo** | Nenhuma estrutura nova além de um índice. A pendência deriva do estado autoritativo, então não duplica nem diverge. A resolução usa o mesmo artefato que já existe (decisão com vigência em `review_items`). **Escolhida.** |

## Decisão

### Invariantes da linha do tempo (por empresa + fingerprint do produto)

1. **I1 — Um item aberto.** Existe exatamente um item de revisão com `valid_to IS NULL` (índice parcial existente), que é a análise em curso.
2. **I2 — Vigências disjuntas.** As decisões finais (`HOMOLOGADO`/`REJEITADO`) cobrem `[valid_from, valid_to]` e não se sobrepõem. Por isso:
   - a decisão final do item aberto (`PATCH`) tem de começar **depois** do fim da última decisão encerrada (422). Sem data informada, começa em `max(hoje, fim + 1 dia)`;
   - a decisão de período tem de caber inteira numa lacuna (409 se invadir outra decisão; 422 se invadir a própria homologação que originou a pendência);
   - `CHECK (valid_from <= valid_to)` no banco (migração `0001`).
3. **I3 — Vínculo único** (`selectReviewFor`, `classification.ts`). A nota pertence à decisão final cuja vigência contém a emissão; senão, ao item aberto. O status vem de `classificationFor` sobre esse vínculo. Por I2, no máximo uma decisão cobre a data, e o resultado independe da ordem de importação. Com dados antigos inconsistentes (duas decisões encerradas cobrindo a data), nenhuma é escolhida: a nota fica no item aberto, sem homologação presumida.
4. **I4 — Serialização.** Toda escrita que muda a linha do tempo passa pelo lock da linha aberta do produto:
   - decisão final: `SELECT … FOR UPDATE` em `lockOpenReview`;
   - reabertura: o `UPDATE` condicional trava a linha;
   - decisão de período: `lockOpenReview`;
   - importação: o `UPSERT ... ON CONFLICT DO UPDATE` trava a mesma linha. Os produtos são processados em ordem fixa de fingerprint, o que dá ordem de lock determinística entre importações.

   A linha do tempo é lida e validada depois do lock.

### Pendência temporal (projeção)

- **Definição:** item de NF-e `PENDENTE_REVISAO` vinculado a uma decisão `HOMOLOGADO`. Por I3, é uma nota que nenhuma decisão cobre, presa a uma homologação vigente que começa depois dela.
- **Identidade:** a homologação que não cobre as notas (`id` = id do item de revisão). Uma pendência por decisão.
- **Motivo:** `EMISSAO_ANTERIOR_A_VIGENCIA`, `EMISSAO_POSTERIOR_A_VIGENCIA` ou `EMISSAO_FORA_DA_VIGENCIA`, mais um texto em pt-BR.
- **Empresa e origem:** quantidade de itens e de NF-e, primeira e última emissão; o detalhe traz as ocorrências.
- **Ação:** `REGISTRAR_DECISAO_DO_PERIODO`.
- **Rotas, todas staff-only.** Escopo antes do papel: fora do escopo e inexistente devolvem o mesmo 404; cliente com acesso recebe 403.
  - `GET /api/temporal-pendencies?companyId=` lista as pendências.
  - `GET /api/temporal-pendencies/:id` traz as ocorrências, as `uncoveredPeriods` (lacunas de vigência com notas) e as decisões do produto.
  - `POST /api/temporal-pendencies/:id/resolve` recebe `{ status: HOMOLOGADO|REJEITADO, validFrom, validTo?, decision?, justification }`. Cria uma decisão final **nova** com vigência `[validFrom, validTo]` (por padrão, `validTo` = fim da lacuna) e vincula a ela as notas do produto emitidas no período. Grava `TEMPORAL_PENDENCY_RESOLVED` na mesma transação e devolve 201. A homologação original não é tocada (teste compara o objeto antes/depois).
- **Duplicação e ordem:** a pendência é uma agregação, então reimportar não a duplica (a importação já é idempotente por chave de acesso). Uma nota futura do período resolvido herda a decisão do período; uma nota anterior a tudo abre de novo a pendência, sem homologação automática.

### Mudanças de semântica em rotas existentes

- `POST /api/review-items/:id/reopen`:
  - exige decisão final (422 para pendente/em análise, que não têm vigência a encerrar);
  - leva à nova análise **toda** nota que a decisão encerrada não cobre, inclusive as anteriores ao início, que antes ficavam órfãs. Vale também para rejeição: notas anteriores ao `valid_from` de uma rejeição encerrada vão para a nova análise (`PENDENTE`), o lado conservador.
- `PATCH /api/review-items/:id` com status final: aplica I2, com 422 se a vigência começar antes do fim da decisão encerrada.
- `GET /api/review-items/:id`: novo campo `outOfValidityItems`.
- Auditoria: `outOfValidityItems` em `NFE_IMPORTED` e `REVIEW_*`; `movedItems` em `REVIEW_REOPENED`.

## Compatibilidade com a Sprint 2A

- As decisões finais em `review_items`, inclusive as de período, são exatamente as "decisões de classificação (camada 1) com vigência" que a 2A lê (ADR-007 §1, especificação §2 e §6). `selectReviewFor` é o "reaproveitamento dentro da vigência" da §6.1, restrito a empresa + produto. O contexto completo da operação continua sendo papel da triagem.
- A pendência temporal é derivada, então não há tabela a migrar quando `item_evaluations` (2A.5) existir. A triagem pode passar a expor o mesmo caso como estado próprio (por exemplo `REVISAR_MUDANCA_LEGAL` ou `SEM_COBERTURA` no período), e a projeção pode ser reescrita sobre as avaliações.
- Nenhuma alteração no catálogo legal da 2A.1 (PR #9).

## Quando reavaliar (o que tornaria uma tabela necessária)

- Atribuição de responsável, SLA, comentários ou estado "ciente, ainda sem decisão" por pendência: é estado não derivável.
- Volume em que a agregação (`nfe_items` × `review_items`, indexada por `nfe_items_review_item_idx`) fique cara na listagem.
- Exigência de defesa no banco para I2: `EXCLUDE USING gist` com `btree_gist`, que depende da extensão no PostgreSQL de produção (hospedagem ainda não decidida) e no PGlite (contrib a carregar). A ADR-004 já previa reavaliar quando houvesse correção retroativa, e agora há.

## Consequências

- O Fiscal trata a nota fora da vigência registrando a decisão do período; a homologação válida permanece intacta e o histórico mostra todas as versões.
- A conclusão fiscal de cada nota passa a ser função de (linha do tempo, data de emissão), não do momento da importação. O verificador de invariantes dos testes confere isso no estado persistido.
- I2 é garantida pela aplicação (lock + validação). Testes de mutação mostram que, sem o lock, resoluções concorrentes criam decisões sobrepostas no PostgreSQL real; com o lock, uma vence e as demais recebem 409.
- `occurrences` e `last_document_id` do item aberto continuam contando todas as NF-e importadas do produto, como antes. A reabertura já copiava esse contador. Uma nota vinculada a uma decisão encerrada ou de período também incrementa o item aberto. As ocorrências exatas de cada decisão vêm de `nfe_items.review_item_id` (detalhe da revisão e da pendência). A decisão de período registra a própria contagem de NF-e.
- Bancos de **desenvolvimento** criados antes desta mudança podem conter notas presas a decisões encerradas fora da vigência; esta versão não as reclassifica retroativamente. Não há dados de produção. Recomendação: recriar `apps/api/.data`.
