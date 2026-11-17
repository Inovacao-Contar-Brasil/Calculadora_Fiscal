/**
 * APIs universais (WHATWG) usadas pelo domínio e disponíveis em Node 22+ e
 * navegadores. O domínio compila com `types: []` e `lib: ["ES2022"]` de
 * propósito — sem tipos de Node nem DOM — para não depender de plataforma.
 *
 * Antes, `@types/node` chegava aqui implicitamente pelas tipagens do Vitest 3;
 * com o Vitest 4 isso deixou de acontecer. Declarar só o necessário mantém a
 * fronteira explícita. Este arquivo é carregado apenas pelo tsconfig do domínio
 * (não é importado), então não colide com os tipos de Node/DOM dos apps.
 */
interface TextEncoder {
  encode(input?: string): Uint8Array;
}
declare var TextEncoder: { prototype: TextEncoder; new (): TextEncoder };
