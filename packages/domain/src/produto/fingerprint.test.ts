import { describe, expect, it } from "vitest";
import { normalizeDescription, productFingerprint } from "./fingerprint.ts";

describe("identidade de produto", () => {
  it("normaliza descrição sem alterar o significado", () => {
    expect(normalizeDescription("  Pastilha de Freio – Dianteira (Ñ)  ")).toBe("PASTILHA DE FREIO DIANTEIRA N");
  });

  it("gera a mesma chave para o mesmo produto com descrições equivalentes", () => {
    const a = productFingerprint({ ncm: "87083090", cest: "0100100", description: "Pastilha de freio" });
    const b = productFingerprint({ ncm: "87083090", cest: "0100100", description: "PASTILHA  DE FREIO." });
    expect(a).toBe(b);
    expect(a).toBe("87083090|0100100|PASTILHA DE FREIO");
  });

  it("diferencia produtos por NCM ou CEST", () => {
    const base = { ncm: "87083090", cest: "0100100", description: "Pastilha" };
    expect(productFingerprint(base)).not.toBe(productFingerprint({ ...base, ncm: "87083091" }));
    expect(productFingerprint(base)).not.toBe(productFingerprint({ ...base, cest: "" }));
  });
});
