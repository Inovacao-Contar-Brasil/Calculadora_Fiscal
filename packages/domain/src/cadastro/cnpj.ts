/** Validação de CNPJ numérico (14 dígitos). Não consulta a Receita; só confere os dígitos verificadores. */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function cnpjCheckDigits(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error("Base do CNPJ deve ter 12 dígitos.");
  const calc = (digits: string, weights: number[]) => {
    const sum = digits.split("").reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return String(d1) + String(d2);
}

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  return digits.slice(12) === cnpjCheckDigits(digits.slice(0, 12));
}

export function formatCnpj(digits: string): string {
  const d = onlyDigits(digits);
  if (d.length !== 14) return digits;
  return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
}
