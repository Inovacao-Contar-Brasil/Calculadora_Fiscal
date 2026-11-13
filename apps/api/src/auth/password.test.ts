import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password.ts";

describe("senhas", () => {
  it("gera hash autodescritivo com salt aleatório e verifica", async () => {
    const a = await hashPassword("minha-senha-forte-abc");
    const b = await hashPassword("minha-senha-forte-abc");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("minha-senha-forte-abc", a)).toBe(true);
    expect(await verifyPassword("minha-senha-forte-abd", a)).toBe(false);
    expect(await verifyPassword("qualquer", "formato-invalido")).toBe(false);
  });

  it("aplica a política mínima", () => {
    expect(validatePasswordPolicy("curta")).toMatch(/12 caracteres/);
    expect(validatePasswordPolicy("aaaaaaaaaaaaaaaa")).toMatch(/repetir/);
    expect(validatePasswordPolicy("senha-razoavel-123")).toBeNull();
  });
});
