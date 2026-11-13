import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, formatCnpj, formatDate, formatDateTime, money, type Company, type DocumentSummary, type FiscalProfile, type OrgUser, type Role } from "../api";
import { useAuth } from "../auth";
import { DocumentBadge, Empty, ErrorBox, Loading, Notice, useLoad } from "../components";
import { Link, navigate } from "../router";

const MAX_XML_BYTES = 5 * 1024 * 1024;
const REGIMES = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI", "OUTRO"];
const REGIME_LABEL: Record<string, string> = { SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real", MEI: "MEI", OUTRO: "Outro" };

type Tab = "importar" | "historico" | "fiscal" | "acessos";

export function CompanyPage({ id }: { id: string }) {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>("importar");
  const company = useLoad(() => api<{ company: Company; role: Role }>("/api/companies/" + id), [id]);
  const current = useLoad(() => api<{ profile: FiscalProfile | null }>("/api/companies/" + id + "/fiscal-profiles/current"), [id]);

  if (company.loading) return <Loading />;
  if (company.error || !company.data) return <ErrorBox error={company.error ?? new Error("Empresa não encontrada.")} />;
  const c = company.data.company;
  const role = company.data.role;
  const staff = role === "admin" || role === "fiscal";
  const profile = current.data?.profile ?? null;

  return (
    <>
      <div className="eyebrow"><Link to="/empresas">Empresas</Link> / {c.legalName}</div>
      <div className="heading">
        <div>
          <h1>{c.tradeName || c.legalName}</h1>
          <p>{c.legalName} · {formatCnpj(c.cnpj)} · {c.uf}</p>
        </div>
        {profile ? (
          <span className="status success">{REGIME_LABEL[profile.regime] ?? profile.regime} · vigente desde {formatDate(profile.validFrom)}</span>
        ) : (
          <span className="status warning">Sem cadastro fiscal vigente</span>
        )}
      </div>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "importar"} onClick={() => setTab("importar")}>Importar NF-e</button>
        <button type="button" role="tab" aria-selected={tab === "historico"} onClick={() => setTab("historico")}>Histórico</button>
        <button type="button" role="tab" aria-selected={tab === "fiscal"} onClick={() => setTab("fiscal")}>Cadastro fiscal</button>
        {hasRole("admin") && <button type="button" role="tab" aria-selected={tab === "acessos"} onClick={() => setTab("acessos")}>Acessos</button>}
      </div>

      {tab === "importar" && <ImportTab company={c} hasProfile={!!profile} />}
      {tab === "historico" && <HistoryTab companyId={c.id} />}
      {tab === "fiscal" && <FiscalTab companyId={c.id} staff={staff} onChanged={() => current.reload()} />}
      {tab === "acessos" && hasRole("admin") && <AccessTab company={c} />}
    </>
  );
}

function ImportTab({ company, hasProfile }: { company: Company; hasProfile: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ document: DocumentSummary; duplicate: boolean; contentDiffers: boolean; pendingCount: number } | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setResult(null);
    if (!file) return;
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xml")) throw new Error("Selecione um arquivo .xml de NF-e.");
      if (file.size > MAX_XML_BYTES) throw new Error("O XML excede o limite de 5 MB.");
      const xml = await file.text();
      const response = await api<{ document: DocumentSummary; duplicate: boolean; contentDiffers: boolean; pendingCount: number }>(
        "/api/companies/" + company.id + "/documents?fileName=" + encodeURIComponent(file.name),
        { method: "POST", xml },
      );
      setResult(response);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <>
      {!hasProfile && <Notice tone="warning"><strong>Cadastro fiscal pendente.</strong> A importação funciona, mas a revisão tributária depende do cadastro que a Contar Brasil irá configurar para esta empresa.</Notice>}
      <section className="uploadpanel" aria-labelledby="upload-title">
        <div className="uploadicon" aria-hidden="true">XML</div>
        <div className="uploadcopy">
          <h2 id="upload-title">Importar NF-e</h2>
          <p>XML de NF-e modelo 55, até 5 MB, emitida para o CNPJ {formatCnpj(company.cnpj)}. O arquivo original é guardado com integridade (SHA-256) e fica disponível no histórico.</p>
        </div>
        <label className="uploadbutton" htmlFor="xml-file">{busy ? "Enviando…" : "Selecionar XML"}</label>
        <input id="xml-file" className="visuallyhidden" type="file" accept=".xml,text/xml,application/xml" onChange={onFile} disabled={busy} />
      </section>
      <Notice><strong>Limite desta versão:</strong> os valores exibidos são os declarados no XML. Produtos ainda não homologados pelo Fiscal aparecem como <em>pendentes de revisão</em>; nenhum ICMS-ST, antecipação, rateio ou custo é calculado.</Notice>
      <ErrorBox error={error} />
      {result && (
        <div className={"card resultcard " + (result.duplicate ? "warning" : "success")}>
          <strong>{result.duplicate ? "Esta NF-e já havia sido importada." : "NF-e importada."}</strong>
          <p>
            Nota nº {result.document.number} · série {result.document.series} · {result.document.itemCount} {result.document.itemCount === 1 ? "item" : "itens"} · total {money(result.document.totals.invoiceCents)}
            {result.duplicate && result.contentDiffers && " · atenção: o conteúdo enviado difere do arquivo já armazenado; o original foi mantido."}
            {!result.duplicate && " · " + result.pendingCount + " produto(s) encaminhado(s) à revisão fiscal."}
          </p>
          <Link to={"/documentos/" + result.document.id} className="button">Ver documento</Link>
        </div>
      )}
    </>
  );
}

