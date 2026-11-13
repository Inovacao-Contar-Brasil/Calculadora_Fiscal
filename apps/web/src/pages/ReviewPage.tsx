import { useState, type FormEvent } from "react";
import { api, formatDate, formatDateTime, money, type ClassificationStatus, type Company, type ReviewItem } from "../api";
import { ClassificationBadge, Empty, ErrorBox, Loading, Notice, useLoad } from "../components";
import { Link, navigate } from "../router";

const STATUSES: ClassificationStatus[] = ["PENDENTE_REVISAO", "EM_ANALISE", "HOMOLOGADO", "REJEITADO"];

export function ReviewQueuePage() {
  const params = new URLSearchParams(window.location.search);
  const [companyId, setCompanyId] = useState(params.get("companyId") ?? "");
  const [status, setStatus] = useState<ClassificationStatus | "">((params.get("status") as ClassificationStatus | null) ?? "PENDENTE_REVISAO");
  const companies = useLoad(() => api<{ companies: Company[] }>("/api/companies"), []);
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  if (status) query.set("status", status);
  const list = useLoad(() => api<{ items: ReviewItem[] }>("/api/review-items?" + query.toString()), [companyId, status]);

  return (
    <>
      <div className="eyebrow">Revisão fiscal</div>
      <div className="heading">
        <div>
          <h1>Produtos para classificação</h1>
          <p>Cada produto novo importado pelos clientes entra aqui como pendente. A homologação registra o enquadramento e o fundamento legal; nenhum valor é calculado nesta etapa.</p>
        </div>
      </div>
      <div className="filters">
        <label>Empresa
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Todas</option>
            {(companies.data?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
          </select>
        </label>
        <label>Situação
          <select value={status} onChange={(e) => setStatus(e.target.value as ClassificationStatus | "")}>
            <option value="">Todas (vigentes)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
      </div>
      <ErrorBox error={list.error} />
      {list.loading && <Loading />}
      {list.data && list.data.items.length === 0 && <Empty title="Nenhum produto nesta situação." />}
      {list.data && list.data.items.length > 0 && (
        <section className="tablecard">
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Produto</th><th>NCM / CEST</th><th>Empresa</th><th>Ocorrências</th><th>Situação</th><th>Atualizado</th></tr></thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id} className="clickable" onClick={() => navigate("/revisao/" + item.id)}>
                    <td><strong>{item.description}</strong></td>
                    <td>{item.ncm}<small>CEST {item.cest || "não informado"}</small></td>
                    <td>{item.companyName}</td>
                    <td>{item.occurrences}</td>
                    <td><ClassificationBadge status={item.status} /></td>
                    <td>{formatDateTime(item.updatedAt)}</td>
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

interface ReviewDetail {
  item: ReviewItem;
  company: { id: string; legalName: string };
  occurrences: { documentId: string; number: string; issuedAt: string; issuerName: string; line: number; productCents: number; classificationStatus: ClassificationStatus }[];
  history: ReviewItem[];
}

export function ReviewDetailPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api<ReviewDetail>("/api/review-items/" + id), [id]);
  const [mode, setMode] = useState<"none" | "homologar" | "rejeitar" | "reabrir">("none");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [form, setForm] = useState({ enquadramento: "", fundamentoLegal: "", observacoes: "", justification: "", validFrom: new Date().toISOString().slice(0, 10), validTo: "", reason: "" });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Item não encontrado.")} />;
  const { item, company, occurrences, history } = data;
  const open = item.validTo === null;
  const final = item.status === "HOMOLOGADO" || item.status === "REJEITADO";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setMode("none");
      reload();
    } catch (failure) {
      setActionError(failure);
    } finally {
      setBusy(false);
    }
  }
  const patch = (body: Record<string, unknown>) => api("/api/review-items/" + item.id, { method: "PATCH", body });

  function onHomologar(event: FormEvent) {
    event.preventDefault();
    void run(() => patch({ status: "HOMOLOGADO", justification: form.justification, validFrom: form.validFrom, decision: { enquadramento: form.enquadramento, fundamentoLegal: form.fundamentoLegal, observacoes: form.observacoes || undefined } }));
  }
  function onRejeitar(event: FormEvent) {
    event.preventDefault();
    void run(() => patch({ status: "REJEITADO", justification: form.justification }));
  }
  function onReabrir(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await api<{ item: ReviewItem }>("/api/review-items/" + item.id + "/reopen", { method: "POST", body: { validTo: form.validTo, reason: form.reason } });
      navigate("/revisao/" + created.item.id);
    });
  }

  return (
    <>
      <div className="eyebrow"><Link to="/revisao">Revisão fiscal</Link> / {company.legalName}</div>
      <div className="heading">
        <div>
          <h1>{item.description}</h1>
          <p>NCM {item.ncm} · CEST {item.cest || "não informado"} · {item.occurrences} ocorrência(s) · <Link to={"/empresas/" + company.id}>{company.legalName}</Link></p>
        </div>
        <div className="statusgroup">
          <ClassificationBadge status={item.status} />
          {!open && <span className="badge rejeitado">Encerrado em {formatDate(item.validTo)}</span>}
        </div>
      </div>

      {item.decision && (
        <div className="card decision">
          <div className="section-label">Decisão registrada</div>
          <p><strong>Enquadramento:</strong> {item.decision.enquadramento}</p>
          <p><strong>Fundamento legal:</strong> {item.decision.fundamentoLegal}</p>
          {item.decision.observacoes && <p><strong>Observações:</strong> {item.decision.observacoes}</p>}
          <p className="muted">Vigência {formatDate(item.validFrom)} → {item.validTo ? formatDate(item.validTo) : "em aberto"} · decidido em {formatDateTime(item.decidedAt)}</p>
        </div>
      )}
      {item.justification && <Notice><strong>Justificativa:</strong> {item.justification}</Notice>}

      {open && (
        <div className="actions">
          {!final && item.status !== "EM_ANALISE" && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(() => patch({ status: "EM_ANALISE" }))}>Assumir análise</button>}
          {!final && <button type="button" className="button" onClick={() => setMode("homologar")}>Homologar enquadramento</button>}
          {!final && <button type="button" className="button danger" onClick={() => setMode("rejeitar")}>Rejeitar</button>}
          {final && <button type="button" className="button secondary" onClick={() => setMode("reabrir")}>Encerrar vigência e reabrir</button>}
        </div>
      )}
      <ErrorBox error={actionError} />

      {mode === "homologar" && (
        <form className="card form" onSubmit={onHomologar}>
          <h3>Homologar enquadramento</h3>
          <p className="muted">Registra apenas a classificação e o fundamento. Alíquotas, MVA e fórmulas entram no catálogo de regras após homologação formal (Issue #3).</p>
          <div className="formgrid">
            <label className="span2">Enquadramento<input value={form.enquadramento} onChange={(e) => setForm({ ...form, enquadramento: e.target.value })} required placeholder="Ex.: ICMS-ST — autopeças (Protocolo/Convênio a referenciar)" /></label>
            <label className="span2">Fundamento legal<textarea rows={2} value={form.fundamentoLegal} onChange={(e) => setForm({ ...form, fundamentoLegal: e.target.value })} required placeholder="Norma, artigo/anexo e link oficial" /></label>
            <label>Vigência a partir de<input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required /></label>
            <label className="span2">Observações<textarea rows={2} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
            <label className="span2">Justificativa<textarea rows={2} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} required /></label>
          </div>
          <div className="actions"><button type="submit" className="button" disabled={busy}>Confirmar homologação</button><button type="button" className="button secondary" onClick={() => setMode("none")}>Cancelar</button></div>
        </form>
      )}
      {mode === "rejeitar" && (
        <form className="card form" onSubmit={onRejeitar}>
          <h3>Rejeitar</h3>
          <label>Justificativa<textarea rows={3} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} required /></label>
          <div className="actions"><button type="submit" className="button danger" disabled={busy}>Confirmar rejeição</button><button type="button" className="button secondary" onClick={() => setMode("none")}>Cancelar</button></div>
        </form>
      )}
      {mode === "reabrir" && (
        <form className="card form" onSubmit={onReabrir}>
          <h3>Encerrar vigência e reabrir</h3>
          <p className="muted">Use quando a legislação mudar. A decisão atual é preservada até a data informada; notas emitidas depois voltam a pendente.</p>
          <div className="formgrid">
            <label>Fim da vigência<input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} required /></label>
            <label className="span2">Motivo<textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></label>
          </div>
          <div className="actions"><button type="submit" className="button" disabled={busy}>Confirmar</button><button type="button" className="button secondary" onClick={() => setMode("none")}>Cancelar</button></div>
        </form>
      )}

      <section className="tablecard">
        <div className="tablehead"><h3>Ocorrências em NF-e</h3><p>Últimas {occurrences.length} ocorrência(s) deste produto na empresa</p></div>
        <div className="tablewrap">
          <table className="compact">
            <thead><tr><th>NF-e</th><th>Emissão</th><th>Emitente</th><th>Item</th><th>Valor produto</th><th>Classificação</th></tr></thead>
            <tbody>
              {occurrences.map((o) => (
                <tr key={o.documentId + "-" + o.line} className="clickable" onClick={() => navigate("/documentos/" + o.documentId)}>
                  <td>nº {o.number}</td><td>{formatDate(o.issuedAt)}</td><td>{o.issuerName}</td><td>{o.line}</td><td>{money(o.productCents)}</td><td><ClassificationBadge status={o.classificationStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {history.length > 0 && (
        <section className="tablecard">
          <div className="tablehead"><h3>Outras decisões para este produto</h3></div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Situação</th><th>Vigência</th><th>Enquadramento</th><th>Registrado</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="clickable" onClick={() => navigate("/revisao/" + h.id)}>
                    <td><ClassificationBadge status={h.status} /></td>
                    <td>{h.validFrom ? formatDate(h.validFrom) : "—"} → {h.validTo ? formatDate(h.validTo) : "em aberto"}</td>
                    <td>{h.decision?.enquadramento ?? "—"}</td>
                    <td>{formatDateTime(h.createdAt)}</td>
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
