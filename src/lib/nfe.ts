import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Somente leitura de NF-e modelo 55.
 * Não interpreta incidência, alíquotas, bases legais ou crédito tributário.
 */
export const MAX_XML_BYTES = 5 * 1024 * 1024;

type XmlNode = Record<string, unknown>;

export interface DeclaredTaxes {
  origin: string;
  cst: string;
  csosn: string;
  icmsCents: number | null;
  icmsStCents: number | null;
  ipiCents: number | null;
}

export interface InvoiceItem {
  line: number;
  code: string;
  description: string;
  ncm: string;
  cest: string;
  cfop: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  productCents: number;
  freightCents: number | null;
  insuranceCents: number | null;
  discountCents: number | null;
  otherCents: number | null;
  declaredTaxes: DeclaredTaxes;
}

export interface Invoice {
  accessKey: string;
  number: string;
  series: string;
  issuedAt: string;
  operation: string;
  issuer: { name: string; document: string; state: string };
  recipient: { name: string; document: string; state: string };
  items: InvoiceItem[];
  totals: {
    productCents: number | null;
    invoiceCents: number | null;
    freightCents: number | null;
    insuranceCents: number | null;
    discountCents: number | null;
    otherCents: number | null;
  };
  warnings: string[];
}

function record(value: unknown): XmlNode {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function field(node: XmlNode, key: string): string {
  return text(node[key]);
}

/** Decimais monetários do XML -> centavos, sem cálculos binários com frações. */
export function readCents(value: string): number | null {
  if (!value || !/^\d{1,15}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

function money(node: XmlNode, key: string): number | null {
  return readCents(field(node, key));
}

function requiredMoney(node: XmlNode, key: string, context: string): number {
  const raw = field(node, key);
  const amount = readCents(raw);
  if (amount === null) throw new Error(context + ": valor monetário inválido ou ausente em " + key + ".");
  return amount;
}

function person(value: unknown): Invoice["issuer"] {
  const node = record(value);
  const addr = record(node.enderEmit ?? node.enderDest);
  return {
    name: field(node, "xNome") || "Não informado",
    document: field(node, "CNPJ") || field(node, "CPF") || "Não informado",
    state: field(addr, "UF") || "—",
  };
}

function taxValues(value: unknown): DeclaredTaxes {
  const tax = record(value);
  const icms = record(tax.ICMS);
  const first = record(Object.values(icms)[0]);
  const ipi = record(record(tax.IPI).IPITrib);
  return {
    origin: field(first, "orig"),
    cst: field(first, "CST"),
    csosn: field(first, "CSOSN"),
    icmsCents: money(first, "vICMS"),
    icmsStCents: money(first, "vICMSST"),
    ipiCents: money(ipi, "vIPI"),
  };
}

function parseItem(value: unknown, index: number): InvoiceItem {
  const node = record(value);
  const prod = record(node.prod);
  const line = Number(field(node, "@_nItem"));
  if (!field(prod, "xProd") || !field(prod, "cProd")) {
    throw new Error("Item " + (index + 1) + ": produto sem descrição ou código.");
  }
  return {
    line: Number.isSafeInteger(line) && line > 0 ? line : index + 1,
    code: field(prod, "cProd"),
    description: field(prod, "xProd"),
    ncm: field(prod, "NCM"),
    cest: field(prod, "CEST"),
    cfop: field(prod, "CFOP"),
    quantity: field(prod, "qCom"),
    unit: field(prod, "uCom"),
    unitPrice: field(prod, "vUnCom"),
    productCents: requiredMoney(prod, "vProd", "Item " + (index + 1)),
    freightCents: money(prod, "vFrete"),
    insuranceCents: money(prod, "vSeg"),
    discountCents: money(prod, "vDesc"),
    otherCents: money(prod, "vOutro"),
    declaredTaxes: taxValues(node.imposto),
  };
}

function compare(
  items: InvoiceItem[],
  key: "productCents" | "freightCents" | "insuranceCents" | "discountCents" | "otherCents",
  total: number | null,
  label: string,
  warnings: string[],
): void {
  if (total === null) {
    warnings.push("Total de " + label + " ausente ou inválido no XML.");
    return;
  }
  const values = items.map((item) => item[key]);
  const provided = values.filter((value): value is number => value !== null);
  if (provided.length === 0) {
    if (total > 0) warnings.push(label + ": valor declarado no total, sem distribuição por item no XML.");
    return;
  }
  const itemSum = provided.reduce((sum, value) => sum + value, 0);
  if (itemSum !== total) {
    warnings.push(
      label + ": total dos itens (" + (itemSum / 100).toFixed(2) +
      ") diverge do total declarado (" + (total / 100).toFixed(2) + ").",
    );
  }
}

export function parseNfe(xml: string): Invoice {
  if (!xml.trim()) throw new Error("O arquivo XML está vazio.");
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) {
    throw new Error("O XML excede o limite de 5 MB.");
  }
  // Não aceitar DTD ou entidades declaradas: NF-e não exige nenhum dos dois.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new Error("XML com DTD ou entidades declaradas não é permitido.");
  }
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error("XML malformado. Verifique se o arquivo é uma NF-e válida.");

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
    trimValues: true,
  });
  const root = record(parser.parse(xml));
  const wrapper = record(root.nfeProc);
  const nfe = record(wrapper.NFe ?? root.NFe);
  const info = record(nfe.infNFe);
  const ide = record(info.ide);
  if (!Object.keys(info).length || field(ide, "mod") !== "55") {
    throw new Error("Arquivo não reconhecido como NF-e modelo 55 (nfeProc/NFe).");
  }

  const rawItems = info.det;
  const rawList = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  if (!rawList.length || rawList.length > 2000) {
    throw new Error("NF-e sem itens ou com quantidade de itens acima do limite de leitura.");
  }
  const items = rawList.map(parseItem);
  const totalsNode = record(record(info.total).ICMSTot);
  const totals: Invoice["totals"] = {
    productCents: money(totalsNode, "vProd"),
    invoiceCents: money(totalsNode, "vNF"),
    freightCents: money(totalsNode, "vFrete"),
    insuranceCents: money(totalsNode, "vSeg"),
    discountCents: money(totalsNode, "vDesc"),
    otherCents: money(totalsNode, "vOutro"),
  };
  const warnings: string[] = [];
  compare(items, "productCents", totals.productCents, "Produtos", warnings);
  compare(items, "freightCents", totals.freightCents, "Frete", warnings);
  compare(items, "insuranceCents", totals.insuranceCents, "Seguro", warnings);
  compare(items, "discountCents", totals.discountCents, "Descontos", warnings);
  compare(items, "otherCents", totals.otherCents, "Outras despesas", warnings);

  if (totals.invoiceCents === null) warnings.push("Valor total da NF-e ausente ou inválido.");
  const id = field(info, "@_Id");
  const accessKey = id.startsWith("NFe") ? id.slice(3) : field(record(wrapper.protNFe).infProt as XmlNode || {}, "chNFe");
  if (!/^\d{44}$/.test(accessKey)) warnings.push("Chave de acesso não identificada com 44 dígitos.");
  if (!field(ide, "nNF") || !field(info, "@_Id")) {
    warnings.push("Identificação da nota incompleta; conferir com o XML original.");
  }

  return {
    accessKey,
    number: field(ide, "nNF"),
    series: field(ide, "serie"),
    issuedAt: field(ide, "dhEmi") || field(ide, "dEmi"),
    operation: field(ide, "natOp"),
    issuer: person(info.emit),
    recipient: person(info.dest),
    items,
    totals,
    warnings,
  };
}
