import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { legalProvisions, legalSources, legalSourceSnapshots, taxRuleApprovals, taxRules, taxRuleVersionProvisions, taxRuleVersions } from "./db/schema.ts";

/**
 * Guardas permanentes da Sprint 2A (seção 8 da especificação):
 * - o catálogo não ganha colunas nem código de cálculo (alíquota, MVA, base…);
 * - nenhuma implementação concreta das interfaces do motor de cálculo;
 * - fixtures e testes nunca citam domínios oficiais nem bases licenciadas reais.
 * Se um destes testes falhar, NÃO o ajuste para passar: a mudança exige a
 * Sprint 2B e homologação expressa do Fiscal (Issue #3).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CALCULATION_TERMS = /aliquot|\bmva\b|mva_|_mva|basecalc|base_calc|base_st|basest|valor_?icms|icms_?st_?valor|percentual|percent|_rate\b|_cents\b|_bps\b|basis_?points/i;

function walk(dir: string, filter: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

describe("guarda: nenhum cálculo tributário na Sprint 2A.1", () => {
  it("tabelas do catálogo não têm colunas de alíquota, MVA, base, percentual ou valor", () => {
    const tables = { legalSources, legalSourceSnapshots, legalProvisions, taxRules, taxRuleVersions, taxRuleVersionProvisions, taxRuleApprovals };
    for (const [table, definition] of Object.entries(tables)) {
      for (const column of Object.values(getTableColumns(definition))) {
        expect(column.name, table + "." + column.name).not.toMatch(CALCULATION_TERMS);
        // Nenhuma coluna numérica além de contadores de versão.
        if (column.dataType === "number") expect([table + "." + column.name]).toEqual([expect.stringMatching(/\.(version|conditions_schema_version)$/)]);
      }
    }
  });

  it("migrações do catálogo não criam colunas de cálculo", () => {
    // Derivado do journal (não de nomes fixos): a numeração mudou na integração com
    // as migrações temporais (CF-INTEG-01) e um nome fixo faria a guarda falhar ou,
    // pior, deixar de olhar a migração certa.
    const journal = JSON.parse(readFileSync(path.join(ROOT, "apps/api/drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const catalogFiles = journal.entries.filter((e) => /_catalogo_legal/.test(e.tag)).map((e) => e.tag + ".sql");
    expect(catalogFiles).toEqual(["0003_catalogo_legal.sql", "0004_catalogo_legal_integridade.sql"]);
    for (const file of catalogFiles) {
      const sqlText = readFileSync(path.join(ROOT, "apps/api/drizzle", file), "utf8");
      for (const line of sqlText.split("\n").filter((l) => /^\s*"\w+"\s+\w+/.test(l))) expect(line, file).not.toMatch(CALCULATION_TERMS);
      expect(sqlText).not.toMatch(/\b(numeric|decimal|real|double precision)\b/i);
    }
  });

  it("código do catálogo (domínio e API) não contém termos de cálculo", () => {
    const files = [
      ...walk(path.join(ROOT, "packages/domain/src/catalogo"), (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
      ...walk(path.join(ROOT, "apps/api/src/modules/catalog"), (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)) // comentários explicam a proibição; o código não pode usá-la
        .join("\n");
      expect(code, path.relative(ROOT, file)).not.toMatch(CALCULATION_TERMS);
    }
  });

  it("nenhuma implementação concreta das interfaces de cálculo existe no repositório", () => {
    const files = [...walk(path.join(ROOT, "apps"), (f) => /\.(ts|tsx)$/.test(f)), ...walk(path.join(ROOT, "packages"), (f) => /\.(ts|tsx)$/.test(f))];
    const pattern = /implements\s+(IcmsStCalculator|AntecipacaoCalculator|FreightAllocator|UnitCostComposer)\b|:\s*(IcmsStCalculator|AntecipacaoCalculator|FreightAllocator|UnitCostComposer)\s*=/;
    for (const file of files) expect(readFileSync(file, "utf8"), path.relative(ROOT, file)).not.toMatch(pattern);
  });
});

describe("guarda: fixtures e testes só com dados sintéticos", () => {
  // Montados por partes para que este arquivo não case consigo mesmo.
  const forbiddenHosts = [
    ["fazenda", "mg", "gov", "br"],
    ["confaz", "fazenda", "gov", "br"],
    ["planalto", "gov", "br"],
    ["receita", "fazenda", "gov", "br"],
    ["in", "gov", "br"],
    ["econet", "editora", "com", "br"],
  ].map((parts) => parts.join("."));
  const testFiles = () => [
    ...walk(path.join(ROOT, "apps/api/src"), (f) => (f.endsWith(".test.ts") || /fixtures/.test(f)) && !f.endsWith("guards.test.ts")),
    ...walk(path.join(ROOT, "packages/domain/src"), (f) => f.endsWith(".test.ts")),
  ];

  it("nenhum teste ou fixture cita domínio oficial ou base licenciada real", () => {
    for (const file of testFiles()) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const host of forbiddenHosts) expect(text.includes(host), path.relative(ROOT, file) + " contém " + host).toBe(false);
      expect(text, path.relative(ROOT, file)).not.toMatch(/econet/);
    }
  });

  it("URLs nas fixtures e testes do catálogo usam apenas o TLD reservado .invalid", () => {
    const files = testFiles().filter((f) => /catalog/.test(f));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        expect(match[1]!.endsWith(".invalid"), path.relative(ROOT, file) + ": " + match[0]).toBe(true);
      }
    }
  });
});
