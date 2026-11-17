import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, formatCnpj, formatDate, formatDateTime, money, type Company, type DocumentSummary, type FiscalProfile, type OrgUser, type Role } from "../api";
import { useAuth } from "../auth";
import { ApiErrorAlert, DocumentBadge, LoadError, useLoad } from "../components";
import {
  Alert,
  AppLink,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  Input,
  Loading,
  Page,
  PageHeader,
  PageSkeleton,
  Panel,
  Select,
  Status,
  Table,
  Tabs,
  Textarea,
  type TabItem,
} from "../ds";

const MAX_XML_BYTES = 5 * 1024 * 1024;
const REGIMES = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI", "OUTRO"];
const REGIME_LABEL: Record<string, string> = { SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real", MEI: "MEI", OUTRO: "Outro" };

type ImportResult = { document: DocumentSummary; duplicate: boolean; contentDiffers: boolean; pendingCount: number };

export function CompanyPage({ id }: { id: string }) {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState("importar");
  const company = useLoad(() => api<{ company: Company; role: Role }>("/api/companies/" + id), [id]);
  const current = useLoad(() => api<{ profile: FiscalProfile | null }>("/api/companies/" + id + "/fiscal-profiles/current"), [id]);

  if (company.loading) return <PageSkeleton label="Carregando empresa…" />;
  if (company.error || !company.data) return <Page><LoadError error={company.error ?? new Error("Empresa não encontrada.")} onRetry={company.reload} /></Page>;
  const c = company.data.company;
  const role = company.data.role;
  const staff = role === "admin" || role === "fiscal";
  const profile = current.data?.profile ?? null;

  const tabs: TabItem[] = [
    { id: "importar", label: "Importar NF-e", content: <ImportTab company={c} hasProfile={!!profile} /> },
    { id: "historico", label: "Histórico", content: <HistoryTab companyId={c.id} /> },
    { id: "fiscal", label: "Cadastro fiscal", content: <FiscalTab companyId={c.id} staff={staff} onChanged={() => current.reload()} /> },
  ];
  if (hasRole("admin")) tabs.push({ id: "acessos", label: "Acessos", content: <AccessTab company={c} /> });

  return (
    <Page>
      <PageHeader
        eyebrow={<><AppLink href="/empresas">Empresas</AppLink> / {c.legalName}</>}
        title={c.tradeName || c.legalName}
        subtitle={<>{c.legalName} · <span className="num">{formatCnpj(c.cnpj)}</span> · {c.uf}</>}
      >
        <div className="px-detail-meta">
          {profile ? (
            <Status tone="success">{REGIME_LABEL[profile.regime] ?? profile.regime} · vigente desde {formatDate(profile.validFrom)}</Status>
          ) : (
            <Status tone="warning" outline>Sem cadastro fiscal vigente</Status>
          )}
        </div>
      </PageHeader>
      <Tabs label="Seções da empresa" items={tabs} selected={tab} onSelect={setTab} />
    </Page>
  );
}

function ImportTab({ company, hasProfile }: { company: Company; hasProfile: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

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
      setResult(await api<ImportResult>("/api/companies/" + company.id + "/documents?fileName=" + encodeURIComponent(file.name), { method: "POST", xml }));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="cf-stack">
      {!hasProfile && (
        <Alert tone="warning">
          <strong>Cadastro fiscal pendente.</strong> A importação funciona, mas a revisão tributária depende do cadastro que a Contar Brasil irá configurar para esta empresa.
        </Alert>
      )}
      <Panel title="Importar NF-e" description="O arquivo original é guardado com integridade (SHA-256) e fica disponível no histórico.">
        <div className="cf-upload">
          <span className="cf-upload-icon" aria-hidden="true"><Icon name="receipt" size={22} /></span>
          <div className="cf-upload-text">
            <p>XML de NF-e modelo 55, até 5 MB, emitida para o CNPJ <span className="num">{formatCnpj(company.cnpj)}</span>.</p>
          </div>
          <label className="btn btn-primary cf-file" aria-disabled={busy || undefined}>
            <Icon name="plus" size={16} />
            {busy ? "Enviando…" : "Selecionar XML"}
            <input className="sr-only" type="file" accept=".xml,text/xml,application/xml" onChange={onFile} disabled={busy} />
          </label>
        </div>
      </Panel>
      <Alert tone="info">
        <strong>Limite desta versão:</strong> os valores exibidos são os declarados no XML. Produtos ainda não homologados pelo Fiscal aparecem como <em>pendentes de revisão</em>; nenhum ICMS-ST, antecipação, rateio ou custo é calculado.
      </Alert>
      <ApiErrorAlert error={error} />
      {result && (
        <Alert tone={result.duplicate ? "warning" : "success"}>
          <strong>{result.duplicate ? "Esta NF-e já havia sido importada." : "NF-e importada."}</strong>{" "}
          Nota nº {result.document.number} · série {result.document.series} · {result.document.itemCount} {result.document.itemCount === 1 ? "item" : "itens"} · total {money(result.document.totals.invoiceCents)}
          {result.duplicate && result.contentDiffers && " · atenção: o conteúdo enviado difere do arquivo já armazenado; o original foi mantido."}
          {!result.duplicate && " · " + result.pendingCount + " produto(s) encaminhado(s) à revisão fiscal."}{" "}
          <AppLink href={"/documentos/" + result.document.id}>Ver documento</AppLink>
        </Alert>
      )}
    </div>
  );
}

function HistoryTab({ companyId }: { companyId: string }) {
  const { data, error, loading, reload } = useLoad(() => api<{ documents: DocumentSummary[]; total: number }>("/api/companies/" + companyId + "/documents?limit=100"), [companyId]);
  if (loading) return <Loading label="Carregando histórico…" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data || data.documents.length === 0) {
    return (
      <EmptyState icon="history" title="Nenhuma NF-e importada ainda">
        <p>As notas importadas aparecem aqui, da mais recente para a mais antiga.</p>
      </EmptyState>
    );
  }
  return (
    <Panel title="Notas importadas" description={<><span className="num">{data.total}</span> documento(s) · ordem decrescente de importação</>} flush>
      <Table>
        <thead>
          <tr>
            <th scope="col">NF-e</th>
            <th scope="col">Emissão</th>
            <th scope="col">Emitente</th>
            <th scope="col">Total (XML)</th>
            <th scope="col">Itens</th>
            <th scope="col">Situação</th>
            <th scope="col">Importada em</th>
          </tr>
        </thead>
        <tbody>
          {data.documents.map((doc) => (
            <tr key={doc.id}>
              <td className="px-cell-title">
                <AppLink href={"/documentos/" + doc.id} className="px-row-link">nº {doc.number}</AppLink>
                <span className="px-cell-sub">série {doc.series}{doc.fileName ? " · " + doc.fileName : ""}</span>
              </td>
              <td data-label="Emissão" className="num">{formatDate(doc.issuedAt)}</td>
              <td data-label="Emitente">{doc.issuer.name}<span className="px-cell-sub">{doc.issuer.document} · {doc.issuer.state}</span></td>
              <td data-label="Total (XML)" className="num">{money(doc.totals.invoiceCents)}</td>
              <td data-label="Itens" className="num">{doc.itemCount}</td>
              <td data-label="Situação"><DocumentBadge status={doc.status} /></td>
              <td data-label="Importada em" className="num">{formatDateTime(doc.importedAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
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
    <div className="cf-stack">
      {!staff && <Alert tone="info">O cadastro fiscal é mantido pela equipe da Contar Brasil. Em caso de divergência, entre em contato com o escritório.</Alert>}
      {staff && !showForm && (
        <div className="cf-actions">
          <Button onClick={() => setShowForm(true)}>
            <Icon name="plus" size={16} />
            Nova versão do cadastro fiscal
          </Button>
        </div>
      )}
      {staff && showForm && (
        <Panel title="Nova versão do cadastro fiscal" description="A versão anterior é preservada e encerrada no dia anterior ao início desta vigência. Autor e data ficam na trilha de auditoria." flush>
          <form className="px-form" onSubmit={onSubmit}>
            <div className="px-form-row">
              <Field label="Regime tributário">
                {(props) => (
                  <Select {...props} value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })}>
                    {REGIMES.map((r) => <option key={r} value={r}>{REGIME_LABEL[r]}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Início da vigência">
                {(props) => <Input {...props} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required />}
              </Field>
            </div>
            <Field label="CNAEs" hint="7 dígitos, separados por vírgula">
              {(props) => <Input {...props} value={form.cnaes} onChange={(e) => setForm({ ...form, cnaes: e.target.value })} placeholder="4530703, 4530704" required />}
            </Field>
            <Field label="Origem da informação">
              {(props) => <Input {...props} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Ex.: Cartão CNPJ emitido em 10/11/2026" required />}
            </Field>
            <Checkbox label="Contribuinte do ICMS" checked={form.contribuinteIcms} onChange={(e) => setForm({ ...form, contribuinteIcms: e.target.checked })} />
            <Field label="Observações">
              {(props) => <Textarea {...props} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />}
            </Field>
            <ApiErrorAlert error={error} />
            <div className="px-form-actions">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar versão"}</Button>
            </div>
          </form>
        </Panel>
      )}
      {list.loading ? (
        <Loading label="Carregando cadastro fiscal…" />
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.profiles.length === 0 ? (
        <EmptyState icon="layers" title="Nenhuma versão de cadastro fiscal registrada" />
      ) : (
        <Panel title="Versões do cadastro fiscal" description="Histórico completo; a versão vigente não possui data de fim." flush>
          <Table className="cf-table-labeled">
            <thead>
              <tr>
                <th scope="col">Versão</th>
                <th scope="col">Regime</th>
                <th scope="col">CNAEs</th>
                <th scope="col">ICMS</th>
                <th scope="col">Vigência</th>
                <th scope="col">Origem</th>
                <th scope="col">Registrada em</th>
              </tr>
            </thead>
            <tbody>
              {list.data.profiles.map((p) => (
                <tr key={p.id}>
                  <td className="px-cell-title">
                    <strong className="num">v{p.version}</strong>
                    {p.validTo === null && <span className="px-cell-sub"><Status tone="success">Vigente</Status></span>}
                  </td>
                  <td data-label="Regime">{REGIME_LABEL[p.regime] ?? p.regime}</td>
                  <td data-label="CNAEs" className="num">{p.cnaes.join(", ")}</td>
                  <td data-label="ICMS">{p.contribuinteIcms ? "Contribuinte" : "Não contribuinte"}</td>
                  <td data-label="Vigência" className="num">{formatDate(p.validFrom)} → {p.validTo ? formatDate(p.validTo) : "em aberto"}</td>
                  <td data-label="Origem">{p.source}{p.notes && <span className="px-cell-sub">{p.notes}</span>}</td>
                  <td data-label="Registrada em" className="num">{formatDateTime(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
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
    <div className="cf-stack">
      <Alert tone="info">Usuários com papel <strong>cliente</strong> só enxergam as empresas liberadas aqui. Administradores e Fiscal enxergam todas as empresas da organização.</Alert>
      <ApiErrorAlert error={error ?? access.error ?? users.error} />
      <Panel title="Liberar acesso" flush>
        <div className="px-form">
          <div className="px-form-row">
            <Field label="Usuário cliente">
              {(props) => (
                <Select {...props} value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">Selecione um usuário cliente…</option>
                  {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <div className="px-form-actions">
            <Button disabled={!selected} onClick={() => void grant()}>Liberar acesso</Button>
          </div>
        </div>
      </Panel>
      {access.loading ? (
        <Loading label="Carregando acessos…" />
      ) : access.data && access.data.access.length === 0 ? (
        <EmptyState icon="users" title="Nenhum usuário cliente com acesso a esta empresa" />
      ) : (
        access.data && (
          <Panel title="Usuários com acesso" flush>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Liberado em</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {access.data.access.map((a) => (
                  <tr key={a.userId}>
                    <td className="px-cell-title"><strong>{a.name}</strong></td>
                    <td data-label="E-mail">{a.email}</td>
                    <td data-label="Liberado em" className="num">{formatDateTime(a.grantedAt)}</td>
                    <td className="px-cell-actions">
                      <Button variant="danger" className="px-btn-sm" onClick={() => void revoke(a.userId)}>Revogar<span className="sr-only"> acesso de {a.name}</span></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )
      )}
    </div>
  );
}
