import { describe, expect, it } from "vitest";
import { cnpjCheckDigits, formatCnpj, isValidCnpj } from "./cnpj.ts";

describe("CNPJ", () => {
  it("calcula dígitos verificadores e valida", () => {
    const base = "112223330001";
    const cnpj = base + cnpjCheckDigits(base);
    expect(isValidCnpj(cnpj)).toBe(true);
    expect(isValidCnpj(formatCnpj(cnpj))).toBe(true);
  });

  it("rejeita sequências repetidas, tamanho errado e dígito inválido", () => {
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("1234")).toBe(false);
    const base = "112223330001";
    const wrong = base + String((Number(cnpjCheckDigits(base)) + 1) % 100).padStart(2, "0");
    expect(isValidCnpj(wrong)).toBe(false);
  });
});
