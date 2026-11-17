import { useState, type FormEvent, type ReactNode } from "react";
import { api, formatDate, formatDateTime, money, type ClassificationStatus, type Company, type ReviewItem } from "../api";
import { ApiErrorAlert, CLASSIFICATION_STATUSES, ClassificationBadge, LoadError, classificationLabel, useLoad } from "../components";
import {
  Alert,
  AppLink,
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  Page,
  PageHeader,
  PageSkeleton,
  Panel,
  PanelGrid,
  Status,
  Table,
  Textarea,
} from "../ds";
import { navigate } from "../router";

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
    <Page>
      <PageHeader
        eyebrow="Revisão fiscal"
        title="Produtos para classificação"
        subtitle="Cada produto novo importado pelos clientes entra aqui como pendente. A homologação registra o enquadramento e o fundamento legal; nenhum valor é calculado nesta etapa."
      />
      <div className="px-toolbar" role="group" aria-label="Filtros">
        <div className="px-toolbar-selects">
          <label className="px-select-inline">
            <span>Empresa</span>
            <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Todas</option>
              {(companies.data?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
            </select>
          </label>
          <label className="px-select-inline">
            <span>Situação</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ClassificationStatus | "")}>
              <option value="">Todas (vigentes)</option>
              {CLASSIFICATION_STATUSES.map((s) => <option key={s} value={s}>{classificationLabel(s)}</option>)}
            </select>
          </label>
        </div>
      </div>
      {list.loading ? (
        <Loading label="Carregando fila…" />
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState icon="inbox" title="Nenhum produto nesta situação">
          <p>Altere os filtros para ver outras situações ou empresas.</p>
        </EmptyState>
      ) : (
        <Panel title="Fila de revisão" description={<><span className="num">{list.data.items.length}</span> produto(s)</>} flush>
          <Table>
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">NCM / CEST</th>
                <th scope="col">Empresa</th>
                <th scope="col">Ocorrências</th>
                <th scope="col">Situação</th>
                <th scope="col">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-cell-title">
                    <AppLink href={"/revisao/" + item.id} className="px-row-link">{item.description}</AppLink>
                  </td>
                  <td data-label="NCM / CEST" className="num">{item.ncm}<span className="px-cell-sub">CEST {item.cest || "não informado"}</span></td>
                  <td data-label="Empresa">{item.companyName}</td>
                  <td data-label="Ocorrências" className="num">{item.occurrences}</td>
                  <td data-label="Situação"><ClassificationBadge status={item.status} /></td>
                  <td data-label="Atualizado" className="num">{formatDateTime(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </Page>
  );
}

interface ReviewDetail {
  item: ReviewItem;
  company: { id: string; legalName: string };
  occurrences: { documentId: string; number: string; issuedAt: string; issuerName: string; line: number; productCents: number; classificationStatus: ClassificationStatus }[];
  history: ReviewItem[];
}

type Mode = "none" | "homologar" | "rejeitar" | "reabrir";

export function ReviewDetailPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api<ReviewDetail>("/api/review-items/" + id), [id]);
  const [mode, setMode] = useState<Mode>("none");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [form, setForm] = useState({ enquadramento: "", fundamentoLegal: "", observacoes: "", justification: "", validFrom: new Date().toISOString().slice(0, 10), validTo: "", reason: "" });

  if (loading) return <PageSkeleton label="Carregando produto…" />;
  if (error || !data) return <Page><LoadError error={error ?? new Error("Item não encontrado.")} onRetry={reload} /></Page>;
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
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

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

  const cancel = <Button variant="ghost" onClick={() => setMode("none")}>Cancelar</Button>;

  return (
    <Page>
      <PageHeader
        eyebrow={<><AppLink href="/revisao">Revisão fiscal</AppLink> / {company.legalName}</>}
        title={item.description}
        subtitle={<>NCM <span className="num">{item.ncm}</span> · CEST {item.cest || "não informado"} · <span className="num">{item.occurrences}</span> ocorrência(s) · <AppLink href={"/empresas/" + company.id}>{company.legalName}</AppLink></>}
        actions={open && !final ? <Button onClick={() => setMode("homologar")}>Homologar enquadramento</Button> : undefined}
      >
        <div className="px-detail-meta">
          <ClassificationBadge status={item.status} />
          {!open && <Status tone="neutral" outline>Encerrado em {formatDate(item.validTo)}</Status>}
        </div>
      </PageHeader>

      <div className="cf-stack">
        {open && (
          <div className="cf-actions" role="group" aria-label="Ações da revisão">
            {!final && item.status !== "EM_ANALISE" && <Button variant="secondary" disabled={busy} onClick={() => void run(() => patch({ status: "EM_ANALISE" }))}>Assumir análise</Button>}
            {!final && <Button variant="danger" onClick={() => setMode("rejeitar")}>Rejeitar</Button>}
            {final && <Button variant="secondary" onClick={() => setMode("reabrir")}>Encerrar vigência e reabrir</Button>}
          </div>
        )}
        <ApiErrorAlert error={actionError} />

        {mode === "homologar" && (
          <DecisionForm title="Homologar enquadramento" description="Registra apenas a classificação e o fundamento. Alíquotas, MVA e fórmulas entram no catálogo de regras após homologação formal (Issue #3)." onSubmit={onHomologar} actions={<>{cancel}<Button type="submit" disabled={busy}>Confirmar homologação</Button></>}>
            <Field label="Enquadramento">{(p) => <Input {...p} value={form.enquadramento} onChange={set("enquadramento")} required placeholder="Ex.: ICMS-ST — autopeças (Protocolo/Convênio a referenciar)" />}</Field>
            <Field label="Fundamento legal" hint="Norma, artigo/anexo e link oficial">{(p) => <Textarea {...p} rows={2} value={form.fundamentoLegal} onChange={set("fundamentoLegal")} required />}</Field>
            <div className="px-form-row">
              <Field label="Vigência a partir de">{(p) => <Input {...p} type="date" value={form.validFrom} onChange={set("validFrom")} required />}</Field>
            </div>
            <Field label="Observações">{(p) => <Textarea {...p} rows={2} value={form.observacoes} onChange={set("observacoes")} />}</Field>
            <Field label="Justificativa">{(p) => <Textarea {...p} rows={2} value={form.justification} onChange={set("justification")} required />}</Field>
          </DecisionForm>
        )}
        {mode === "rejeitar" && (
          <DecisionForm title="Rejeitar" onSubmit={onRejeitar} actions={<>{cancel}<Button type="submit" variant="danger" disabled={busy}>Confirmar rejeição</Button></>}>
            <Field label="Justificativa">{(p) => <Textarea {...p} rows={3} value={form.justification} onChange={set("justification")} required />}</Field>
          </DecisionForm>
        )}
        {mode === "reabrir" && (
          <DecisionForm title="Encerrar vigência e reabrir" description="Use quando a legislação mudar. A decisão atual é preservada até a data informada; notas emitidas depois voltam a pendente." onSubmit={onReabrir} actions={<>{cancel}<Button type="submit" disabled={busy}>Confirmar</Button></>}>
            <div className="px-form-row">
              <Field label="Fim da vigência">{(p) => <Input {...p} type="date" value={form.validTo} onChange={set("validTo")} required />}</Field>
            </div>
            <Field label="Motivo">{(p) => <Textarea {...p} rows={2} value={form.reason} onChange={set("reason")} required />}</Field>
          </DecisionForm>
        )}

        <PanelGrid>
          <Panel title="Decisão registrada" span="side" flush>
            {item.decision || item.justification ? (
              <dl className="px-dl cf-dl-wide">
                {item.decision?.enquadramento && <div><dt>Enquadramento</dt><dd>{item.decision.enquadramento}</dd></div>}
                {item.decision?.fundamentoLegal && <div><dt>Fundamento legal</dt><dd>{item.decision.fundamentoLegal}</dd></div>}
                {item.decision?.observacoes && <div><dt>Observações</dt><dd>{item.decision.observacoes}</dd></div>}
                {item.justification && <div><dt>Justificativa</dt><dd>{item.justification}</dd></div>}
                {item.decision && <div><dt>Vigência</dt><dd className="num">{formatDate(item.validFrom)} → {item.validTo ? formatDate(item.validTo) : "em aberto"}</dd></div>}
                {item.decidedAt && <div><dt>Decidido em</dt><dd className="num">{formatDateTime(item.decidedAt)}</dd></div>}
              </dl>
            ) : (
              <p className="px-aside-note">Nenhuma decisão registrada para este produto.</p>
            )}
          </Panel>
          <Panel title="Ocorrências em NF-e" description={<>Últimas <span className="num">{occurrences.length}</span> ocorrência(s) deste produto na empresa</>} span="main" flush>
            <Table>
              <thead>
                <tr>
                  <th scope="col">NF-e</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Emitente</th>
                  <th scope="col">Item</th>
                  <th scope="col">Valor produto</th>
                  <th scope="col">Classificação</th>
                </tr>
              </thead>
              <tbody>
                {occurrences.map((o) => (
                  <tr key={o.documentId + "-" + o.line}>
                    <td className="px-cell-title"><AppLink href={"/documentos/" + o.documentId} className="px-row-link">nº {o.number}</AppLink></td>
                    <td data-label="Emissão" className="num">{formatDate(o.issuedAt)}</td>
                    <td data-label="Emitente">{o.issuerName}</td>
                    <td data-label="Item" className="num">{o.line}</td>
                    <td data-label="Valor produto" className="num">{money(o.productCents)}</td>
                    <td data-label="Classificação"><ClassificationBadge status={o.classificationStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          {history.length > 0 && (
            <Panel title="Outras decisões para este produto" span="full" flush>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Enquadramento</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Vigência</th>
                    <th scope="col">Registrado</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-cell-title"><AppLink href={"/revisao/" + h.id} className="px-row-link">{h.decision?.enquadramento ?? "Sem enquadramento"}</AppLink></td>
                      <td data-label="Situação"><ClassificationBadge status={h.status} /></td>
                      <td data-label="Vigência" className="num">{h.validFrom ? formatDate(h.validFrom) : "—"} → {h.validTo ? formatDate(h.validTo) : "em aberto"}</td>
                      <td data-label="Registrado" className="num">{formatDateTime(h.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </PanelGrid>
        {!open && <Alert tone="info">Esta decisão foi encerrada. As notas emitidas depois do fim da vigência estão no item reaberto, listado em "Outras decisões".</Alert>}
      </div>
    </Page>
  );
}

function DecisionForm({ title, description, onSubmit, actions, children }: { title: string; description?: string; onSubmit: (event: FormEvent) => void; actions: ReactNode; children: ReactNode }) {
  return (
    <Panel title={title} description={description} flush>
      <form className="px-form" onSubmit={onSubmit}>
        {children}
        <div className="px-form-actions">{actions}</div>
      </form>
    </Panel>
  );
}
