import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

/**
 * Hash de senha com scrypt (nativo do Node, sem dependência externa).
 * Parâmetros: N=2^15, r=8, p=1, salt 16 bytes, chave 64 bytes — dentro das
 * recomendações atuais da OWASP para scrypt. O formato autodescritivo
 * permite elevar o custo no futuro sem invalidar hashes antigos.
 */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || expected.length === 0) return false;
  const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "A senha deve ter pelo menos " + MIN_PASSWORD_LENGTH + " caracteres.";
  if (password.length > 256) return "A senha é longa demais.";
  if (/^(.)\1+$/.test(password)) return "A senha não pode repetir um único caractere.";
  return null;
}