function HistoryTab({ companyId }: { companyId: string }) {
  const { data, error, loading } = useLoad(() => api<{ documents: DocumentSummary[]; total: number }>("/api/companies/" + companyId + "/documents?limit=100"), [companyId]);
  return (
    <>
      <ErrorBox error={error} />
      {loading && <Loading />}
      {data && data.documents.length === 0 && <Empty title="Nenhuma NF-e importada ainda." />}
      {data && data.documents.length > 0 && (
        <section className="tablecard">
          <div className="tablehead"><h3>Notas importadas</h3><p>{data.total} documento(s) · ordem decrescente de importação</p></div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>NF-e</th><th>Emissão</th><th>Emitente</th><th>Total (XML)</th><th>Itens</th><th>Situação</th><th>Importada em</th></tr></thead>
              <tbody>
                {data.documents.map((doc) => (
                  <tr key={doc.id} className="clickable" onClick={() => navigate("/documentos/" + doc.id)}>
                    <td><strong>nº {doc.number}</strong><small>série {doc.series}{doc.fileName ? " · " + doc.fileName : ""}</small></td>
                    <td>{formatDate(doc.issuedAt)}</td>
                    <td>{doc.issuer.name}<small>{doc.issuer.document} · {doc.issuer.state}</small></td>
                    <td>{money(doc.totals.invoiceCents)}</td>
                    <td>{doc.itemCount}</td>
                    <td><DocumentBadge status={doc.status} /></td>
                    <td>{formatDateTime(doc.importedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function FiscalTab({ companyId, staff, onChanged }: { companyId: string; staff: boolean; onChanged: () => void }) {
  const list = useLoad(() => api<{ profiles: FiscalProfile[] }>("/api/companies/" + companyId + "/fiscal-profiles"), [companyId]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ regime: "SIMPLES_NACIONAL", cnaes: "", contribuinteIcms: true, source: "", notes: "", validFrom: new Date().toISOString().slice(0, 10) });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/companies/" + companyId + "/fiscal-profiles", {
        method: "POST",
        body: {
          regime: form.regime,
          cnaes: form.cnaes.split(/[\s,;]+/).filter(Boolean),
          contribuinteIcms: form.contribuinteIcms,
          source: form.source,
          notes: form.notes || undefined,
          validFrom: form.validFrom,
        },
      });
      setShowForm(false);
      setForm({ ...form, cnaes: "", source: "", notes: "" });
      list.reload();
      onChanged();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!staff && <Notice>O cadastro fiscal é mantido pela equipe da Contar Brasil. Em caso de divergência, entre em contato com o escritório.</Notice>}
      {staff && !showForm && <p><button type="button" className="button" onClick={() => setShowForm(true)}>Nova versão do cadastro fiscal</button></p>}
      {staff && showForm && (
        <form className="card form" onSubmit={onSubmit}>
          <h3>Nova versão</h3>
          <p className="muted">A versão anterior é preservada e encerrada no dia anterior ao início desta vigência. Autor e data ficam na trilha de auditoria.</p>
          <div className="formgrid">
            <label>Regime tributário
              <select value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })}>
                {REGIMES.map((r) => <option key={r} value={r}>{REGIME_LABEL[r]}</option>)}
              </select>
            </label>
            <label>Início da vigência
              <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required />
            </label>
            <label className="span2">CNAEs (7 dígitos, separados por vírgula)
              <input value={form.cnaes} onChange={(e) => setForm({ ...form, cnaes: e.target.value })} placeholder="4530703, 4530704" required />
            </label>
            <label className="span2">Origem da informação
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Ex.: Cartão CNPJ emitido em 10/11/2026" required />
            </label>
            <label className="checkbox span2">
              <input type="checkbox" checked={form.contribuinteIcms} onChange={(e) => setForm({ ...form, contribuinteIcms: e.target.checked })} /> Contribuinte do ICMS
            </label>
            <label className="span2">Observações
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </label>
          </div>
          <ErrorBox error={error} />
          <div className="actions">
            <button type="submit" className="button" disabled={busy}>{busy ? "Salvando…" : "Salvar versão"}</button>
            <button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </form>
      )}
      <ErrorBox error={list.error} />
      {list.loading && <Loading />}
      {list.data && list.data.profiles.length === 0 && <Empty title="Nenhuma versão de cadastro fiscal registrada." />}
      {list.data && list.data.profiles.length > 0 && (
        <section className="tablecard">
          <div className="tablehead"><h3>Versões do cadastro fiscal</h3><p>Histórico completo; a versão vigente não possui data de fim.</p></div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Versão</th><th>Regime</th><th>CNAEs</th><th>ICMS</th><th>Vigência</th><th>Origem</th><th>Registrada em</th></tr></thead>
              <tbody>
                {list.data.profiles.map((p) => (
                  <tr key={p.id} className={p.validTo === null ? "highlight" : ""}>
                    <td><strong>v{p.version}</strong>{p.validTo === null && <small>vigente</small>}</td>
                    <td>{REGIME_LABEL[p.regime] ?? p.regime}</td>
                    <td>{p.cnaes.join(", ")}</td>
                    <td>{p.contribuinteIcms ? "Contribuinte" : "Não contribuinte"}</td>
                    <td>{formatDate(p.validFrom)} → {p.validTo ? formatDate(p.validTo) : "em aberto"}</td>
                    <td>{p.source}{p.notes && <small>{p.notes}</small>}</td>
                    <td>{formatDateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function AccessTab({ company }: { company: Company }) {
  const access = useLoad(() => api<{ access: { userId: string; email: string; name: string; grantedAt: string }[] }>("/api/companies/" + company.id + "/access"), [company.id]);
  const users = useLoad(() => api<{ users: OrgUser[] }>("/api/organizations/" + company.organizationId + "/users"), [company.organizationId]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function grant() {
    setError(null);
    try {
      await api("/api/companies/" + company.id + "/access", { method: "POST", body: { userId: selected } });
      setSelected("");
      access.reload();
    } catch (failure) {
      setError(failure);
    }
  }
  async function revoke(userId: string) {
    setError(null);
    try {
      await api("/api/companies/" + company.id + "/access/" + userId, { method: "DELETE" });
      access.reload();
    } catch (failure) {
      setError(failure);
    }
  }

  const granted = new Set(access.data?.access.map((a) => a.userId) ?? []);
  const candidates = (users.data?.users ?? []).filter((u) => u.role === "cliente" && !granted.has(u.id));

  return (
    <>
      <Notice>Usuários com papel <strong>cliente</strong> só enxergam as empresas liberadas aqui. Administradores e Fiscal enxergam todas as empresas da organização.</Notice>
      <ErrorBox error={error ?? access.error ?? users.error} />
      <div className="card form">
        <h3>Liberar acesso</h3>
        <div className="actions">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Selecione um usuário cliente…</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
          </select>
          <button type="button" className="button" disabled={!selected} onClick={() => void grant()}>Liberar</button>
        </div>
      </div>
      {access.data && access.data.access.length === 0 && <Empty title="Nenhum usuário cliente com acesso a esta empresa." />}
      {access.data && access.data.access.length > 0 && (
        <section className="tablecard">
          <div className="tablehead"><h3>Usuários com acesso</h3></div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Nome</th><th>E-mail</th><th>Liberado em</th><th></th></tr></thead>
              <tbody>
                {access.data.access.map((a) => (
                  <tr key={a.userId}>
                    <td>{a.name}</td><td>{a.email}</td><td>{formatDateTime(a.grantedAt)}</td>
                    <td><button type="button" className="linkbutton danger" onClick={() => void revoke(a.userId)}>Revogar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
