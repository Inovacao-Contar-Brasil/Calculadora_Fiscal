#!/usr/bin/env node
/**
 * Testes de mutação das garantias temporais (ADR-008, Issue #8, auditoria do PR #10).
 *
 * Para cada mutação: confere que o trecho original existe, aplica a alteração no
 * código-fonte, roda os testes que devem detectá-la e restaura o arquivo (sempre:
 * em `finally` e também em Ctrl+C). A mutação precisa FAZER OS TESTES FALHAREM;
 * se sobreviver, o script termina com erro. Antes, roda os mesmos testes sem
 * mutação, para garantir que a falha vem da mutação e não do ambiente.
 *
 * Mutações marcadas `postgresOnly` dependem de concorrência real: só rodam com
 * TEST_DATABASE_URL (no PGlite as transações são serializadas e a corrida não existe).
 *
 * Uso (na raiz): `npm run test:mutations` ou
 *   `TEST_DATABASE_URL=postgres://... npm run test:mutations`.
 * Se o processo for morto à força (SIGKILL), confira `git status`: um arquivo pode
 * ter ficado mutado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const api = (file) => path.join(root, "apps/api", file);
const T_TEMPORAL = "apps/api/src/modules/temporal-pendencies.test.ts";
const T_R2 = "apps/api/src/modules/temporal-pendencies-r2.test.ts";
const T_HISTORY = "apps/api/src/db/migration-history.test.ts";

const MUTATIONS = [
  {
    id: "M1",
    name: "resolução de pendência sem o lock do produto",
    file: api("src/modules/temporal-pendencies.ts"),
    from: "const open = await lockOpenReview(tx, row.companyId, row.fingerprint);",
    to: "const open = { id: \"MUTACAO\" };",
    test: T_TEMPORAL,
    filter: "duas resoluções simultâneas",
    postgresOnly: true,
  },
  {
    id: "M2",
    name: "importação vincula sempre ao item aberto (ignora a vigência)",
    file: api("src/modules/documents.ts"),
    from: "const review = selectReviewFor(open, closedRows.filter((row) => row.fingerprint === fingerprint), issueDate);",
    to: "const review = open;",
    test: T_TEMPORAL,
    filter: "a ordem de importação não altera",
  },
  {
    id: "M3",
    name: "reabertura move só as notas posteriores ao fim (regra antiga)",
    file: api("src/modules/review.ts"),
    from: "? sql`substr(issued_at, 1, 10) > ${request.body.validTo} or substr(issued_at, 1, 10) < ${row.validFrom}`",
    to: "? sql`substr(issued_at, 1, 10) > ${request.body.validTo}`",
    test: T_TEMPORAL,
    filter: "nota posterior ao encerramento",
  },
  {
    id: "M4",
    name: "decisão final aberta sem a guarda de vigências disjuntas",
    file: api("src/modules/review.ts"),
    from: "if (lastEnd && (validFrom === null || validFrom <= lastEnd)) {",
    to: "if (false) {",
    test: T_TEMPORAL,
    filter: "nota posterior ao encerramento",
  },
  {
    id: "M5",
    name: "P1: REJEITADO volta a ignorar a vigência",
    file: api("src/modules/classification.ts"),
    from: "if (!isFinalDecision(review)) return review.status;",
    to: "if (review.status !== \"HOMOLOGADO\") return review.status;",
    test: T_R2,
    filter: "P1: rejeição a partir de novembro",
  },
  {
    id: "M6",
    name: "P1: projeção de pendências só considera HOMOLOGADO",
    file: api("src/modules/temporal-pendencies.ts"),
    from: "inArray(reviewItems.status, [\"HOMOLOGADO\", \"REJEITADO\"])",
    to: "eq(reviewItems.status, \"HOMOLOGADO\")",
    test: T_R2,
    filter: "P1: rejeição a partir de novembro",
  },
  {
    id: "M7",
    name: "P2: lacunas calculadas a partir da página de ocorrências",
    file: api("src/modules/temporal-pendencies.ts"),
    from: "uncoveredPeriods: uncoveredPeriods(timeline, days),",
    to: "uncoveredPeriods: uncoveredPeriods(timeline, occurrences.map((o) => ({ issueDate: o.issuedAt.slice(0, 10), items: 1 }))),",
    test: T_R2,
    filter: "P2: pendência com mais de 500 itens",
  },
  // --- CF-INTEG-01: histórico de migrações integrado (migration-history.ts, docs/MIGRACOES.md) ---
  {
    id: "H1",
    name: "migrate() sem o guarda de histórico (legado do PR #9 passa)",
    file: api("src/db/migration-history.ts"),
    from: "  if (state.kind === \"LEGACY_PR9_CATALOG\") {\n    throw new MigrationHistoryError(\n      \"HISTORICO_LEGADO_PR9\",",
    to: "  if (false) {\n    throw new MigrationHistoryError(\n      \"HISTORICO_LEGADO_PR9\",",
    test: T_HISTORY,
    filter: "banco com o histórico antigo do PR #9",
  },
  {
    id: "H2",
    name: "journal com when fora de ordem aceito (catálogo pulado em silêncio)",
    file: api("src/db/migration-history.ts"),
    from: "    if (!(journal[i]!.when > journal[i - 1]!.when)) {",
    to: "    if (false) {",
    test: T_HISTORY,
    filter: "renumerar sem refazer o journal",
  },
  {
    id: "H3",
    name: "histórico com lacuna aceito como canônico",
    file: api("src/db/migration-history.ts"),
    from: "    const isPrefix = canonicalTags.every((tag, i) => journalTags[i] === tag);\n    if (!isPrefix) return",
    to: "    const isPrefix = true;\n    if (!isPrefix) return",
    test: T_HISTORY,
    filter: "classifica históricos",
  },
  {
    id: "H4",
    name: "reconciliação sem conferir o banco físico",
    file: api("src/db/migration-history.ts"),
    from: "    await assertPhysicalState(tx, state);",
    to: "    void assertPhysicalState;",
    test: T_HISTORY,
    filter: "histórico que não confere com o banco físico",
  },
  {
    id: "H5",
    name: "reconciliação não re-data o catálogo",
    file: api("src/db/migration-history.ts"),
    from: "    for (const row of current.retime) {",
    to: "    for (const row of current.retime.slice(2)) {",
    test: T_HISTORY,
    filter: "banco que passou pelo PR #9 e depois pelo PR #10",
  },
  {
    id: "H6",
    name: "reconciliação executa SQL fora da transação (falha parcial persiste)",
    file: api("src/db/migration-history.ts"),
    from: "      for (const statement of migration.statements) await tx.execute(sql.raw(statement));",
    to: "      for (const statement of migration.statements) await db.execute(sql.raw(statement));",
    test: T_HISTORY,
    filter: "falha parcial na reconciliação",
    // No PGlite há uma conexão só: `db` e `tx` são a mesma sessão e a mutação não muda nada.
    postgresOnly: true,
  },
  {
    id: "H7",
    name: "catálogo com o when original do PR #9 (renomeação ingênua)",
    file: api("drizzle/meta/_journal.json"),
    from: "\"when\": 1795097114553,",
    to: "\"when\": 1795005761201,",
    test: T_HISTORY,
    filter: "sequência exata",
  },
];

const postgres = !!process.env.TEST_DATABASE_URL;
let restore = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restore?.();
    process.exit(130);
  });
}

function runTests(test, filter) {
  const result = spawnSync("npx", ["vitest", "run", "--project", "api", test, "-t", filter], { cwd: root, env: process.env, encoding: "utf8" });
  return result.status === 0;
}

const results = [];
for (const mutation of MUTATIONS) {
  if (mutation.postgresOnly && !postgres) {
    results.push({ ...mutation, outcome: "NÃO EXECUTADA (exige TEST_DATABASE_URL)" });
    continue;
  }
  const original = readFileSync(mutation.file, "utf8");
  if (original.split(mutation.from).length !== 2) {
    console.error(mutation.id + ": trecho original não encontrado (ou repetido) em " + path.relative(root, mutation.file) + " — atualize o script.");
    process.exit(2);
  }
  if (!runTests(mutation.test, mutation.filter)) {
    console.error(mutation.id + ": os testes-alvo falham SEM mutação; corrija a suíte antes.");
    process.exit(2);
  }
  restore = () => writeFileSync(mutation.file, original);
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const passed = runTests(mutation.test, mutation.filter);
    results.push({ ...mutation, outcome: passed ? "SOBREVIVEU" : "detectada" });
  } finally {
    restore();
    restore = null;
  }
}

for (const r of results) console.log(r.id.padEnd(3) + " " + r.outcome.padEnd(42) + " " + r.name);
const survived = results.filter((r) => r.outcome === "SOBREVIVEU");
if (survived.length) {
  console.error("\n" + survived.length + " mutação(ões) sobreviveram: os testes não protegem essas garantias.");
  process.exit(1);
}
console.log("\nTodas as mutações executadas foram detectadas" + (postgres ? " (PostgreSQL real)." : " (PGlite; M1 e H6 exigem PostgreSQL)."));
