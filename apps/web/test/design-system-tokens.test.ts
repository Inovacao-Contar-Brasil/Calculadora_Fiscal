/*
 * Tokens e contraste da identidade Calculadora Fiscal sobre a camada oficial do
 * Design System (método de test/design-system-tokens.test.ts do Hub). Os
 * valores efetivos são theme.css (base por modo) sobrescritos por premium.css
 * (.hub-theme.hub-premium), exatamente como o navegador resolve na aplicação.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, FALLBACK_BRANDING, PLATFORM_LOGOS, brandStyle, resolveBrandIdentity } from "../src/theme/brand";
import { contrastRatio, organizationBrandingSchema } from "../src/theme/branding";
import { CONTRAST_PAIRS, DS_CONTRAST_PAIRS } from "../src/theme/contrastPairs";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const read = (file: string) => readFileSync(path.join(src, file), "utf8");

/** Declarações de custom properties por seletor de nível superior. */
function rules(css: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector = "", body = ""] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {};
    for (const [, name = "", value = ""] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declarations[name] = value.replace(/\s+/g, " ").trim();
    result.set(selector.trim(), { ...result.get(selector.trim()), ...declarations });
  }
  return result;
}

function resolver(env: Record<string, string>) {
  const resolve = (value: string, depth = 0): string => {
    if (depth > 10) throw new Error(`Referência circular: ${value}`);
    return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      const next = env[name];
      if (next === undefined) throw new Error(`Token não definido: ${name}`);
      return resolve(next, depth + 1);
    });
  };
  return (token: string) => resolve(`var(${token})`);
}

const theme = rules(read("theme/theme.css"));
const premium = rules(read("theme/premium.css"));
const effective = (mode: "light" | "dark") => ({
  ...theme.get(":root")!,
  ...premium.get(":root")!,
  ...theme.get(`.hub-theme[data-theme='${mode}']`)!,
  ...premium.get(`.hub-theme.hub-premium[data-theme='${mode}']`)!,
  ...brandStyle(DEFAULT_BRANDING),
});

describe("identidade padrão: Calculadora Fiscal", () => {
  it("é válida pelo contrato de marca e não carrega nome, cor ou logotipo da Contar Brasil", () => {
    expect(organizationBrandingSchema.parse(DEFAULT_BRANDING)).toEqual(DEFAULT_BRANDING);
    expect(DEFAULT_BRANDING).toMatchObject({ displayName: "Calculadora Fiscal", monogram: "CF" });
    expect(DEFAULT_BRANDING.primary["600"]).toBe("#366847");
    expect(Object.values(DEFAULT_BRANDING.primary)).not.toContain("#1b1e36"); // azul-marinho da Contar Brasil
    expect(PLATFORM_LOGOS).toBeNull();
    const identity = resolveBrandIdentity(undefined);
    expect(identity).toMatchObject({ source: "platform", logos: null });
  });

  it("marca inválida cai na identidade neutra, nunca na de outra organização", () => {
    const identity = resolveBrandIdentity({ schemaVersion: 1, displayName: "<x>", monogram: "??", primary: {} });
    expect(identity.source).toBe("fallback");
    expect(identity.branding).toEqual(FALLBACK_BRANDING);
    expect(identity.logos).toBeNull();
  });

  it("brandStyle só gera as 11 variáveis --brand-primary-*", () => {
    expect(Object.keys(brandStyle(DEFAULT_BRANDING))).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => `--brand-primary-${s}`));
  });
});

describe.each(["light", "dark"] as const)("contraste WCAG AA no modo %s (camada oficial)", (mode) => {
  const value = resolver(effective(mode));
  const pairs = [...CONTRAST_PAIRS, ...DS_CONTRAST_PAIRS].filter((pair) => !pair.modes || pair.modes.includes(mode));

  it.each(pairs.map((pair) => [pair.label, pair] as const))("%s", (_label, pair) => {
    const fg = value(pair.foreground);
    const bg = value(pair.background);
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${pair.foreground}=${fg} sobre ${pair.background}=${bg}`).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(pair.min);
  });

  it("status nunca vem da marca", () => {
    const env = effective(mode);
    for (const token of ["--color-success", "--color-warning", "--color-danger", "--color-info"]) {
      expect(env[token], token).not.toMatch(/--brand-primary/);
    }
  });
});
