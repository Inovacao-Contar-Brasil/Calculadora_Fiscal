import { api, formatDate, formatDateTime, money, type DocumentItem, type DocumentSummary } from "../api";
import { useAuth } from "../auth";
import { ClassificationBadge, DocumentBadge, ErrorBox, Loading, Notice, useLoad } from "../components";
import { Link } from "../router";

function identity(document: string, name: string, state: string) {
  return <><strong>{name}</strong><span>{document} · {state}</span></>;
}

export function DocumentPage({ id }: { id: string }) {
  const { hasRole } = useAuth();
  const { data, error, loading } = useLoad(
    () => api<{ document: DocumentSummary; company: { id: string; legalName: string }; items: DocumentItem[] }>("/api/documents/" + id),
    [id],
  );
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Documento não encontrado.")} />;
  const { document: doc, company, items } = data;
  const pending = items.filter((i) => i.classificationStatus !== "HOMOLOGADO").length;

  return (
    <>
      <div className="eyebrow"><Link to="/empresas">Empresas</Link> / <Link to={"/empresas/" + company.id}>{company.legalName}</Link> / NF-e nº {doc.number}</div>
      <div className="heading">
        <div>
          <h1>NF-e nº {doc.number}</h1>
          <p>Série {doc.series} · Emissão {formatDate(doc.issuedAt)} · {doc.operation || "—"} · importada em {formatDateTime(doc.importedAt)}{doc.fileName ? " (" + doc.fileName + ")" : ""}</p>
        </div>
        <div className="statusgroup">
          <DocumentBadge status={doc.status} />
          <a className="button secondary" href={"/api/documents/" + doc.id + "/xml"}>Baixar XML original</a>
        </div>
      </div>

      <div className="info-grid">
        <div className="panel"><div className="section-label">Emitente</div>{identity(doc.issuer.document, doc.issuer.name, doc.issuer.state)}</div>
        <div className="panel"><div className="section-label">Destinatário</div>{identity(doc.recipient.document, doc.recipient.name, doc.recipient.state)}</div>
        <div className="panel"><div className="section-label">Chave de acesso</div><span className="key">{doc.accessKey}</span><span className="muted">SHA-256 {doc.sha256.slice(0, 16)}…</span></div>
      </div>

      <div className="summary">
        <div className="panel"><div className="section-label">Produtos (XML)</div><strong>{money(doc.totals.productCents)}</strong></div>
        <div className="panel"><div className="section-label">Frete (XML)</div><strong>{money(doc.totals.freightCents)}</strong></div>
        <div className="panel"><div className="section-label">Descontos (XML)</div><strong>{money(doc.totals.discountCents)}</strong></div>
        <div className="panel"><div className="section-label">IPI (XML)</div><strong>{money(doc.totals.ipiCents)}</strong></div>
        <div className="panel prominent"><div className="section-label">Total NF-e (declarado)</div><strong>{money(doc.totals.invoiceCents)}</strong></div>
      </div>

      {pending > 0 ? (
        <Notice tone="warning">
          <strong>{pending} {pending === 1 ? "produto aguarda" : "produtos aguardam"} revisão do Fiscal.</strong> Enquanto a classificação não for homologada, não há tributação, rateio ou custo definitivo para esses itens.
          {hasRole("admin", "fiscal") && <> Acompanhe em <Link to={"/revisao?companyId=" + company.id}>Revisão fiscal</Link>.</>}
        </Notice>
      ) : (
        <Notice tone="success"><strong>Todos os produtos têm enquadramento homologado.</strong> O cálculo tributário ainda não está disponível nesta versão; os valores abaixo continuam sendo os declarados no XML.</Notice>
      )}

      {doc.warnings.length > 0 && (
        <section className="alerts" aria-label="Alertas de consistência">
          <h3>Pontos para conferir no XML</h3>
          <ul>{doc.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        </section>
      )}

      <section className="tablecard">
        <div className="tablehead"><h3>Produtos</h3><p>{items.length} {items.length === 1 ? "item" : "itens"} · valores exatamente como declarados na NF-e</p></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Item / Produto</th><th>NCM / CEST</th><th>CFOP / CST</th><th>Qtd.</th><th>Preço unit. (XML)</th><th>Valor produto</th><th>Frete do item</th><th>IPI declarado</th><th>ICMS declarado</th><th>ST declarada</th><th>Classificação</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.line}. {item.description}</strong><small>Cód. {item.code}</small></td>
                  <td>{item.ncm || "—"}<small>CEST {item.cest || "não informado"}</small></td>
                  <td>{item.cfop || "—"}<small>{item.declaredTaxes.cst ? "CST " + item.declaredTaxes.cst : item.declaredTaxes.csosn ? "CSOSN " + item.declaredTaxes.csosn : "Sem CST/CSOSN"}</small></td>
                  <td>{item.quantity || "—"} {item.unit}</td>
                  <td>{item.unitPrice || "—"}</td>
                  <td>{money(item.productCents)}</td>
                  <td>{money(item.freightCents)}</td>
                  <td>{money(item.declaredTaxes.ipiCents)}</td>
                  <td>{money(item.declaredTaxes.icmsCents)}</td>
                  <td>{money(item.declaredTaxes.icmsStCents)}</td>
                  <td>
                    {hasRole("admin", "fiscal") && item.reviewItemId ? (
                      <Link to={"/revisao/" + item.reviewItemId}><ClassificationBadge status={item.classificationStatus} /></Link>
                    ) : (
                      <ClassificationBadge status={item.classificationStatus} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
