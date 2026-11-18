# HANDOFF — continuidade entre sessões

> Leia junto com `CLAUDE.md`. Atualize este arquivo após cada marco e antes de encerrar a sessão. Não dependa do histórico de nenhuma conversa: tudo o que importa está aqui, nos commits e nas Issues.

## Atualização 19/11/2026 (tarde) — CF-FOUND-08-R2: achados P1 e P2 da auditoria do PR #10

- **Branch:** `feat/cf-found-08-temporal` (a mesma do PR #10; base `feat/sprint1-fundacao-segura`). Auditoria em [comentário do PR #10](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/10#issuecomment-7010097493) sobre `d22f3b2`. Sem merge, sem force push; `main`, PR #7, PR #9 e Premium não foram tocados.
- **Commits R2:**

| Commit | O quê | CI (push) |
|---|---|---|
| `1e89db6` | test: reprodução de P1 e P2 — 5 casos falham contra `d22f3b2` (intencional) | [44532247334](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44532247334) **vermelho no passo de testes PGlite** (esperado) |
| `2a03068` | fix(review): toda decisão final só vale na vigência; projeção/resolução incluem rejeição; padrão da rejeição sem data; migração `0002`; lacunas sobre agregação completa; paginação com total | (incluído no run abaixo) |
| `1429005` | test(review): `npm run test:mutations` (M1–M7) | (incluído no run abaixo) |
| `2f21ee5` | feat(web): rejeição com vigência opcional; textos e lacunas completas | [44533633315](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44533633315) verde |
| `8e91402` | fix(review): concordância do motivo com uma nota | ver Actions |
| (este) | docs: ADR-008 (R2, decisões pendentes), HANDOFF, CLAUDE.md, SEGURANCA, ARQUITETURA | ver Actions / PR #10 |

- **P1, causa raiz confirmada:** `classificationFor` devolvia `REJEITADO` para qualquer data. A nota de outubro sob rejeição a partir de novembro ficava rejeitada sem cobertura e sem ação, porque a projeção só via `HOMOLOGADO`.
  - **Correção:** toda decisão final vale só na vigência; fora dela, `PENDENTE_REVISAO` e pendência temporal tratável (projeção, resolução e contagem incluem rejeição).
  - **Rejeição sem data** vale para o período em análise: do fim da decisão anterior em diante, ou sem início. É padrão provisório (D2).
  - **Migração de dados `0002`** (conservadora, auditada, idempotente) corrige rejeições antigas gravadas fora da vigência.
- **P2, causa raiz confirmada:** o detalhe truncava em 500 e derivava as lacunas da amostra. Com 520 + 5 notas, sumia o intervalo de maio a junho.
  - **Correção:** lacunas calculadas sobre a agregação completa por dia, com quantidade e primeira/última emissão; ocorrências paginadas (1–500, padrão 100) em ordem estável, com `page.total`/`hasMore`; listagem também com total.
- **Decisões pendentes do Fiscal (Iza/Edson), ADR-008:**
  - D1: rejeição tem vigência?
  - D2: vigência padrão da rejeição sem data.
  - D3: decisão do período.
  - D4: reabertura de rejeição com início definido.

  O implementado é o lado conservador. Não presumir aprovação.
- **Verificação local (Linux, Node 22.23, PostgreSQL 16.15):**
  - `npm run verify` verde (PGlite: 93 + 1 só-PostgreSQL);
  - PostgreSQL real 81/81 em 3 execuções seguidas, sem `cf_test_*` remanescente;
  - `db:check` ok; `npm audit --omit=dev --audit-level=high` 0 vulnerabilidades;
  - `npm run test:mutations`: 7/7 detectadas no PostgreSQL, 6/6 no PGlite (M1 exige PostgreSQL);
  - upgrade `0001` → `0002` com dados legados conferido com o migrator do Drizzle.
- **Navegador:** teste de fumaça (Playwright, PGlite isolado, dados sintéticos). A rejeição a partir de novembro é feita pela UI, outubro aparece como pendência, é resolvido pela UI e a rejeição original fica intacta.
- **Atenção ao ambiente:** se o contêiner for reciclado, o PostgreSQL local para (`ECONNREFUSED`). Rode `service postgresql start` antes do `TEST_DATABASE_URL=…`.
- **Próxima ação exata:**
  1. Revisão independente atualizada do PR #10, conferindo o CI do último SHA.
  2. Iza/Edson decidirem D1–D4. Se D1 = "rejeição sem vigência", reverter M5/I3 para rejeições, de forma explícita.
  3. Seguir os gates do PR #7.

  Nada de merge nem de fechar a Issue #8 antes disso.

## Atualização 19/11/2026 — CF-FOUND-08-TEMPORAL (Issue #8, achado 2)

- **Branch:** `feat/cf-found-08-temporal`, criada de `70c5c17` (HEAD da fundação). **PR:** [Inovacao-Contar-Brasil/Calculadora_Fiscal#10](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/10), **draft**, base `feat/sprint1-fundacao-segura` (depende do PR #7). Sem merge; entra na fundação só após revisão independente.
- **Commits:**

| Commit | O quê | CI (push) |
|---|---|---|
| `48f211a` | test: reprodução — 9 casos falham contra `70c5c17` (intencional) | [44522068608](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44522068608) **vermelho no passo de testes PGlite** (esperado) |
| `cdb051e` | fix(review): vínculo pela vigência, vigências disjuntas sob lock, reabertura sem órfãs, projeção e resolução de pendência temporal, migração `0001` | [44524034994](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44524034994) verde |
| `163eafb` | feat(web): seção de pendências na fila e cartão de resolução no detalhe | ver Actions |
| `a0e0c9c` | fix(review): 409 explícito se a resolução não obtiver o lock (reabertura concorrente) | ver Actions |
| (este) | docs: ADR-008, HANDOFF, CLAUDE.md, ARQUITETURA, SEGURANCA, ADR-004 | ver Actions / PR #10 |

- **Causa raiz:** a importação vinculava a nota ao item de revisão **aberto**, não à decisão que cobre a emissão; nada representava nota pendente presa a homologação que não a cobre; reabertura deixava órfãs as notas anteriores ao início; vigências sobrepostas eram aceitas. Detalhe e alternativas em `docs/adr/ADR-008-pendencia-temporal-e-linha-do-tempo.md`.
- **Solução (sem tabela nova):** `selectReviewFor` (vínculo único) + vigências disjuntas (422/409) + `lockOpenReview` em toda escrita da linha do tempo + pendência temporal como projeção (`GET /api/temporal-pendencies`, `GET /api/temporal-pendencies/:id`, `POST /api/temporal-pendencies/:id/resolve`, staff-only). Resolver = nova decisão final para um período sem decisão; a homologação original não muda.
- **Mudanças de comportamento em rotas existentes:** reabrir exige decisão final (422) e move à nova análise toda nota não coberta pela decisão encerrada (inclusive anteriores ao início; vale também para rejeição); `PATCH` final recusa vigência que comece antes do fim da decisão encerrada (422) e, sem data, começa no dia seguinte a ela; `GET /api/review-items/:id` ganhou `outOfValidityItems`.
- **Migração `0001_temporal_pendencias` (aditiva):** índice `nfe_items_review_item_idx` e `CHECK review_items_vigencia_ordenada_chk`. Upgrade conferido em PostgreSQL 16 com dados (0000 → dados → 0001).
- **Verificação local (Linux, Node 22.23, PostgreSQL 16.15):** `npm run verify` verde (PGlite: 86 + 1 só-PostgreSQL); `TEST_DATABASE_URL=… npm test -- --project api` 74/74 em 3 execuções seguidas, sem `cf_test_*` remanescente; `npm run db:check` ok; `npm audit --omit=dev --audit-level=high` 0 vulnerabilidades.
- **Prova de que os testes pegam o problema:** mutações detectadas — sem `lockOpenReview` na resolução (PostgreSQL: várias 201 e decisões sobrepostas), importação vinculando sempre ao item aberto (4 testes falham), reabertura antiga (2 testes falham). O teste de resoluções simultâneas aquece o pool do `pg` antes; sem isso a corrida não era exercitada (verificado).
- **Navegador:** teste de fumaça Playwright/Chromium com PGlite isolado e dados sintéticos — pendência listada, resolvida pela UI, some da fila, homologação intacta. Não é teste automatizado do repositório.
- **Não verificado:** Windows (`npm.cmd`), revisão humana, E2E completo de todos os perfis, carga/volume da projeção.
- **Próxima ação exata:** (1) revisão independente do PR #10 (ler ADR-008 primeiro; conferir CI do último SHA); (2) aprovado, o revisor humano incorpora em `feat/sprint1-fundacao-segura` (merge do PR #10 na base da fundação — nunca na `main`); (3) seguir os gates do PR #7 (Windows, E2E, revisão final). Não iniciar cálculo; não retargetar/mergear PR #9 antes disso.

## Atualização 18/11/2026 — Sprint 2A.1 Catálogo legal (implementada, aguardando revisão)

- **Branch:** `feat/sprint2a1-catalogo-legal`, criada a partir de `feat/sprint1-fundacao-segura` @ `70c5c17` (PR #7 **não** integrado à `main`). **PR dependente (stacked)** com base `feat/sprint1-fundacao-segura`; quando o #7 for mergeado, rebasear/retargetar para `main`.
- **Escopo autorizado pela missão CF-2A1-CATALOGO-LEGAL** (18/11/2026). As decisões de negócio da seção 11 da especificação continuam pendentes; nada aqui as presume.
- **Issue #8 (achado 2, pendência fora da vigência) continua aberta e é bloqueadora da integração final.** Não foi tocada nesta branch.
- **Commits:** `e51a9aa` (domínio + migrações 0001/0002 — **0003/0004 no histórico integrado**, ver CF-INTEG-01 — + testes de persistência), `1d3b874` (API, workflow, isolamento, concorrência, guardas), `54de80f` (interface mínima), seguinte (documentação).
- **O que existe:** fontes normativas com licença, snapshots com SHA-256, dispositivos com publicação ≠ efeitos e encerramento sem apagar; regras `CLASSIFICACAO`/`INCIDENCIA` com versões append-only; condições `RuleConditions` v1 validadas; workflow `RASCUNHO → EM_REVISAO_TECNICA → APROVADA → ATIVA` (+ `SUSPENSA`, `SUBSTITUIDA`, `REVOGADA`) com quatro olhos no backend **e** no banco; trilha e auditoria na mesma transação; 409 em concorrência; UI em `/catalogo`. Documentação do módulo: `docs/CATALOGO_LEGAL.md`. Refinamentos propostos: ADR-007 (seção nova; status segue "proposta").
- **O que NÃO existe (fora da 2A.1):** cálculo de qualquer tributo, alíquota/MVA/base, importação NCM/CEST (2A.2), finalidade por item (2A.3), motor de triagem (2A.4), SHADOW/EXCECOES (2A.5/2A.7), `legal_amendments` e reprocessamento (2A.6), scraper/Econet, redesign, Hub. **Regras ATIVAS não são aplicadas a NF-e.**
- **Verificação local (Linux, Node 22.23, npm 10.9, PostgreSQL 16.15):** `npm ci` ok; `npm audit --omit=dev --audit-level=high` 0; `db:check` ok; typecheck 0 erros; `npm test` 126 + 1 só-PostgreSQL em 19 arquivos (antes: 69); `TEST_DATABASE_URL=… npm test -- --project api` 103/103 em 3 execuções seguidas (antes: 57), concorrência 5× seguidas, sem bancos `cf_test_*` remanescentes; build ok. E2E Playwright (scratch, não versionado) com 4 usuários sintéticos: fluxo completo, autor bloqueado (403 `FOUR_EYES`), cliente sem menu e 404/403 na API.
- **CI:** push de `1d3b874` verde ([44308757035](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/44308757035)). Conferir o último SHA na aba Actions. Atenção: o workflow só roda `pull_request` para base `main`; PR stacked tem só o CI de push.
- **Não feito:** `npm.cmd ci`/`verify` no Windows; revisão humana; homologação de qualquer regra real.

### Decisões que exigem Henrique/Iza/Edson (2A.1)

1. Quem aprova regras e quem ativa (hoje: aprova `admin`/`fiscal` ≠ autor; ativa só `admin` ≠ autor, com referência de autorização) e se a ativação exige terceira pessoa (`RULE_ACTIVATION_REQUIRES_THIRD_PERSON`, padrão `false`). Decisão nº 2 da especificação.
2. Qual registro formal serve de `authorizationReference` na ativação de regra real (ata, e-mail, Issue #3).
3. Confirmar salvaguardas das condições: incidência sempre com `ufDestino`; classificação por descrição só com aceite explícito; NCM mínimo de 4 dígitos.
4. Catálogo por escritório (organização) vs. catálogo oficial compartilhado entre organizações.
5. Licença Econet e bases privadas (decisão nº 4): enquanto não houver contrato registrado, ficam `LICENCA_NAO_VERIFICADA` e bloqueadas.
6. Guarda de fixtures `OFICIAL_PUBLICO` da especificação (seção 8) conflita com o critério de pronto — validar a substituição por guarda de domínios oficiais/TLD `.invalid`.

### Próxima ação exata

1. Revisão humana do PR da 2A.1 (dependente do #7) e das decisões acima.
2. Resolver a Issue #8 (achado 2) na fundação; integrar o #7; retargetar este PR para `main`.
3. Sprint 2A.2: importação curada das tabelas NCM e CEST×NCM com snapshot, hash e vigência, reutilizando `legal_sources`/`legal_source_snapshots` (espécie `ATO_TABELA`) para a proveniência; validação de NCM/CEST por data com proveniência visível. Sem cálculo.

## Atualização 17/11/2026 — revisão independente, sem Fable

- **Issue #8 parcialmente corrigida diretamente pelo GitHub**, no PR #7 ainda em draft e sem merge:
  - `dbaef8b3`: testes negativos exigem que clientes não acessem a fila ou detalhes internos de revisão; execução inicial falhou como esperado (teste antes do fix).
  - `b5019331`: listagem restrita a staff por organização e detalhe protegido por `loadReviewForStaff`; CI push/PR aprovado (PostgreSQL e PGlite).
  - `6f30ddfa`: regressão para duas NF-e distintas simultâneas com o mesmo fingerprint no PostgreSQL; sequencial no PGlite, e produto repetido em linhas.
  - `b63ed3da`: substitui SELECT → INSERT por UPSERT atômico em `review_items_open_idx`, preserva ocorrências por documento.
- **Atenção:** conferir o CI do último SHA `b63ed3da` antes de declarar a correção de concorrência aprovada; os commits são incrementais e os commits apenas de testes podem falhar intencionalmente.
- **Ainda bloqueado na Issue #8:** pendências fora da data de vigência de homologação permanecem sem fluxo próprio de resolução. Requer modelo e testes para histórico temporal; não ocultar pendência nem presumir tributação.
- **Operação:** antes de merge, executar `npm.cmd ci` e `npm.cmd run verify` no Windows, teste ponta a ponta no navegador e revisão humana final. Não iniciar cálculos fiscais, não publicar NF-e reais no Git e não fazer merge automático.
- **PR #1:** encerrado sem merge; sua branch é ancestral do PR #7, comprovado pelo compare no GitHub.

## Situação em 16/11/2026

- **Sprint 1 (Issue #2):** fundação implementada. **Gate de qualidade (Issue #5): CI verde no PostgreSQL real**, vulnerabilidades tratadas, PGlite corrigido, revisão de segurança feita. Falta só o que depende de pessoas (ver "Pendências").
- **Sprint 2A (Issue #6):** especificação pronta em `docs/SPRINT2A_ESPECIFICACAO.md` + `docs/adr/ADR-007` (proposta). **Nenhum código da 2A foi escrito** — aguarda revisão de Henrique/Iza/Edson.
- **PR:** [Inovacao-Contar-Brasil/Calculadora_Fiscal#7](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/pull/7) — **draft**, base `main`, sem merge. Contém também os commits do PR #1 (sobreposição a resolver na revisão).

## Branch e commits

- **Branch:** `feat/sprint1-fundacao-segura` (é a branch do PR #7). Push normal, sem force.
- Base: `main` = `82b7497` (README). PR #1 = `d3bb210`, `1f62c4f`. Sprint 1 original = `9f54287`, `bc61554`, `71cceec`, `b63b94e`.
- **Estabilização (16/11/2026), em ordem:**

| Commit | O quê |
|---|---|
| `aedf40d` | fix(test): banco PostgreSQL exclusivo por suíte; limpeza garantida no harness |
| `cf6e413` | fix(db): diretório do PGlite criado recursivamente no primeiro uso |
| `a82c74e` | fix(deps): drizzle-orm 0.45.4, @fastify/static 10.1.11, vitest 4.1.12 |
| `a7d781f` | fix(auth): sessões/auditoria atômicas, troca de senha endurecida, CSRF sem Origin |
| `5c52b51` | fix(review): regra única de classificação, vigência na propagação, concorrência, integridade do XML, sem oráculo de existência |
| `b16da2d` | ci(docs): gate de `npm audit` de produção, `npm ci`, `drizzle-kit check`; SEGURANCA/README |
| `7fd26bd` | docs(sprint2a): especificação + ADR-007 |
| (este) | docs: HANDOFF e CLAUDE.md |

## CI (GitHub Actions, PostgreSQL 16 real + PGlite)

| SHA | Push | Pull request | Resultado |
|---|---|---|---|
| `b63b94e` (antes) | [43461045963](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/43461045963) | 43483068628 | **falha** (schemas) |
| `aedf40d` | [43862538374](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/43862538374) | 43862546367 | verde |
| `cf6e413` | 43862710179 | 43862718579 | verde |
| `a82c74e` | 43863511714 | 43863521274 | verde |
| `5c52b51` | 43864502473 | 43864510368 | verde |
| `b16da2d` | [43864657021](https://github.com/Inovacao-Contar-Brasil/Calculadora_Fiscal/actions/runs/43864657021) | 43864665712 | verde (com audit + db:check) |

Critério "duas execuções consecutivas verdes após a correção" (Issue #5): cumprido — 10 execuções verdes seguidas em 5 SHAs. Os commits só de documentação depois de `b16da2d` têm CI próprio: confira a aba Actions.

Passos do CI: `npm ci` → `npm audit --omit=dev --audit-level=high` → `npm run db:check` → typecheck → testes PGlite → testes PostgreSQL (`TEST_DATABASE_URL`) → build.

## Verificação local (Linux, Node 22.23, npm 10.9, PostgreSQL 16 local)

- `npm run verify`: typecheck nos 3 workspaces, **69 testes** (68 + 1 que só roda no PostgreSQL) em 13 arquivos, build API + web — verde.
- `TEST_DATABASE_URL=... npm test -- --project api`: **56/56**, 5 execuções seguidas, nenhum banco `cf_test_*` remanescente.
- Seed em `apps/api/.data` inexistente: cria; segunda execução não duplica.
- **Não executado nesta sessão:** `npm.cmd run verify` no Windows (fazer na próxima máquina Windows) e teste E2E em navegador.

## O que foi corrigido e por quê

1. **CI PostgreSQL (causa raiz):** no Vitest 3.2/4, `fileParallelism` é opção global e é **ignorada dentro de `projects`**. Os arquivos da API rodavam em paralelo e cada um fazia `DROP SCHEMA public CASCADE` no mesmo banco. Agora `TEST_DATABASE_URL` é só conexão administrativa e cada harness cria/remove um banco exclusivo `cf_test_<pid>_<ts>_<rand>` (nome validado por regex; `DROP DATABASE ... WITH (FORCE)` só nele). Setup com falha libera tudo. `harness.test.ts` cobre corrida, idempotência de migração, limpeza em falha e preservação do banco admin.
2. **PGlite ENOENT:** PGlite faz mkdir não recursivo; `ensurePgliteDataDir` cria a árvore (no-op se existe; ignora `memory://`/`idb://`).
3. **Vulnerabilidades:** 11 → produção **0**, dev **4 moderate** (uma causa: esbuild 0.18 dentro do drizzle-kit, só afeta `esbuild serve`, nunca usado — risco aceito). Tabela completa em `docs/SEGURANCA.md`.
4. **Revisão (Issue #5 item 6):** `EM_ANALISE` não era propagado aos itens já importados (status contraditórios no mesmo produto) e `HOMOLOGADO` ignorava a vigência ao propagar. Agora uma regra única `classificationFor` serve importação e propagação. **Semântica documentada:** `review_items.status` é o fluxo da decisão; `nfe_items.classification_status` é a classificação aplicável **àquela nota na data de emissão** — podem diferir só quando a nota está fora da vigência de uma homologação (fica `PENDENTE_REVISAO`).
5. **Concorrência:** decisões e reaberturas simultâneas → uma vence, a outra 409 (antes: ambas gravadas, ou 500 no PostgreSQL).
6. **Autorização:** cliente sem acesso à empresa recebia 403 numa decisão (revelava o item) → 404; inexistente e fora do escopo agora têm resposta idêntica (antes a mensagem diferia).
7. **Integridade:** download do XML confere o SHA-256 e recusa divergência (409, auditado).
8. **Sessões:** login/logout/troca de senha atômicos com auditoria; troca de senha revoga todas as sessões e tem rate limit; CSRF recusa `Sec-Fetch-Site: cross-site` sem `Origin`.

## Pendências e riscos

1. **Revisão humana do PR #7** e decisão sobre o PR #1 (fechar apontando para o #7, ou mergear o #1 antes e rebasear).
2. **Windows:** rodar `npm.cmd ci` e `npm.cmd run verify` e o seed em diretório novo (critério da Issue #5).
3. **E2E em navegador** do fluxo completo (recomendado pela Issue #5; não feito). Frontend continua sem testes automatizados.
4. **Decisões de negócio:** retenção LGPD do XML (ADR-005), hospedagem/PostgreSQL gerenciado, e-mail para recuperação de senha, licença Econet, e as 9 decisões listadas na seção 11 da especificação 2A.
5. Rate limit em memória (uma réplica); sem MFA; sem expiração por inatividade; sem RLS; sem Dependabot.
6. ~~Homologação com `validFrom` posterior a notas já importadas deixa essas notas sem fluxo~~ — tratado no PR #10 (pendência temporal, ADR-008), aguardando revisão. Risco residual: vigências disjuntas garantidas pela aplicação (lock), não por constraint de exclusão; bancos de desenvolvimento antigos podem ter notas órfãs (recriar `apps/api/.data`).
7. Se um processo de teste for morto, pode sobrar banco `cf_test_*` no PostgreSQL local; remover manualmente.

## Arquivos e módulos relevantes

| Para… | Veja |
|---|---|
| Servidor, sessão/CSRF, erros | `apps/api/src/app.ts`, `apps/api/src/errors.ts` (`asNotFound`) |
| Autorização por empresa/papel | `apps/api/src/auth/authorize.ts`, `loadReviewForStaff` em `modules/review.ts` |
| Regra de classificação e de vínculo do item | `apps/api/src/modules/classification.ts` (`classificationFor`, `selectReviewFor`, lacunas) |
| Pendência temporal (projeção e resolução) | `apps/api/src/modules/temporal-pendencies.ts`, ADR-008 |
| Importação de NF-e / XML íntegro | `apps/api/src/modules/documents.ts` |
| Harness e banco exclusivo de teste | `apps/api/src/test/harness.ts`, `pg-test-database.ts` |
| PGlite em disco | `apps/api/src/db/client.ts` (`ensurePgliteDataDir`) |
| Contratos do motor (só interfaces) | `packages/domain/src/tributario/index.ts` |
| Plano da Sprint 2A | `docs/SPRINT2A_ESPECIFICACAO.md`, `docs/adr/ADR-007-*` |
| Ameaças, audit de dependências | `docs/SEGURANCA.md` |

## Próxima ação exata para outro agente

1. `git fetch origin feat/sprint1-fundacao-segura && git checkout feat/sprint1-fundacao-segura && npm ci && npm run verify` — deve dar verde (69 testes).
2. Confirmar na aba Actions que o último SHA da branch está verde. Se não estiver, **corrigir antes de qualquer outra coisa**.
3. Não iniciar código da Sprint 2A até: (a) revisão humana do PR #7; (b) Henrique/Iza/Edson responderem às decisões da seção 11 de `docs/SPRINT2A_ESPECIFICACAO.md`, no mínimo o escopo do piloto (#1) e quem aprova regras (#2).
4. Liberada a 2A: criar branch nova a partir da `main` já com a Sprint 1 integrada (ou desta branch, se o PR #7 ainda não tiver sido mergeado — combinar com o revisor) e começar pelo incremento **2A.1 Catálogo** (seção 10 da especificação), com testes de isolamento e quatro olhos.
5. Nunca: fórmula de ICMS-ST/antecipação/DIFAL/rateio, conteúdo Econet sem licença confirmada, dados reais, merge na `main`, push forçado.
