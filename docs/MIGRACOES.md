# Migrações do banco: histórico canônico, guarda e reconciliação

> Criado na CF-INTEG-01 (pré-integração da fundação, da correção temporal e do catálogo legal). Ler antes de criar, renomear ou reordenar qualquer migração.

## Sequência canônica (provisória, até a integração definitiva)

| idx | Arquivo | Origem | `when` (journal) | sha256 do SQL |
|---|---|---|---|---|
| 0 | `0000_fundacao` | PR #7 | 1794580964727 | `a92feef3…1d763` |
| 1 | `0001_temporal_pendencias` | PR #10 | 1795090619177 | `bf33b62c…73bfd` |
| 2 | `0002_rejeicao_fora_da_vigencia` | PR #10 | 1795094504588 | `ae605851…01400` |
| 3 | `0003_catalogo_legal` | PR #9 (era `0001_catalogo_legal`) | 1795097114553 | `60727833…351c` |
| 4 | `0004_catalogo_legal_integridade` | PR #9 (era `0002_catalogo_legal_integridade`) | 1795097128430 | `152d8252…dbbc` |

- O SQL de 0000–0002 é o das HEADs `70c5c17` (PR #7) e `20d7d33` (PR #10), sem nenhuma alteração.
- A 0003 foi **regerada** com `drizzle-kit generate` sobre o esquema unido e saiu byte a byte igual ao `0001_catalogo_legal.sql` do PR #9. A 0004 é custom (triggers) e tem o conteúdo exato do `0002_catalogo_legal_integridade.sql` do PR #9.
- Os snapshots 0003/0004 encadeiam no 0002 temporal (`prevId`). `migration-history.test.ts` confere sequência, hashes e `when` crescente.

## Por que não basta renomear arquivos

O migrator do Drizzle 0.45 (`pg-core/dialect.js`) **não compara hash nem nome**. Ele lê o `created_at` do último registro de `drizzle.__drizzle_migrations` e aplica, numa única transação, as entradas do journal com `when` maior. Daí:

1. **Pulo silencioso.** Renomear o catálogo para 0003/0004 mantendo o `when` do PR #9 (1795005761201, anterior ao 1795094504588 da 0002 temporal) faz um banco já em 0002 temporal **pular o catálogo sem erro**. O teste "renumerar sem refazer o journal" demonstra isso, e a mutação H7 também.
2. **Banco do PR #9.** Um banco que recebeu o histórico antigo do PR #9 tentaria reaplicar o catálogo como 0003/0004. Falha com `type "legal_jurisdiction" already exists` e a transação é desfeita, então nada fica pela metade, mas a mensagem não diz o que fazer.
3. **Branches paralelas.** Um banco de desenvolvimento que rodou o PR #10 e depois o PR #9 (`git checkout`) pula o catálogo do PR #9 em silêncio, já no estado atual das branches originais.

## Guarda em `migrate()` (`apps/api/src/db/migration-history.ts`)

Antes do Drizzle, `migrate()` (API, seed e harness de testes) chama `assertMigrationHistory`, que exige:

- journal com `when` estritamente crescente (`JOURNAL_FORA_DE_ORDEM`);
- histórico gravado que seja **prefixo exato** do journal, com o mesmo hash e o mesmo `created_at`.

Se não for, recusa **sem escrever nada**:

| Estado | Código | O que fazer |
|---|---|---|
| Histórico do PR #9 (catálogo como 0001/0002, `created_at` antigos) | `HISTORICO_LEGADO_PR9` | Reconciliar (abaixo) |
| Lacuna, migração desconhecida, `created_at` diferente, duplicata | `HISTORICO_DIVERGENTE` | Investigar; não há correção automática |

## Reconciliação de banco com o histórico do PR #9

Vale só para bancos que rodaram a branch `feat/sprint2a1-catalogo-legal` (PR #9), inclusive os que depois passaram pela branch do PR #10.

1. **Backup.** `pg_dump -Fc` do banco; no PGlite, copie a pasta `apps/api/.data`.
2. **Diagnóstico.** `npm run db:reconcile` (lê `apps/api/.env`). Não escreve nada; mostra o estado e o plano.
3. **Aplicar.** `npm run db:reconcile -- --apply --confirm-database=<nome mostrado no diagnóstico>`.
4. Suba a API, ou rode `npm run db:seed`, para as migrações pendentes normais.

O que a reconciliação faz, numa única transação, sob `pg_advisory_xact_lock` e com o histórico relido depois do lock:

- confere que o banco tem fisicamente o catálogo (7 tabelas e 17 triggers) e que os objetos da 0001 temporal batem com o histórico. Um índice ou CHECK criado à mão faz a reconciliação recusar;
- executa o SQL **sem alteração** das migrações canônicas ausentes (0001/0002 temporais) e as registra com hash e `when` canônicos. Elas não tocam nenhuma tabela do catálogo; a impressão digital do esquema final é igual à da instalação do zero (teste);
- troca só o `created_at` dos dois registros do catálogo, porque o hash já é o canônico;
- grava `MIGRATION_HISTORY_RECONCILED` em `audit_events`, com o histórico antes e depois. A 0002 temporal, se reclassificar rejeições antigas fora da vigência, grava a própria auditoria `MIGRATION_REJECTION_OUT_OF_VALIDITY_RECLASSIFIED`.

**Falha parcial.** Qualquer erro desfaz tudo e o banco continua no estado legado. O caso realista é uma vigência invertida (`valid_from > valid_to`), que a branch do PR #9 aceitava e que viola o CHECK da 0001 temporal. Corrija o dado (decisão do Fiscal) e repita. Reexecutar sobre banco já canônico não faz nada.

**Reversão.** Restaure o backup. Também é possível reverter à mão, com o histórico "antes" guardado na auditoria e o DDL da 0001, que é aditivo (um índice e um CHECK). Restaurar o backup é o caminho recomendado.

## Inventário de bancos persistentes (19/11/2026)

| Onde | Recebeu o histórico do PR #9? | Situação |
|---|---|---|
| Produção / homologação | Não existem (HANDOFF, ADR-008) | — |
| CI (GitHub Actions) | Serviço `postgres:16` efêmero por execução | Nada persiste |
| Testes (`cf_test_*`, PGlite `memory://`) | Criados e removidos por suíte | Conferido: 0 remanescentes |
| Contêiner desta sessão | PostgreSQL local sem bancos da aplicação; sem `apps/api/.data` | Nada a reconciliar |
| **Máquinas de desenvolvimento** (`apps/api/.data`, PGlite, ou `DATABASE_URL` local) | **Não verificável daqui** | Quem rodou `npm run dev`/`db:seed` na branch do PR #9 deve rodar o diagnóstico (`npm run db:reconcile`) ou recriar a pasta `.data` |

## Regras para migrações novas

1. Sempre `npm run db:generate` sobre a branch **já rebaseada** no histórico de destino. Nunca copiar ou renomear migração de outra branch.
2. Migração aplicada em banco persistente compartilhado é imutável, inclusive no nome e no `when`. Se for preciso, use reconciliação explícita e testada, como esta.
3. Duas branches que geram migrações em paralelo: a que integra por último **regera** as suas, e o `when` novo é maior que o de todas as já integradas.
4. `npm run test:mutations` inclui H1–H7 (guarda e reconciliação). Mudou `migration-history.ts`? Rode com `TEST_DATABASE_URL` (H6 exige PostgreSQL).
