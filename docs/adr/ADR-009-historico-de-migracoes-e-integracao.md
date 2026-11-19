# ADR-009 — Histórico canônico de migrações e guarda contra divergência

**Status:** proposta, na branch experimental `feat/cf-integ-temporal-catalogo-preflight` (CF-INTEG-01). Aguarda revisão independente e a ordem de integração definitiva. · **Data:** 2026-11-19
**Relacionadas:** ADR-001 (stack), ADR-007 (catálogo, PR #9), ADR-008 (pendência temporal, PR #10). Procedimento em `docs/MIGRACOES.md`.

## Contexto

O PR #9 (catálogo) e o PR #10 (correção temporal) partem da mesma base (`70c5c17`, PR #7). Cada um gerou migrações 0001 e 0002 próprias, com os mesmos índices de journal e os mesmos nomes de snapshot: duas histórias incompatíveis. A revisão R2 do PR #10 registrou isso como P1-INT. Cada branch passa sozinha em `db:check` e no CI; o problema só aparece quando as duas se juntam.

O migrator do Drizzle 0.45 decide **só** pelo `created_at` do último registro de `drizzle.__drizzle_migrations` comparado ao `when` do journal. Não compara hash nem nome. Por isso:

- renomear o catálogo para 0003/0004 mantendo o `when` antigo faz um banco em 0002 temporal **pular o catálogo em silêncio**;
- um banco que recebeu o histórico do PR #9 falha ao reaplicar o catálogo ("already exists"). A falha é segura, mas não explica o que fazer.

## Decisão

1. **Sequência canônica provisória:** 0000 fundação, 0001 pendências temporais, 0002 rejeição fora da vigência, 0003 catálogo legal, 0004 integridade do catálogo. O SQL de 0000–0002 não muda. A 0003 é regerada pelo `drizzle-kit` sobre o histórico temporal e sai byte a byte igual à antiga 0001 do PR #9; a 0004 (custom) tem o conteúdo exato da antiga 0002. O `when` é novo e estritamente crescente.
2. **Guarda antes do Drizzle em todo `migrate()`:** journal estritamente crescente e histórico gravado como prefixo exato do canônico (hash + `created_at`). Fora disso, nada é aplicado. Os erros têm código (`JOURNAL_FORA_DE_ORDEM`, `HISTORICO_LEGADO_PR9`, `HISTORICO_DIVERGENTE`) e mensagem com o procedimento.
3. **Reconciliação explícita, nunca implícita**, só para o legado conhecido do PR #9. Usa `db:reconcile` (dry-run por padrão; aplicar exige confirmar o nome do banco) e roda numa transação com advisory lock. A reconciliação:
   - confere o estado físico;
   - executa o SQL canônico ausente sem alteração;
   - re-data só os registros cujo hash já é canônico;
   - audita `MIGRATION_HISTORY_RECONCILED`.
4. **Regra para branches paralelas:** a que integra por último regera as próprias migrações sobre o histórico de destino. Nunca se copia nem se renomeia migração.

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Só renomear arquivos e editar o journal à mão | Mantém o `when` antigo (pulo silencioso) ou exige snapshot à mão; não trata bancos do PR #9. |
| Catálogo primeiro (0001/0002 do PR #9) e temporais como 0003/0004 | Possível, mas o PR #10 é correção da fundação e já foi revisado como base (R2). Bancos com as temporais aplicadas exigiriam a mesma reconciliação no sentido inverso. Mantida como alternativa, se a ordem de integração mudar. |
| Fundir as quatro migrações numa só | Reescreve SQL já canônico e perde a rastreabilidade por PR. |
| Trocar de ferramenta ou usar o `migrationsTable` do Drizzle por branch | Desproporcional; não resolve bancos já migrados. |
| Reconciliar automaticamente no boot | Mudança de histórico sem decisão humana nem backup; contraria "nenhuma mudança irreversível em banco persistente sem procedimento". |

## Consequências

- Qualquer divergência futura de histórico falha cedo e de forma explícita, inclusive a de duas branches gerando migrações em paralelo.
- O PR #9 precisa ser rebaseado sobre a fundação já com o PR #10. As migrações dele passam a ser 0003/0004 regeradas (os SQL continuam idênticos) e os testes que citavam nomes fixos são ajustados.
- Bancos de desenvolvimento com o histórico do PR #9 precisam de `db:reconcile`, ou de recriar `apps/api/.data`.
- Custo: uma consulta ao histórico por boot, além da leitura dos arquivos SQL que o Drizzle já faz.
