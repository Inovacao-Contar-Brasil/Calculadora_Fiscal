import { cnpjCheckDigits } from "@calculadora-fiscal/domain";

/** CNPJ sintético válido a partir de uma base de 12 dígitos. */
export function syntheticCnpj(base12: string): string {
  const base = base12.padStart(12, "0");
  return base + cnpjCheckDigits(base);
}

export interface SyntheticItem {
  code: string;
  description: string;
  ncm: string;
  cest?: string;
  cfop?: string;
  quantity?: string;
  unitPrice?: string;
  productCents: number;
  freightCents?: number;
}

export interface SyntheticNfe {
  /** 44 dígitos; default derivado do número. */
  accessKey?: string;
  number: string;
  issuedAt?: string;
  issuerCnpj?: string;
  issuerUf?: string;
  recipientCnpj: string;
  recipientUf?: string;
  items: SyntheticItem[];
}

const money = (cents: number) => (cents / 100).toFixed(2);

/** XML de NF-e modelo 55 inteiramente sintético para testes. Nunca usar dados reais. */
export function syntheticNfe(input: SyntheticNfe): string {
  const accessKey = input.accessKey ?? input.number.padStart(44, "3");
  const issuer = input.issuerCnpj ?? syntheticCnpj("999888777000");
  const totalProd = input.items.reduce((sum, item) => sum + item.productCents, 0);
  const totalFreight = input.items.reduce((sum, item) => sum + (item.freightCents ?? 0), 0);
  const dets = input.items
    .map(
      (item, index) =>
        '<det nItem="' + (index + 1) + '"><prod>' +
        "<cProd>" + item.code + "</cProd><xProd>" + item.description + "</xProd>" +
        "<NCM>" + item.ncm + "</NCM>" + (item.cest ? "<CEST>" + item.cest + "</CEST>" : "") +
        "<CFOP>" + (item.cfop ?? "6102") + "</CFOP><qCom>" + (item.quantity ?? "1.0000") + "</qCom><uCom>UN</uCom>" +
        "<vUnCom>" + (item.unitPrice ?? money(item.productCents) + "00000000") + "</vUnCom>" +
        "<vProd>" + money(item.productCents) + "</vProd>" +
        (item.freightCents !== undefined ? "<vFrete>" + money(item.freightCents) + "</vFrete>" : "") +
        "</prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>0.00</vICMS></ICMS00></ICMS></imposto></det>",
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<nfeProc versao="4.00"><NFe><infNFe Id="NFe' + accessKey + '" versao="4.00">' +
    "<ide><mod>55</mod><serie>1</serie><nNF>" + input.number + "</nNF><dhEmi>" + (input.issuedAt ?? "2026-11-10T09:00:00-03:00") + "</dhEmi><natOp>COMPRA PARA REVENDA</natOp></ide>" +
    "<emit><CNPJ>" + issuer + "</CNPJ><xNome>Fornecedor Sintético LTDA</xNome><enderEmit><UF>" + (input.issuerUf ?? "SP") + "</UF></enderEmit></emit>" +
    "<dest><CNPJ>" + input.recipientCnpj + "</CNPJ><xNome>Cliente Sintético LTDA</xNome><enderDest><UF>" + (input.recipientUf ?? "MG") + "</UF></enderDest></dest>" +
    dets +
    "<total><ICMSTot><vProd>" + money(totalProd) + "</vProd><vFrete>" + money(totalFreight) + "</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vOutro>0.00</vOutro><vNF>" + money(totalProd + totalFreight) + "</vNF></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>"
  );
}

export const ITEM_PASTILHA: SyntheticItem = { code: "PF-001", description: "Pastilha de freio dianteira", ncm: "87083090", cest: "0100100", productCents: 15000 };
export const ITEM_FILTRO: SyntheticItem = { code: "FO-010", description: "Filtro de óleo", ncm: "84212300", cest: "0101300", productCents: 4000, freightCents: 500 };
