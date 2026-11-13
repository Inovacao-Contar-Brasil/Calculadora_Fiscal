import { useState, type ChangeEvent } from "react";
import { MAX_XML_BYTES, parseNfe, type Invoice } from "./lib/nfe";

const money = (value: number | null) =>
  value === null ? "Não informado" : (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function identity(document: string, name: string, state: string) {
  return <><strong>{name}</strong><span>{document} · {state}</span></>;
}

export default function App() {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setInvoice(null);
    setError("");
    setFileName("");
    if (!file) return;
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xml")) throw new Error("Selecione um arquivo .xml de NF-e.");
      if (file.size > MAX_XML_BYTES) throw new Error("O XML excede o limite de 5 MB.");
      const parsed = parseNfe(await file.text());
      setInvoice(parsed);
      setFileName(file.name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha na leitura do XML.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="site">
      <header className="topbar">
        <div className="brandmark" aria-hidden="true">CB</div>
        <div className="brand"><strong>Contar Brasil</strong><span>Calculadora Fiscal · Laboratório</span></div>
        <div className="toplabel">Leitor de NF-e • versão 0.1</div>
      </header>
      <main>
        <div className="eyebrow">Inovação & Tecnologia / Fiscal</div>
        <div className="heading">
          <div>
            <h1>Entenda os dados da sua nota.</h1>
            <p>Primeiro marco do projeto: extração e conferência preliminar de informações do XML, antes do motor tributário e da formação de custos.</p>
          </div>
          <span className="status">Protótipo interno</span>
        </div>

        <section className="uploadpanel" aria-labelledby="upload-title">
          <div className="uploadicon" aria-hidden="true">XML</div>
          <div className="uploadcopy">
            <h2 id="upload-title">Importar NF-e</h2>
            <p>Selecione um XML de NF-e modelo 55, com até 5 MB. O arquivo é lido somente neste navegador; não é enviado ou armazenado em servidores.</p>
          </div>
          <label className="uploadbutton" htmlFor="xml-file">{busy ? "Lendo..." : "Selecionar XML"}</label>
          <input id="xml-file" className="visuallyhidden" type="file" accept=".xml,text/xml,application/xml" onChange={onFile} disabled={busy} />
        </section>

        <div className="notice" role="note"><strong>Limite desta versão:</strong> os valores fiscais exibidos são os declarados no XML. Não calculamos ICMS-ST, antecipação, créditos recuperáveis, rateio nem custo unitário nesta etapa. Não use esta versão para precificação, recolhimento ou decisões fiscais.</div>
        {error && <div className="error" role="alert">{error}</div>}

        {invoice ? (
          <div className="results">
            <div className="resulthead">
              <div><div className="eyebrow">Arquivo lido: {fileName}</div><h2>NF-e nº {invoice.number || "Não identificado"}</h2><p>Série {invoice.series || "—"} · Emissão {invoice.issuedAt || "—"}</p></div>
              <span className={invoice.warnings.length ? "status warning" : "status success"}>
                {invoice.warnings.length ? invoice.warnings.length + " avisos de conferência" : "Somas de itens conferidas"}
              </span>
            </div>

            <div className="info-grid">
              <div className="panel"><div className="section-label">Emitente</div>{identity(invoice.issuer.document, invoice.issuer.name, invoice.issuer.state)}</div>
              <div className="panel"><div className="section-label">Destinatário</div>{identity(invoice.recipient.document, invoice.recipient.name, invoice.recipient.state)}</div>
              <div className="panel"><div className="section-label">Chave de acesso</div><span className="key">{invoice.accessKey || "Não identificada"}</span></div>
            </div>

            <div className="summary">
              <div className="panel"><div className="section-label">Produtos (XML)</div><strong>{money(invoice.totals.productCents)}</strong></div>
              <div className="panel"><div className="section-label">Frete (XML)</div><strong>{money(invoice.totals.freightCents)}</strong></div>
              <div className="panel"><div className="section-label">Descontos (XML)</div><strong>{money(invoice.totals.discountCents)}</strong></div>
              <div className="panel prominent"><div className="section-label">Total NF-e (declarado)</div><strong>{money(invoice.totals.invoiceCents)}</strong></div>
            </div>

            {invoice.warnings.length > 0 && (
              <section className="alerts" aria-label="Alertas de consistência">
                <h3>Pontos para conferir</h3>
                <ul>{invoice.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </section>
            )}

            <section className="tablecard">
              <div className="tablehead"><div><h3>Produtos identificados</h3><p>{invoice.items.length} {invoice.items.length === 1 ? "item" : "itens"} extraídos · Valores exatamente como declarados na NF-e</p></div></div>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Item / Produto</th><th>NCM / CEST</th><th>CFOP / CST</th><th>Qtd.</th><th>Preço unit. (XML)</th><th>Valor produto</th><th>Frete do item</th><th>ICMS declarado</th><th>ST declarada</th></tr></thead>
                  <tbody>
                  {invoice.items.map((item) => (
                    <tr key={item.line}>
                      <td><strong>{item.line}. {item.description}</strong><small>Cód. {item.code}</small></td>
                      <td>{item.ncm || "—"}<small>CEST {item.cest || "não informado"}</small></td>
                      <td>{item.cfop || "—"}<small>{item.declaredTaxes.cst ? "CST " + item.declaredTaxes.cst : item.declaredTaxes.csosn ? "CSOSN " + item.declaredTaxes.csosn : "Sem CST/CSOSN"}</small></td>
                      <td>{item.quantity || "—"} {item.unit}</td>
                      <td>{item.unitPrice || "—"}</td>
                      <td>{money(item.productCents)}</td>
                      <td>{money(item.freightCents)}</td>
                      <td>{money(item.declaredTaxes.icmsCents)}</td>
                      <td>{money(item.declaredTaxes.icmsStCents)}</td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="empty"><span aria-hidden="true">▧</span><strong>Seu arquivo aparecerá aqui.</strong><p>Carregue uma nota para visualizar os produtos e conferir os dados declarados.</p></div>
        )}
      </main>
      <footer>Contar Brasil · Protótipo de leitura documental · Nenhum cálculo fiscal homologado</footer>
    </div>
  );
}
