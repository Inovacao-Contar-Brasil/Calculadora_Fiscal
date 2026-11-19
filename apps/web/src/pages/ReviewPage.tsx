import { useState, type FormEvent } from "react";
import { api, formatDate, formatDateTime, money, type ClassificationStatus, type Company, type ReviewItem, type TemporalPendency, type TemporalPendencyDetail } from "../api";
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
  const temporal = useLoad(() => api<{ items: TemporalPendency[] }>("/api/temporal-pendencies" + (companyId ? "?companyId=" + companyId : "")), [companyId]);

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
      <ErrorBox error={temporal.error} />
      {temporal.data && temporal.data.items.length > 0 && (
        <section className="tablecard">
          <div className="tablehead">
            <h3>Notas fora da vigência da homologação</h3>
            <p>A classificação homologada é válida, mas não cobre a data de emissão destas notas. Elas seguem pendentes até uma decisão para o período; a homologação existente não é alterada.</p>
          </div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Produto</th><th>Empresa</th><th>Homologação vigente</th><th>Notas pendentes</th><th>Emissões</th></tr></thead>
              <tbody>
                {temporal.data.items.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate("/revisao/" + p.id)}>
                    <td><strong>{p.product.description}</strong><small>{p.reason}</small></td>
                    <td>{p.companyName}</td>
                    <td>{formatDate(p.decision.validFrom)} → {p.decision.validTo ? formatDate(p.decision.validTo) : "em aberto"}</td>
                    <td>{p.origin.items} item(ns) em {p.origin.documents} NF-e</td>
                    <td>{formatDate(p.origin.firstIssueDate)} a {formatDate(p.origin.lastIssueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
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
  outOfValidityItems: number;
}

/**
 * Pendência temporal da decisão: notas emitidas fora da vigência. O Fiscal
 * registra uma decisão para um período sem decisão; a homologação exibida
 * acima não é alterada.
 */
function TemporalPendencyCard({ id, onResolved }: { id: string; onResolved: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api<TemporalPendencyDetail>("/api/temporal-pendencies/" + id), [id]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [form, setForm] = useState({ status: "HOMOLOGADO" as "HOMOLOGADO" | "REJEITADO", validFrom: "", validTo: "", enquadramento: "", fundamentoLegal: "", observacoes: "", justification: "" });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const { pendency, occurrences, uncoveredPeriods } = data;

  function choose(period: { from: string | null; to: string | null }) {
    const first = occurrences.map((o) => o.issuedAt.slice(0, 10)).filter((d) => (!period.from || d >= period.from) && (!period.to || d <= period.to)).sort()[0] ?? "";
    // Lacuna sem início definido: sugere o primeiro dia do mês da nota mais antiga (editável).
    setForm({ ...form, validFrom: period.from ?? (first ? first.slice(0, 8) + "01" : ""), validTo: period.to ?? "" });
    setOpen(true);
  }
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await api("/api/temporal-pendencies/" + id + "/resolve", {
        method: "POST",
        body: {
          status: form.status,
          validFrom: form.validFrom,
          validTo: form.validTo || undefined,
          justification: form.justification,
          decision: form.status === "HOMOLOGADO" || form.enquadramento ? { enquadramento: form.enquadramento, fundamentoLegal: form.fundamentoLegal, observacoes: form.observacoes || undefined } : undefined,
        },
      });
      setOpen(false);
      reload();
      onResolved();
    } catch (failure) {
      setActionError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card form">
      <div className="section-label">Pendência temporal</div>
      <Notice tone="warning">{pendency.reason}</Notice>
      <p className="muted">Períodos sem decisão com notas pendentes: {uncoveredPeriods.map((p) => (p.from ? formatDate(p.from) : "antes") + " → " + (p.to ? formatDate(p.to) : "em aberto") + " (" + p.items + ")").join(" · ")}</p>
      {!open && (
        <div className="actions">
          {uncoveredPeriods.map((p) => (
            <button key={(p.from ?? "") + (p.to ?? "")} type="button" className="button" onClick={() => choose(p)}>
              Registrar decisão para {p.from ? formatDate(p.from) : "o período"} → {p.to ? formatDate(p.to) : "em aberto"}
            </button>
          ))}
        </div>
      )}
      {open && (
        <form className="form" onSubmit={onSubmit}>
          <p className="muted">Registra uma nova decisão, apenas para o período informado. Classificação homologada não autoriza cálculo.</p>
          <div className="formgrid">
            <label>Decisão
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "HOMOLOGADO" | "REJEITADO" })}>
                <option value="HOMOLOGADO">Homologar o período</option>
                <option value="REJEITADO">Rejeitar o período</option>
              </select>
            </label>
            <span />
            <label>Início do período<input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required /></label>
            <label>Fim do período<input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} required /></label>
            {form.status === "HOMOLOGADO" && <label className="span2">Enquadramento<input value={form.enquadramento} onChange={(e) => setForm({ ...form, enquadramento: e.target.value })} required /></label>}
            {form.status === "HOMOLOGADO" && <label className="span2">Fundamento legal do período<textarea rows={2} value={form.fundamentoLegal} onChange={(e) => setForm({ ...form, fundamentoLegal: e.target.value })} required placeholder="Norma vigente no período, artigo/anexo e link oficial" /></label>}
            <label className="span2">Justificativa<textarea rows={2} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} required /></label>
          </div>
          <ErrorBox error={actionError} />
          <div className="actions"><button type="submit" className="button" disabled={busy}>Confirmar decisão do período</button><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancelar</button></div>
        </form>
      )}
    </div>
  );
}

export function ReviewDetailPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api<ReviewDetail>("/api/review-items/" + id), [id]);
  const [mode, setMode] = useState<"none" | "homologar" | "rejeitar" | "reabrir">("none");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [form, setForm] = useState({ enquadramento: "", fundamentoLegal: "", observacoes: "", justification: "", validFrom: new Date().toISOString().slice(0, 10), validTo: "", reason: "" });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Item não encontrado.")} />;
  const { item, company, occurrences, history, outOfValidityItems } = data;
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
      {outOfValidityItems > 0 && <TemporalPendencyCard id={item.id} onResolved={reload} />}

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
