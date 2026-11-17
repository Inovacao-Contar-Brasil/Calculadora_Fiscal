import { api, formatDate, formatDateTime, money, type DocumentItem, type DocumentSummary } from "../api";
import { useAuth } from "../auth";
import { ClassificationBadge, DocumentBadge, LoadError, useLoad } from "../components";
import { Alert, AppLink, Icon, Page, PageHeader, PageSkeleton, Panel, PanelGrid, Table } from "../ds";

type DocumentResponse = { document: DocumentSummary; company: { id: string; legalName: string }; items: DocumentItem[] };

export function DocumentPage({ id }: { id: string }) {
  const { hasRole } = useAuth();
  const staff = hasRole("admin", "fiscal");
  const { data, error, loading, reload } = useLoad(() => api<DocumentResponse>("/api/documents/" + id), [id]);
  if (loading) return <PageSkeleton label="Carregando NF-e…" />;
  if (error || !data) return <Page><LoadError error={error ?? new Error("Documento não encontrado.")} onRetry={reload} /></Page>;
  const { document: doc, company, items } = data;
  const pending = items.filter((i) => i.classificationStatus !== "HOMOLOGADO").length;

  return (
    <Page>
      <PageHeader
        eyebrow={<><AppLink href="/empresas">Empresas</AppLink> / <AppLink href={"/empresas/" + company.id}>{company.legalName}</AppLink></>}
        title={<>NF-e nº <span className="num">{doc.number}</span></>}
        subtitle={<>Série {doc.series} · emissão {formatDate(doc.issuedAt)} · {doc.operation || "—"} · importada em {formatDateTime(doc.importedAt)}{doc.fileName ? " (" + doc.fileName + ")" : ""}</>}
        actions={
          <a className="btn btn-secondary" href={"/api/documents/" + doc.id + "/xml"}>
            <Icon name="arrowUpRight" size={16} />
            Baixar XML original
          </a>
        }
      >
        <div className="px-detail-meta"><DocumentBadge status={doc.status} /></div>
      </PageHeader>

      <div className="cf-stack">
        {pending > 0 ? (
          <Alert tone="warning">
            <strong>{pending} {pending === 1 ? "produto aguarda" : "produtos aguardam"} revisão do Fiscal.</strong> Enquanto a classificação não for homologada, não há tributação, rateio ou custo definitivo para esses itens.
            {staff && <> Acompanhe em <AppLink href={"/revisao?companyId=" + company.id}>Revisão fiscal</AppLink>.</>}
          </Alert>
        ) : (
          <Alert tone="success">
            <strong>Todos os produtos têm enquadramento homologado.</strong> O cálculo tributário ainda não está disponível nesta versão; os valores continuam sendo os declarados no XML.
          </Alert>
        )}

        <PanelGrid>
          <Panel title="Totais declarados no XML" span="main" flush>
            <dl className="cf-metrics">
              <div><dt>Produtos</dt><dd className="num">{money(doc.totals.productCents)}</dd></div>
              <div><dt>Frete</dt><dd className="num">{money(doc.totals.freightCents)}</dd></div>
              <div><dt>Descontos</dt><dd className="num">{money(doc.totals.discountCents)}</dd></div>
              <div><dt>IPI</dt><dd className="num">{money(doc.totals.ipiCents)}</dd></div>
              <div className="cf-metric-total"><dt>Total da NF-e</dt><dd className="num">{money(doc.totals.invoiceCents)}</dd></div>
            </dl>
          </Panel>
          <Panel title="Identificação" span="side" flush>
            <dl className="px-dl">
              <div><dt>Emitente</dt><dd>{doc.issuer.name}<span className="px-cell-sub">{doc.issuer.document} · {doc.issuer.state}</span></dd></div>
              <div><dt>Destinatário</dt><dd>{doc.recipient.name}<span className="px-cell-sub">{doc.recipient.document} · {doc.recipient.state}</span></dd></div>
              <div><dt>Chave de acesso</dt><dd className="cf-code">{doc.accessKey}</dd></div>
              <div><dt>SHA-256</dt><dd className="cf-code" title={doc.sha256}>{doc.sha256.slice(0, 16)}…</dd></div>
            </dl>
          </Panel>
          {doc.warnings.length > 0 && (
            <Panel title="Pontos para conferir no XML" description="Alertas de consistência encontrados na leitura" span="full" flush>
              <ul className="cf-warnings">{doc.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </Panel>
          )}
          <Panel title="Produtos" description={<><span className="num">{items.length}</span> {items.length === 1 ? "item" : "itens"} · valores exatamente como declarados na NF-e</>} span="full" flush>
            <Table className="cf-table-labeled">
              <thead>
                <tr>
                  <th scope="col">Item / Produto</th>
                  <th scope="col">NCM / CEST</th>
                  <th scope="col">CFOP / CST</th>
                  <th scope="col">Qtd. × preço (XML)</th>
                  <th scope="col">Valor produto</th>
                  <th scope="col">Frete do item</th>
                  <th scope="col">Impostos declarados</th>
                  <th scope="col">Classificação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-cell-title">
                      <strong>{item.line}. {item.description}</strong>
                      <span className="px-cell-sub">Cód. {item.code}</span>
                    </td>
                    <td data-label="NCM / CEST" className="num">{item.ncm || "—"}<span className="px-cell-sub">CEST {item.cest || "não informado"}</span></td>
                    <td data-label="CFOP / CST" className="num">
                      {item.cfop || "—"}
                      <span className="px-cell-sub">{item.declaredTaxes.cst ? "CST " + item.declaredTaxes.cst : item.declaredTaxes.csosn ? "CSOSN " + item.declaredTaxes.csosn : "Sem CST/CSOSN"}</span>
                    </td>
                    <td data-label="Qtd. × preço" className="num">{item.quantity || "—"} {item.unit}<span className="px-cell-sub">{item.unitPrice || "—"}</span></td>
                    <td data-label="Valor produto" className="num">{money(item.productCents)}</td>
                    <td data-label="Frete do item" className="num">{money(item.freightCents)}</td>
                    <td data-label="Impostos declarados" className="num">
                      IPI {money(item.declaredTaxes.ipiCents)}
                      <span className="px-cell-sub">ICMS {money(item.declaredTaxes.icmsCents)} · ST {money(item.declaredTaxes.icmsStCents)}</span>
                    </td>
                    <td data-label="Classificação">
                      {staff && item.reviewItemId ? (
                        <AppLink href={"/revisao/" + item.reviewItemId}>
                          <ClassificationBadge status={item.classificationStatus} />
                        </AppLink>
                      ) : (
                        <ClassificationBadge status={item.classificationStatus} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </PanelGrid>
      </div>
    </Page>
  );
}
