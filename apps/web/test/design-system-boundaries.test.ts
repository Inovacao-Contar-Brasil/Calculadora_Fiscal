/*
 * Fronteiras do Design System na Calculadora (adaptado de
 * test/design-system-boundaries.test.ts do Hub; regras em docs/17 do Hub e
 * ADR-008). Lê o código-fonte: funciona como "lint" das regras visuais.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const read = (file: string) => readFileSync(path.join(src, file), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(src, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(src, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const importsOf = (file: string) => [...read(file).matchAll(/^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
const code = (files: string[]) => files.filter((f) => /\.(ts|tsx)$/.test(f));
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const dsFiles = walk("ds");
const themeFiles = walk("theme");
const appFiles = code(walk(".").filter((f) => !f.startsWith("ds/") && !f.startsWith("theme/")));
const MODULE_SHEETS = ["pages/pages.css", "pages/login.css"];

describe("Design System (src/ds) é só apresentação", () => {
  it("importa apenas de react, src/ds, src/theme e styles/global.css", () => {
    for (const file of code(dsFiles)) {
      for (const spec of importsOf(file)) {
        const external = !spec.startsWith(".");
        if (external) {
          expect(spec === "react" || spec.startsWith("@fontsource-variable/inter"), `${file} → ${spec}`).toBe(true);
          continue;
        }
        const target = path.normalize(path.join(path.dirname(file), spec));
        expect(target.startsWith("ds") || target.startsWith("theme") || target === "styles/global.css", `${file} → ${spec}`).toBe(true);
      }
    }
  });

  it("não busca dados, não navega e não conhece a API, o roteador ou a autenticação", () => {
    for (const file of code(dsFiles)) {
      const text = read(file);
      expect(text, file).not.toMatch(/fetch\(|window\.location|\/api\/|from ['"].*(router|auth|api)['"]/);
    }
  });

  it("só ds/styles.ts importa folhas, na ordem canônica, e lista todas as folhas do kit", () => {
    for (const file of code(dsFiles).filter((f) => f !== "ds/styles.ts")) {
      expect(importsOf(file).some((spec) => spec.endsWith(".css")), file).toBe(false);
    }
    const order = importsOf("ds/styles.ts");
    expect(order).toEqual([
      "@fontsource-variable/inter/opsz.css",
      "../styles/global.css",
      "../theme/theme.css",
      "../theme/premium.css",
      ...["base", "shell", "header", "menu", "page", "data", "patterns", "forms", "overlays", "responsive", "motion"].map((n) => `./styles/${n}.css`),
      "../theme/components.css",
    ]);
    const kit = dsFiles.filter((f) => f.startsWith("ds/styles/") && f.endsWith(".css")).map((f) => "./" + f.slice(3));
    expect(order.filter((s) => s.startsWith("./styles/")).sort()).toEqual(kit.sort());
  });

  it("folhas do kit não têm cor fixa", () => {
    for (const file of dsFiles.filter((f) => f.endsWith(".css"))) {
      expect(HEX.test(stripComments(read(file))), file).toBe(false);
    }
  });

  it("o tema depende só de react e do contrato local de marca", () => {
    for (const file of code(themeFiles)) {
      for (const spec of importsOf(file)) {
        expect(spec === "react" || spec === "zod" || spec.startsWith("./"), `${file} → ${spec}`).toBe(true);
      }
    }
  });
});

describe("Aplicação usa o Design System pela API pública", () => {
  it("telas importam do DS somente por ds/index (e ds/styles uma vez, na entrada)", () => {
    for (const file of appFiles) {
      for (const spec of importsOf(file)) {
        const target = path.normalize(path.join(path.dirname(file), spec));
        if (target.startsWith("theme")) throw new Error(`${file} importa o tema diretamente: ${spec}`);
        if (!target.startsWith("ds")) continue;
        const allowed = target === "ds" || (file === "main.tsx" && target === "ds/styles");
        expect(allowed, `${file} → ${spec}`).toBe(true);
      }
    }
  });

  it("folhas do módulo usam só tokens e não redefinem classes do kit", () => {
    for (const file of MODULE_SHEETS) {
      const css = stripComments(read(file));
      expect(HEX.test(css), `${file} tem cor fixa`).toBe(false);
      expect(css, file).not.toMatch(/rgb\(|hsl\(/);
      const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith("@"));
      for (const selector of selectors) {
        const ownPrefix = file === "pages/login.css" ? /^\.px-auth/ : /^\.cf-/;
        expect(ownPrefix.test(selector), `${file}: seletor fora do próprio prefixo: ${selector}`).toBe(true);
      }
    }
  });

  it("só a entrada carrega folhas globais; nenhuma folha legada sobrou", () => {
    expect(existsSync(path.join(src, "styles.css"))).toBe(false);
    const cssImporters = appFiles.filter((f) => importsOf(f).some((s) => s.endsWith(".css") || s === "./ds/styles"));
    expect(cssImporters.sort()).toEqual(["main.tsx", "pages/LoginPage.tsx"]);
  });

  it("nenhum dado fictício, protótipo ou logotipo do Hub foi trazido", () => {
    expect(existsSync(path.join(src, "design-system"))).toBe(false);
    expect(existsSync(path.join(src, "ui"))).toBe(false);
    expect(existsSync(path.resolve(src, "../public/branding/contarbrasil"))).toBe(false);
    for (const file of [...code(dsFiles), ...code(themeFiles), ...appFiles]) {
      expect(read(file), file).not.toMatch(/demoOrganizations|DEMO_ORGANIZATIONS|branding\/contarbrasil/);
    }
  });
});
