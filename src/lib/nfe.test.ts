import { describe, expect, it } from "vitest";
import { parseNfe, readCents } from "./nfe";

// XML sintético destinado exclusivamente aos testes. Nunca utilizar dados de clientes.
const id = "NFe" + "1".repeat(44);
const base = (itemTwo: string, totalProd = "300.00", totalFreight = "25.00") =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<nfeProc><NFe><infNFe Id="' + id + '">' +
  '<ide><mod>55</mod><serie>1</serie><nNF>50117</nNF><dhEmi>2026-11-13T09:00:00-03:00</dhEmi></ide>' +
  '<emit><CNPJ>11111111000111</CNPJ><xNome>Emitente Teste</xNome><enderEmit><UF>GO</UF></enderEmit></emit>' +
  '<dest><CNPJ>22222222000122</CNPJ><xNome>Destinatário Teste</xNome><enderDest><UF>MG</UF></enderDest></dest>' +
  '<det nItem="1"><prod><cProd>A</cProd><xProd>Peça A</xProd><NCM>87089990</NCM><CEST>0100100</CEST><CFOP>6102</CFOP><qCom>2.0000</qCom><uCom>UN</uCom><vUnCom>50.0000000000</vUnCom><vProd>100.00</vProd><vFrete>20.00</vFrete></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>12.00</vICMS></ICMS00></ICMS></imposto></det>' +
  itemTwo +
  '<total><ICMSTot><vProd>' + totalProd + '</vProd><vFrete>' + totalFreight + '</vFrete><vDesc>0.00</vDesc><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vNF>325.00</vNF></ICMSTot></total>' +
  '</infNFe></NFe></nfeProc>';

const secondItem =
  '<det nItem="2"><prod><cProd>B</cProd><xProd>Peça B</xProd><NCM>87089990</NCM><CFOP>6102</CFOP><qCom>1.0000</qCom><uCom>UN</uCom><vUnCom>200.0000000000</vUnCom><vProd>200.00</vProd><vFrete>5.00</vFrete></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>';

describe("parseNfe — leitura sem apuração tributária", () => {
  it("extrai cabeçalho, itens, tributação declarada e valores em centavos", () => {
    const result = parseNfe(base(secondItem));
    expect(result.number).toBe("50117");
    expect(result.accessKey).toBe("1".repeat(44));
    expect(result.issuer.state).toBe("GO");
    expect(result.recipient.state).toBe("MG");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].productCents).toBe(10000);
    expect(result.items[0].declaredTaxes.icmsCents).toBe(1200);
    expect(result.items[1].declaredTaxes.csosn).toBe("102");
    expect(result.totals.freightCents).toBe(2500);
    expect(result.warnings).toEqual([]);
  });

  it("lê e confere o IPI destacado por item e no total sem confundir com valor de produto", () => {
    const withIpi = base(secondItem)
      .replace("<vNF>325.00</vNF>", "<vIPI>10.00</vIPI><vNF>335.00</vNF>")
      .replace("</ICMS></imposto></det>", "</ICMS><IPI><IPITrib><vIPI>10.00</vIPI></IPITrib></IPI></imposto></det>");
    const result = parseNfe(withIpi);
    expect(result.items[0].declaredTaxes.ipiCents).toBe(1000);
    expect(result.totals.ipiCents).toBe(1000);
    expect(result.totals.productCents).toBe(30000);
    expect(result.totals.invoiceCents).toBe(33500);
    expect(result.warnings).toEqual([]);
  });

  it("sinaliza divergência em totais e nunca altera os valores declarados", () => {
    const result = parseNfe(base(secondItem, "301.00"));
    expect(result.totals.productCents).toBe(30100);
    expect(result.warnings.some((warning) => warning.includes("Produtos:"))).toBe(true);
  });

  it("sinaliza frete global quando ausente nos itens", () => {
    const item = secondItem.replace("<vFrete>5.00</vFrete>", "");
    const result = parseNfe(base(item));
    expect(result.warnings.some((warning) => warning.includes("Frete:"))).toBe(true);
  });

  it("rejeita documentos que não sejam NF-e modelo 55", () => {
    expect(() => parseNfe("<CTe><infCte /></CTe>")).toThrow(/modelo 55/);
  });

  it("rejeita DTD e entidades declaradas", () => {
    expect(() => parseNfe("<!DOCTYPE a [<!ENTITY x 'z'>]><NFe/>")).toThrow(/DTD/);
  });

  it("rejeita XML inválido", () => {
    expect(() => parseNfe("<nfeProc><NFe></nfeProc>")).toThrow(/malformado/);
  });

  it("interpreta centavos sem arredondamento de ponto flutuante", () => {
    expect(readCents("1.05")).toBe(105);
    expect(readCents("100.00")).toBe(10000);
    expect(readCents("1.234")).toBeNull();
    expect(readCents("R$ 1,00")).toBeNull();
  });
});
