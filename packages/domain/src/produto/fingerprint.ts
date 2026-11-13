import type { Invoice, InvoiceItem } from "../nfe/parser.ts";
import type { ProductIdentifier, ProductIdentity } from "../tributario/index.ts";

/**
 * Normaliza a descrição comercial para comparação: caixa alta, sem acentos,
 * sem pontuação e com espaços únicos. Não altera o dado original do XML.
 */
export function normalizeDescription(description: string): string {
  return description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chave de identidade do produto. É o que permite "lembrar" uma classificação
 * já homologada quando o mesmo produto reaparece em outra NF-e.
 *
 * Deliberadamente NÃO inclui o CNPJ do fornecedor nem o código interno dele:
 * o mesmo produto de fornecedores diferentes deve cair na mesma decisão.
 * A memorização respeita vigência (ver `Vigencia`), então uma mudança
 * legislativa encerra a decisão anterior sem apagar o histórico.
 */
export function productFingerprint(item: Pick<InvoiceItem, "ncm" | "cest" | "description">): string {
  return [item.ncm.trim(), item.cest.trim(), normalizeDescription(item.description)].join("|");
}

export class DefaultProductIdentifier implements ProductIdentifier {
  identify(item: InvoiceItem, _invoice: Invoice): ProductIdentity {
    return {
      fingerprint: productFingerprint(item),
      code: item.code,
      description: item.description,
      ncm: item.ncm,
      cest: item.cest || null,
      cfop: item.cfop,
      origin: item.declaredTaxes.origin,
    };
  }
}
