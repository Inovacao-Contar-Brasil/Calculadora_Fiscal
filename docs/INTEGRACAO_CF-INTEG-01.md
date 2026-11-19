# CF-INTEG-01 — Pré-integração: fundação + correção temporal + catálogo legal

> Relatório da branch experimental `feat/cf-integ-temporal-catalogo-preflight`. **Nada foi mergeado.** `main`, `feat/sprint1-fundacao-segura` (PR #7), `feat/sprint2a1-catalogo-legal` (PR #9) e `feat/cf-found-08-temporal` (PR #10) não foram alterados, e nenhum PR foi modificado. Também não houve integração da branch Premium, dados reais, homologação fiscal, cálculo tributário nem mudança em banco persistente. Data: 19/11/2026.

## 1. HEADs utilizadas

| PR | Branch | HEAD | Base | Estado | CI da HEAD |
|---|---|---|---|---|---|
| [#7](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/7) | `feat/sprint1-fundacao-segura` | `70c5c17063e1` | `main` @ `82b7497` | draft, aberto | [44074878173](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44074878173) verde |
| [#9](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/9) | `feat/sprint2a1-catalogo-legal` | `31e272da4840` | `70c5c17` | draft, aberto | [44310149018](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44310149018) verde |
| [#10](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/10) | `feat/cf-found-08-temporal` | `20d7d3347dee` | `70c5c17` | draft, aberto | [44534055241](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44534055241) verde |

- `merge-base(#9, #10) = 70c5c17`.
- A branch experimental parte de `20d7d33` e foi criada num worktree isolado (`.claude/worktrees/cf-integ-preflight`).
- Os commits do PR #9 entraram por `cherry-pick -x`, que simula o rebase do PR #9 sobre a fundação já com o PR #10.

**Comentários de auditoria lidos:** PR #10, [auditoria preliminar](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/10#issuecomment-7010097493) (P1/P2), [remediação R2](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/10#issuecomment-7010605761) e [revisão R2](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/10#issuecomment-7010713260). A revisão R2 define o bloqueio **P1-INT** e o plano que este trabalho executa.

## 2. Diagnóstico das migrações

| | PR #9 | PR #10 |
|---|---|---|
| idx 1 | `0001_catalogo_legal` (when 1795005761201): 9 enums, 7 tabelas, FKs compostas, índices parciais | `0001_temporal_pendencias` (when 1795090619177): índice `nfe_items_review_item_idx` e `CHECK review_items_vigencia_ordenada_chk` |
| idx 2 | `0002_catalogo_legal_integridade` (when 1795005766827), custom: 9 funções e 17 triggers append-only/workflow | `0002_rejeicao_fora_da_vigencia` (when 1795094504588): só dados, idempotente, auditada |
| Snapshots | `meta/0001_snapshot.json` e `0002` com o catálogo, **sem** o índice e o CHECK temporais | `meta/0001` e `0002` com o temporal, **sem** o catálogo |
| Objetos em comum | nenhum: o catálogo só cria tabelas novas e o temporal só toca `nfe_items` e `review_items` | |

**Conclusões:**

1. Os conjuntos de DDL são **independentes e comutáveis**. Não compartilham tabela, tipo, função, trigger nem índice. Isso é provado na seção 4: a ordem catálogo → temporal (reconciliação) e a ordem temporal → catálogo (upgrade) dão a mesma impressão digital de esquema.
2. **Bloqueio estrutural real, além da colisão de nomes.** O migrator do Drizzle 0.45 (`pg-core/dialect.js`) aplica as entradas com `when` maior que o `created_at` do último registro e **não compara hash**. O `when` do catálogo é anterior ao das temporais. Renomear o catálogo para 0003/0004 sem refazer o journal faz um banco em 0002 temporal **pular o catálogo em silêncio**: o teste demonstra, e é a mutação H7. O mesmo já acontece hoje entre as branches originais: um banco de dev que rodou o PR #10 e depois o PR #9 nunca recebe o catálogo.
3. Um banco com o histórico do PR #9 falha ao receber a sequência canônica (`type "legal_jurisdiction" already exists`). Tudo é desfeito, mas sem orientação. Por isso há guarda e reconciliação (seção 3).

## 3. Histórico reconciliado

| idx | Migração | when | sha256 | Origem / evidência |
|---|---|---|---|---|
| 0 | `0000_fundacao` | 1794580964727 | `a92feef3…1d763` | igual em `70c5c17`, `31e272d` e `20d7d33` |
| 1 | `0001_temporal_pendencias` | 1795090619177 | `bf33b62c…73bfd` | igual a `20d7d33` |
| 2 | `0002_rejeicao_fora_da_vigencia` | 1795094504588 | `ae605851…01400` | igual a `20d7d33` |
| 3 | `0003_catalogo_legal` | 1795097114553 | `60727833…351c` | **regerada** com `drizzle-kit generate` sobre o esquema unido; **byte a byte** igual a `0001_catalogo_legal.sql` do PR #9 |
| 4 | `0004_catalogo_legal_integridade` | 1795097128430 | `152d8252…dbbc` | `drizzle-kit generate --custom` + conteúdo **byte a byte** igual a `0002_catalogo_legal_integridade.sql` do PR #9 |

Verificações:

- Cadeia de snapshots `9ba94f19 → 7300369b → acfba846 → 4d7ced5c → 49fbb505`.
- As tabelas e os enums do catálogo no snapshot 0003 são iguais aos do PR #9, e `nfe_items`/`review_items` iguais aos do PR #10, comparados em JSON canônico. O snapshot 0004 é igual ao 0003, exceto id e prevId.
- `when` estritamente crescente.
- `npm run db:check` ok; `drizzle-kit generate` responde "No schema changes".

Guarda e procedimento: `docs/MIGRACOES.md` e ADR-009 (proposta).

**Bancos persistentes que receberam as migrações antigas do PR #9:**

- produção e homologação não existem;
- o CI usa serviço efêmero;
- os testes criam e removem bancos (0 remanescentes conferidos);
- o contêiner desta sessão não tinha banco da aplicação nem `apps/api/.data`;
- **máquinas de desenvolvimento não são verificáveis daqui.** Quem rodou `npm run dev`/`db:seed` na branch do PR #9 recebe `HISTORICO_LEGADO_PR9` do guarda e deve seguir `docs/MIGRACOES.md`. O histórico não é reescrito sem procedimento.

## 4. Conflitos encontrados e resolvidos

| Arquivo | Conflito | Resolução |
|---|---|---|
| `drizzle/meta/_journal.json`, `meta/0001_snapshot.json`, `meta/0002_snapshot.json` | add/add: duas histórias com os mesmos índices | Mantidos os do PR #10; catálogo **regerado** como 0003/0004 (seção 3) |
| `drizzle/0001_catalogo_legal.sql`, `0002_catalogo_legal_integridade.sql` | numeração incompatível | Removidos; conteúdo idêntico em 0003/0004 |
| `apps/api/src/db/schema.ts` | os dois adicionavam `check` ao import | Merge automático correto (união); comentários "migração 0002" do catálogo → 0004 |
| `apps/api/src/app.ts` | dois módulos de rotas no mesmo ponto | Os dois registrados; prefixos disjuntos (teste de coexistência) |
| `apps/api/src/modules/isolation.test.ts` | — (merge automático) | Testes negativos dos dois PRs preservados |
| `apps/web/src/api.ts` | — (merge automático) | Tipos e chamadas das duas famílias |
| `apps/api/src/guards.test.ts` | **conflito semântico**: lia `0001_catalogo_legal.sql` por nome fixo | Lista derivada do journal, exigindo exatamente 0003/0004 |
| `apps/api/src/db/catalog-schema.test.ts` | **conflito semântico**: esperava 3 migrações aplicadas | Conta as entradas do journal (5) |
| `CLAUDE.md` | regras 9/10 | Regra 9 do PR #10, regra 10 (catálogo) do PR #9, regra 11 (testes) |
| `docs/HANDOFF.md`, `docs/SEGURANCA.md`, `docs/CATALOGO_LEGAL.md` | seções concorrentes | Seções dos dois PRs em ordem cronológica; referências 0002 → 0004 |

Conferência automática da união:

- os 17 arquivos exclusivos do PR #10 estão **idênticos** a `20d7d33`;
- os 29 exclusivos do PR #9 estão idênticos a `31e272d`, salvo as 6 mudanças intencionais acima;
- nenhum arquivo foi removido.

## 5. Testes de migração (PostgreSQL 16.15 real e PGlite; dados sintéticos)

`apps/api/src/db/migration-history.test.ts` (11 casos), com bancos persistentes fechados e reabertos entre "versões" e dados inseridos pela própria API:

| Exigência da missão | Teste | Resultado |
|---|---|---|
| 1. Instalação do zero 0000→0004 | "instalação do zero" + referência do `beforeAll` | histórico canônico; 7 tabelas, 17 triggers, índice e CHECK temporais, CHECK de quatro olhos |
| 2. Banco 0000–0002 com empresas, XMLs e decisões → 0004 | "2–5. banco da correção temporal…" | 2 empresas, 3 NF-e, homologação e rejeição com vigência, pendência resolvida, outra aberta |
| 3. Preservação dos registros | idem | checksum (contagem + md5 do conteúdo) de **todas** as tabelas pré-existentes idêntico antes/depois; pendência aberta devolvida igual pela API |
| 4. Restrições e triggers do catálogo | idem e "legado do PR #9" | UPDATE/DELETE direto recusado pelos triggers; status sem trilha recusado; CHECK temporal ativo; impressão digital do esquema igual à da instalação limpa |
| 5. Reaplicação idempotente | idem | `migrate()` 3×: histórico e dados inalterados; `db:reconcile` não faz nada |
| 6. Falhas parciais e recuperação | "6. falha parcial no upgrade normal", "falha parcial na reconciliação", "DDL manual", "renumerar sem refazer o journal" | rollback total (nem tabelas nem registro de 0003/0004/0005); recuperação reexecutando; CHECK violado por dado legado desfaz a reconciliação inteira, e ela conclui depois de corrigido o dado; DDL manual recusado; pulo silencioso provado e recusado pelo guarda |
| 7. Sem bancos órfãos | `afterAll` consulta `pg_database` pelos nomes criados | 0 remanescentes (também conferido com `psql` após cada execução) |
| Legado do PR #9 | "banco com o histórico antigo do PR #9", "PR #9 e depois PR #10" | guarda recusa sem escrever; diagnóstico; reconciliação produz histórico e esquema canônicos, auditada; a 0002 reclassifica a rejeição antiga fora da vigência (auditada); a aplicação funciona |

**Ensaio com o código original** (`git archive` de `31e272d` e `20d7d33`; script em scratchpad, não versionado):

- **Banco criado pelo seed do PR #9:**
  - o seed da integrada recusa com `HISTORICO_LEGADO_PR9`;
  - `db:reconcile` faz o diagnóstico (plano: executar 0001/0002 temporais, re-datar 0003/0004);
  - `--confirm-database` errado é recusado (exit 3);
  - `--apply` reconcilia, com 5 registros canônicos e auditoria;
  - o seed seguinte passa e uma nova reconciliação não faz nada.
- **Banco criado pelo seed do PR #10:** o seed da integrada aplica 0003/0004 (7 tabelas, 17 triggers).
- A impressão digital do esquema dos dois bancos finais é **idêntica**.

## 6. Suíte integrada

Ambiente: Linux, Node 22.23.5, npm 10.9, PostgreSQL 16.15 (usuário sem superusuário, com CREATEDB).

| Verificação | Resultado |
|---|---|
| `npm run verify` (typecheck 3 workspaces + testes PGlite + build) | verde: **169 + 1 só-PostgreSQL**, 23 arquivos |
| Esperado pela união | base 69 + PR #9 57 + PR #10 24 = 150; + 11 de migração + 8 de coexistência = 169 ✔ |
| `TEST_DATABASE_URL=… npm test -- --project api` | **146/146** em 6 execuções seguidas (57 + 46 + 24 + 11 + 8), 0 erros não tratados, 0 `cf_test_*` |
| `npm run db:check` | ok |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilidades |
| `npm run test:mutations` (PostgreSQL) | **14/14 detectadas**: M1–M7 temporais no código integrado e H1–H7 de histórico/reconciliação |

Cobertura das categorias pedidas:

| Categoria | Arquivos |
|---|---|
| Autenticação e autorização multi-tenant | `auth.test.ts`, `isolation.test.ts` (fundação + temporal + catálogo), `app.test.ts`, `password.test.ts` |
| Empresas e perfis fiscais | `fiscal-profiles.test.ts`, `isolation.test.ts`, `cnpj.test.ts` |
| Importação de NF-e | `documents.test.ts`, `parser.test.ts`, `fingerprint.test.ts` |
| Revisão e pendências temporais | `review-consistency.test.ts`, `classification.test.ts`, `temporal-pendencies.test.ts`, `temporal-pendencies-r2.test.ts` |
| Catálogo legal, fontes e snapshots | `catalog-flow.test.ts`, `catalog-schema.test.ts`, `conditions.test.ts` |
| Versionamento de regras | `catalog-flow.test.ts`, `catalog-schema.test.ts`, `workflow.test.ts` |
| Quatro olhos e governança | `catalog-flow.test.ts`, `catalog-schema.test.ts`, `integration-coexistence.test.ts` |
| Concorrência | `catalog-concurrency.test.ts`, `temporal-pendencies.test.ts` (M1), `documents.test.ts`, `integration-coexistence.test.ts` |
| Auditoria e isolamento | `isolation.test.ts`, `integration-coexistence.test.ts`, `migration-history.test.ts` |
| Guardas (sem cálculo, sem dados reais) | `guards.test.ts` |
| **Coexistência (novo)** | `integration-coexistence.test.ts`: rotas sem colisão; 401/403/404 idênticos nas duas famílias; CSRF; regra ATIVA não classifica NF-e nem mexe na pendência; resolução não toca o catálogo; auditoria só no sucesso; resolução + aprovação + importação em paralelo |
| **Histórico de migrações (novo)** | `migration-history.test.ts` |

### Falha intermitente encontrada e corrigida (infraestrutura de teste)

Na suíte integrada no PostgreSQL, cerca de **1 em 6** execuções terminava com exit 1: `Uncaught Exception: terminating connection due to administrator command` (57P01), às vezes com um `cf_test_*` órfão. Foram 3 ocorrências antes da correção.

- **Causa:** em `pg-pool` 3.14, `pool.end()` resolve antes de o socket fechar. O harness do PR #7 faz `DROP DATABASE … WITH (FORCE)` em seguida e derruba conexões ainda em encerramento. O `idleListener` emite `error` no pool sem ouvinte e o worker morre.
- **Correção** (`a525baf`, só em `pg-test-database.ts`): esperar até ~1 s as conexões do próprio banco encerrarem antes de forçar.
- **Resultado:** 25 execuções seguidas da suíte PostgreSQL sem falha (12 + 1 + 6 + 6).
- O mesmo mecanismo afeta a **produção** (seção 8).

## 7. Commits da branch experimental (sobre `20d7d33`)

| Commit | O quê |
|---|---|
| `29fc526` | cherry-pick de `e51a9aa`: esquema do catálogo e migrações regeradas 0003/0004 |
| `487ee05` | cherry-pick de `1d3b874`: API do catálogo; `app.ts` e guarda de migrações |
| `79ada6a` | cherry-pick de `54de80f`: interface web (sem conflito) |
| `6b769c1` | cherry-pick de `31e272d`: documentação unida |
| `a525baf` | fix(test): corrida no `drop()` do banco de teste |
| `623be5c` | feat(db): guarda do histórico, `db:reconcile`, testes de migração, H1–H7, `docs/MIGRACOES.md` |
| `bdd7b1d` | test(integ): regressões de coexistência |
| (seguinte) | docs: este relatório, ADR-009, HANDOFF, CLAUDE.md, SEGURANCA |

CI de cada SHA: aba Actions da branch. O último SHA está registrado no HANDOFF.

## 8. Riscos residuais

1. **Pool do PostgreSQL sem ouvinte de `error` em produção** (`client.ts`, desde o PR #7). Uma conexão ociosa encerrada pelo servidor (reinício, failover, `pg_terminate_backend`) derruba o processo da API. **Verificado**: com a API no ar sobre PostgreSQL 16, um `pg_terminate_backend` na única conexão ociosa encerrou o processo com `Unhandled 'error' event … on BoundPool` (script de ensaio no scratchpad, banco descartável). Não foi corrigido aqui, porque a missão não autoriza mudar a fundação. Correção mínima na seção 9.
2. **Bancos de desenvolvimento** com o histórico do PR #9 não são inventariáveis daqui. Ficam bloqueados pelo guarda até a reconciliação (ou recriação de `.data`).
3. **Migração no boot sem lock entre réplicas** (comportamento do Drizzle). Com mais de uma réplica, migrar num passo único de deploy.
4. As vigências disjuntas (ADR-008) continuam garantidas pela aplicação, sem `EXCLUDE USING gist`. Os triggers do catálogo não protegem contra quem tem DDL. Ambos já estão documentados.
5. As decisões D1–D4 do Fiscal (ADR-008) e a decisão nº 2 do catálogo (quem aprova e ativa) continuam pendentes. O implementado é provisório e conservador.
6. Não verificado: Windows (`npm.cmd`), E2E de navegador da UI integrada (só o build foi conferido), revisão humana, volume e carga.
7. A sequência 0003/0004 é **provisória**: se a ordem de integração mudar (catálogo antes do temporal), é preciso regerar no sentido inverso e reconciliar os bancos do PR #10.

## 9. Impactos necessários nos PRs (a executar só com aprovação; nada foi feito neles)

- **PR #7 (fundação):**
  - incorporar o PR #10, conforme o plano da revisão R2;
  - corrigir a corrida do `drop()` em `apps/api/src/test/pg-test-database.ts` (o equivalente a `a525baf`);
  - adicionar `pool.on("error", …)` em `createDatabase` (postgres), registrando só código e mensagem, com teste que use `pg_terminate_backend` numa conexão ociosa e confirme que o processo sobrevive;
  - de preferência, levar também o guarda de histórico (`migration-history.ts` + chamada em `migrate()`), porque protege qualquer integração futura.
- **PR #10 (temporal):** nenhum ajuste funcional. As migrações 0001/0002 ficam canônicas como estão. Após a integração na fundação, registrar no HANDOFF o SHA de integração.
- **PR #9 (catálogo):**
  - rebasear sobre a fundação já com o PR #10, reproduzindo `29fc526` (migrações 0003/0004 **regeradas**, sem copiar nem renomear) e as resoluções de `487ee05` e `6b769c1`;
  - ajustar `guards.test.ts` e `catalog-schema.test.ts` (nomes e contagem);
  - acrescentar `integration-coexistence.test.ts` e `migration-history.test.ts`;
  - avisar quem rodou a branch localmente para usar `db:reconcile`.

## 10. Sequência recomendada para a integração definitiva (não executada)

1. Revisão independente desta branch experimental (ler este relatório, ADR-009 e `docs/MIGRACOES.md`; conferir o CI do último SHA).
2. Fiscal (Iza/Edson): decisões D1–D4 (ADR-008). Henrique/Iza/Edson: decisão nº 2 do catálogo. Não presumir aprovação.
3. Revisor humano: merge do **PR #10 em `feat/sprint1-fundacao-segura`**, nunca na `main`. Em seguida, na fundação, por PR próprio: correção do `drop()` dos testes, ouvinte de `error` do pool e guarda de histórico. CI verde na HEAD da fundação.
4. **Rebase do PR #9** sobre a nova HEAD da fundação, regerando 0003/0004 como em `29fc526`. Conferir:
   - hashes iguais aos da seção 3;
   - `when` maior que o da 0002 temporal;
   - `db:check`;
   - `npm run verify`;
   - suíte PostgreSQL ×3 sem órfãos;
   - `test:mutations` com PostgreSQL;
   - CI verde.
5. Antes do merge do PR #9: rodar `npm run db:reconcile` (diagnóstico) em todo banco de desenvolvimento ou compartilhado que tenha rodado a branch do PR #9, com backup antes de qualquer `--apply`.
6. Merge do PR #9 na fundação pelo revisor humano. Depois disso, seguir os gates do PR #7 (Windows, E2E, revisão final) antes de qualquer merge na `main`.
7. Esta branch experimental pode ser descartada depois do passo 6. Ela não deve ser mergeada.
