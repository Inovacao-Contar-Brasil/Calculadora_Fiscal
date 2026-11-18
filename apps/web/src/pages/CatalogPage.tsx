import { useState, type FormEvent, type ReactNode } from "react";
import {
  api,
  formatDate,
  formatDateTime,
  type LegalProvision,
  type LegalSnapshot,
  type LegalSource,
  type ProvisionRole,
  type RuleOperation,
  type RuleVersion,
  type RuleVersionStatus,
  type RuleVersionSummary,
  type TaxRule,
  type WorkflowEntry,
} from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, Notice, useLoad } from "../components";
import { Link, navigate } from "../router";

/**
 * Interface mínima do catálogo legal (Sprint 2A.1). Toda regra de negócio
 * (quatro olhos, permissões, fundamentação) é aplicada pela API; a tela só
 * mostra o que o backend devolve em `availableOperations` e `readiness`.
 */

const STATUS_LABEL: Record<RuleVersionStatus, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO_TECNICA: "Em revisão técnica",
  APROVADA: "Aprovada",
  ATIVA: "Ativa",
  SUSPENSA: "Suspensa",
  SUBSTITUIDA: "Substituída",
  REVOGADA: "Revogada",
};
const ACTION_LABEL: Record<string, string> = {
  SUBMETE: "Submeteu à revisão",
  APROVA: "Aprovou",
  DEVOLVE: "Devolveu",
  ATIVA: "Ativou",
  SUSPENDE: "Suspendeu",
  REATIVA: "Reativou",
  REVOGA: "Revogou",
  SUBSTITUI: "Substituída",
};
const OPERATIONS: Record<RuleOperation, { path: string; label: string; tone: string; needsJustification: boolean; needsAuthorization?: boolean; needsEndDate?: boolean }> = {
  SUBMETE: { path: "submit", label: "Submeter à revisão técnica", tone: "button", needsJustification: false },
  APROVA: { path: "approve", label: "Aprovar", tone: "button", needsJustification: true },
  DEVOLVE: { path: "return", label: "Devolver ao autor", tone: "button secondary", needsJustification: true },
  ATIVA: { path: "activate", label: "Ativar", tone: "button", needsJustification: true, needsAuthorization: true },
  SUSPENDE: { path: "suspend", label: "Suspender", tone: "button danger", needsJustification: true },
  REATIVA: { path: "reactivate", label: "Reativar", tone: "button", needsJustification: true, needsAuthorization: true },
  REVOGA: { path: "revoke", label: "Revogar", tone: "button danger", needsJustification: true, needsEndDate: true },
};
const LICENSE_LABEL: Record<string, string> = {
  OFICIAL_PUBLICO: "Oficial público",
  LICENCIADO_CONFIRMADO: "Licença confirmada",
  LICENCA_NAO_VERIFICADA: "Licença NÃO verificada",
  INTERNO: "Interno",
};
const CATEGORY_LABEL: Record<string, string> = {
  NORMATIVA_OFICIAL: "Norma oficial",
  FERRAMENTA_CONFRONTO: "Ferramenta de confronto",
  INTERPRETACAO_INTERNA: "Interpretação interna",
  CONTEUDO_LICENCIADO: "Conteúdo licenciado",
};
const SOURCE_KINDS = ["LEI", "DECRETO", "CONVENIO", "PROTOCOLO", "AJUSTE_SINIEF", "PORTARIA", "RESOLUCAO", "ATO_TABELA", "FERRAMENTA_CONFRONTO", "INTERPRETACAO_ESCRITORIO", "BASE_LICENCIADA"];
const RULE_KINDS: Record<"CLASSIFICACAO" | "INCIDENCIA", string[]> = {
  CLASSIFICACAO: ["SEGMENTO_ST", "OUTRO"],
  INCIDENCIA: ["INCIDENCIA_ST", "INCIDENCIA_ANTECIPACAO", "INCIDENCIA_DIFAL", "INCIDENCIA_ST_INTERNA", "OUTRO"],
};
const TEMPLATES = {
  CLASSIFICACAO: { schemaVersion: 1, layer: "CLASSIFICACAO", ncm: { include: ["87083090"] }, cest: { include: ["0100100"] }, segment: "SEGMENTO_EXEMPLO" },
  INCIDENCIA: { schemaVersion: 1, layer: "INCIDENCIA", segmentIn: ["SEGMENTO_EXEMPLO"], ufOrigem: ["SP"], ufDestino: ["MG"], contribuinteIcms: true, finalidade: ["REVENDA"] },
};

export function VersionBadge({ status }: { status: RuleVersionStatus }) {
  return <span className={"badge " + status.toLowerCase()}>{STATUS_LABEL[status]}</span>;
}
function LicenseBadge({ status }: { status: string }) {
  return <span className={"badge " + (status === "LICENCA_NAO_VERIFICADA" ? "lic_warn" : "lic_ok")}>{LICENSE_LABEL[status] ?? status}</span>;
}

/** Organização do catálogo: só as organizações em que o usuário é staff. */
function useStaffOrg(): { orgId: string | null; orgs: { organizationId: string; organizationName: string }[]; setOrg: (id: string) => void } {
  const { me } = useAuth();
  const orgs = (me?.memberships ?? []).filter((m) => m.role === "admin" || m.role === "fiscal");
  const fromQuery = new URLSearchParams(window.location.search).get("org");
  const [orgId, setOrgId] = useState<string | null>(orgs.find((o) => o.organizationId === fromQuery)?.organizationId ?? orgs[0]?.organizationId ?? null);
  return { orgId, orgs, setOrg: (id) => { setOrgId(id); navigate("/catalogo?org=" + id, true); } };
}

function GovernanceNotice() {
  return (
    <Notice tone="warning">
      Catálogo em implantação (Sprint 2A.1). Regras <strong>ativas ainda não são aplicadas a NF-e</strong> e nenhum tributo é calculado. A ativação técnica não substitui a homologação de negócio das regras reais (decisão pendente com Henrique, Iza e Edson).
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Lista: fontes e regras
// ---------------------------------------------------------------------------

export function CatalogPage() {
  const { orgId, orgs, setOrg } = useStaffOrg();
  const [tab, setTab] = useState<"regras" | "fontes">(new URLSearchParams(window.location.search).get("aba") === "fontes" ? "fontes" : "regras");
  if (!orgId) return <Empty title="Sem acesso ao catálogo legal." />;
  return (
    <>
      <div className="eyebrow">Catálogo legal</div>
      <div className="heading">
        <div>
          <h1>Fontes normativas e regras versionadas</h1>
          <p>Cada regra cita dispositivos de normas oficiais, passa por revisão técnica de outra pessoa e só então pode ser ativada. Nada é apagado: versões, decisões e justificativas ficam no histórico.</p>
        </div>
        {orgs.length > 1 && (
          <label>Organização
            <select value={orgId} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.organizationId} value={o.organizationId}>{o.organizationName}</option>)}</select>
          </label>
        )}
      </div>
      <GovernanceNotice />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "regras"} onClick={() => setTab("regras")}>Regras</button>
        <button type="button" role="tab" aria-selected={tab === "fontes"} onClick={() => setTab("fontes")}>Fontes normativas</button>
      </div>
      {tab === "regras" ? <RulesTab orgId={orgId} /> : <SourcesTab orgId={orgId} />}
    </>
  );
}

function SourcesTab({ orgId }: { orgId: string }) {
  const list = useLoad(() => api<{ sources: LegalSource[] }>("/api/organizations/" + orgId + "/legal-sources"), [orgId]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="actions"><button type="button" className="button" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Cadastrar fonte"}</button></div>
      {open && <SourceForm orgId={orgId} onCreated={(id) => navigate("/catalogo/fontes/" + id)} />}
      <ErrorBox error={list.error} />
      {list.loading && <Loading />}
      {list.data && list.data.sources.length === 0 && <Empty title="Nenhuma fonte cadastrada." />}
      {list.data && list.data.sources.length > 0 && (
        <section className="tablecard"><div className="tablewrap"><table className="compact">
          <thead><tr><th>Fonte</th><th>Categoria</th><th>Jurisdição</th><th>Publicação</th><th>Licença</th><th>Dispositivos</th></tr></thead>
          <tbody>{list.data.sources.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => navigate("/catalogo/fontes/" + s.id)}>
              <td><strong>{s.title}</strong><small>{s.kind} {s.number ?? ""} · {s.issuer}</small></td>
              <td>{CATEGORY_LABEL[s.category]}</td><td>{s.jurisdiction}{s.uf ? " / " + s.uf : ""}</td>
              <td>{formatDate(s.publishedAt)}</td><td><LicenseBadge status={s.licenseStatus} /></td><td>{s.provisionCount ?? 0}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}

function SourceForm({ orgId, onCreated }: { orgId: string; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ kind: "DECRETO", jurisdiction: "UF", uf: "MG", issuer: "", number: "", title: "", publishedAt: "", officialUrl: "", licenseStatus: "OFICIAL_PUBLICO", licenseReference: "", notes: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { kind: f.kind, jurisdiction: f.jurisdiction, issuer: f.issuer, title: f.title, publishedAt: f.publishedAt, licenseStatus: f.licenseStatus };
      if (f.jurisdiction === "UF") body.uf = f.uf;
      for (const key of ["number", "officialUrl", "licenseReference", "notes"] as const) if (f[key].trim()) body[key] = f[key].trim();
      const created = await api<{ source: LegalSource }>("/api/organizations/" + orgId + "/legal-sources", { method: "POST", body });
      onCreated(created.source.id);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  return (
    <form className="card form" onSubmit={submit}>
      <h3>Nova fonte</h3>
      <p className="muted">Só normas oficiais fundamentam regras. Ferramentas de confronto, interpretações do escritório e bases licenciadas são registradas como tal. Não copie conteúdo licenciado sem autorização documentada.</p>
      <div className="formgrid">
        <label>Espécie<select value={f.kind} onChange={set("kind")}>{SOURCE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label>Situação de licença<select value={f.licenseStatus} onChange={set("licenseStatus")}>{Object.keys(LICENSE_LABEL).map((k) => <option key={k} value={k}>{LICENSE_LABEL[k]}</option>)}</select></label>
        <label>Jurisdição<select value={f.jurisdiction} onChange={set("jurisdiction")}><option>FEDERAL</option><option>CONFAZ</option><option>UF</option></select></label>
        {f.jurisdiction === "UF" && <label>UF<input value={f.uf} onChange={set("uf")} maxLength={2} required /></label>}
        <label>Órgão emissor<input value={f.issuer} onChange={set("issuer")} required /></label>
        <label>Número<input value={f.number} onChange={set("number")} placeholder="Ex.: 1/2099" /></label>
        <label className="span2">Título<input value={f.title} onChange={set("title")} required /></label>
        <label>Data de publicação<input type="date" value={f.publishedAt} onChange={set("publishedAt")} required /></label>
        <label>Referência oficial (URL)<input value={f.officialUrl} onChange={set("officialUrl")} placeholder="https://…" /></label>
        {f.licenseStatus === "LICENCIADO_CONFIRMADO" && <label className="span2">Instrumento autorizador (contrato/termo)<input value={f.licenseReference} onChange={set("licenseReference")} required /></label>}
        <label className="span2">Observações<textarea rows={2} value={f.notes} onChange={set("notes")} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="actions"><button type="submit" className="button" disabled={busy}>Cadastrar</button></div>
    </form>
  );
}

function RulesTab({ orgId }: { orgId: string }) {
  type Row = TaxRule & { latestVersion: RuleVersionSummary | null; activeVersion: RuleVersionSummary | null; versionCount: number };
  const list = useLoad(() => api<{ rules: Row[] }>("/api/organizations/" + orgId + "/tax-rules"), [orgId]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="actions"><button type="button" className="button" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Criar regra"}</button></div>
      {open && <VersionForm orgId={orgId} onCreated={(versionId) => navigate("/catalogo/versoes/" + versionId)} />}
      <ErrorBox error={list.error} />
      {list.loading && <Loading />}
      {list.data && list.data.rules.length === 0 && <Empty title="Nenhuma regra cadastrada." />}
      {list.data && list.data.rules.length > 0 && (
        <section className="tablecard"><div className="tablewrap"><table className="compact">
          <thead><tr><th>Regra</th><th>Camada</th><th>Última versão</th><th>Versão ativa</th><th>Versões</th></tr></thead>
          <tbody>{list.data.rules.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => navigate("/catalogo/regras/" + r.id)}>
              <td><strong>{r.code}</strong><small>{r.title}</small></td>
              <td>{r.layer}<small>{r.kind}</small></td>
              <td>{r.latestVersion ? <>v{r.latestVersion.version} <VersionBadge status={r.latestVersion.status} /></> : "—"}</td>
              <td>{r.activeVersion ? "v" + r.activeVersion.version + " desde " + formatDate(r.activeVersion.effectsFrom) : "—"}</td>
              <td>{r.versionCount}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}

/** Cria regra (com versão 1) ou nova versão de uma regra existente. */
function VersionForm({ orgId, rule, base, onCreated }: { orgId: string; rule?: TaxRule; base?: { conditions: Record<string, unknown>; provisions: { provisionId: string; role: ProvisionRole }[] }; onCreated: (versionId: string) => void }) {
  const [layer, setLayer] = useState<"CLASSIFICACAO" | "INCIDENCIA">(rule?.layer ?? "CLASSIFICACAO");
  const [f, setF] = useState({ code: "", title: "", kind: RULE_KINDS[rule?.layer ?? "CLASSIFICACAO"][0]!, effectsFrom: "", effectsTo: "", changeReason: "", conditions: JSON.stringify(base?.conditions ?? TEMPLATES[rule?.layer ?? "CLASSIFICACAO"], null, 2) });
  const [links, setLinks] = useState<{ provisionId: string; role: ProvisionRole }[]>(base?.provisions ?? []);
  const provisions = useLoad(() => api<{ provisions: LegalProvision[] }>("/api/organizations/" + orgId + "/legal-provisions"), [orgId]);
  const [pick, setPick] = useState({ provisionId: "", role: "FUNDAMENTO" as ProvisionRole });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let conditions: unknown;
    try {
      conditions = JSON.parse(f.conditions);
    } catch {
      setError(new Error("As condições não são um JSON válido."));
      return;
    }
    const version: Record<string, unknown> = { conditions, effectsFrom: f.effectsFrom, changeReason: f.changeReason, provisions: links };
    if (f.effectsTo) version.effectsTo = f.effectsTo;
    setBusy(true);
    try {
      if (rule) {
        const created = await api<{ version: RuleVersion }>("/api/tax-rules/" + rule.id + "/versions", { method: "POST", body: version });
        onCreated(created.version.id);
      } else {
        const created = await api<{ version: RuleVersion }>("/api/organizations/" + orgId + "/tax-rules", { method: "POST", body: { code: f.code, title: f.title, layer, kind: f.kind, version } });
        onCreated(created.version.id);
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  const all = provisions.data?.provisions ?? [];
  return (
    <form className="card form" onSubmit={submit}>
      <h3>{rule ? "Nova versão de " + rule.code : "Nova regra"}</h3>
      <p className="muted">A versão nasce como rascunho e não pode ser editada depois: alterações materiais geram nova versão. Condições seguem o schema v1 (validado pela API); classificação precisa de NCM e mais um critério (CEST ou sinais de descrição aceitos expressamente). Sem alíquotas, MVA ou fórmulas.</p>
      <div className="formgrid">
        {!rule && <>
          <label>Código<input value={f.code} onChange={set("code")} required placeholder="CLS-EXEMPLO" /></label>
          <label>Título<input value={f.title} onChange={set("title")} required /></label>
          <label>Camada<select value={layer} onChange={(e) => { const next = e.target.value as typeof layer; setLayer(next); setF({ ...f, kind: RULE_KINDS[next][0]!, conditions: JSON.stringify(TEMPLATES[next], null, 2) }); }}><option>CLASSIFICACAO</option><option>INCIDENCIA</option></select></label>
          <label>Tipo<select value={f.kind} onChange={set("kind")}>{RULE_KINDS[layer].map((k) => <option key={k}>{k}</option>)}</select></label>
        </>}
        <label>Início dos efeitos<input type="date" value={f.effectsFrom} onChange={set("effectsFrom")} required /></label>
        <label>Fim dos efeitos (opcional)<input type="date" value={f.effectsTo} onChange={set("effectsTo")} /></label>
        <label className="span2">Condições (JSON, schemaVersion 1)<textarea className="code" rows={12} value={f.conditions} onChange={set("conditions")} spellCheck={false} /></label>
        <label className="span2">Motivo da versão<textarea rows={2} value={f.changeReason} onChange={set("changeReason")} required /></label>
      </div>
      <div className="section-label">Dispositivos citados</div>
      {links.length === 0 && <p className="muted">Nenhum dispositivo. Para submeter, cite ao menos um dispositivo de norma oficial como FUNDAMENTO.</p>}
      {links.length > 0 && <ul className="issues">{links.map((l) => {
        const p = all.find((x) => x.id === l.provisionId);
        return <li key={l.provisionId}><strong>{l.role}</strong> — {p ? p.source?.title + ", " + p.reference : l.provisionId} <button type="button" className="linkbutton danger" onClick={() => setLinks(links.filter((x) => x.provisionId !== l.provisionId))}>remover</button></li>;
      })}</ul>}
      <div className="actions">
        <select value={pick.provisionId} onChange={(e) => setPick({ ...pick, provisionId: e.target.value })}>
          <option value="">Selecione um dispositivo…</option>
          {all.filter((p) => !links.some((l) => l.provisionId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.source?.title} — {p.reference} ({CATEGORY_LABEL[p.source?.category ?? ""] ?? ""})</option>)}
        </select>
        <select value={pick.role} onChange={(e) => setPick({ ...pick, role: e.target.value as ProvisionRole })}>{["FUNDAMENTO", "EXCECAO", "CONFRONTO", "INTERPRETACAO"].map((r) => <option key={r}>{r}</option>)}</select>
        <button type="button" className="button secondary" disabled={!pick.provisionId} onClick={() => { setLinks([...links, pick]); setPick({ provisionId: "", role: "FUNDAMENTO" }); }}>Adicionar</button>
      </div>
      <ErrorBox error={error} />
      <div className="actions"><button type="submit" className="button" disabled={busy}>Gravar rascunho</button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Fonte: snapshots e dispositivos
// ---------------------------------------------------------------------------

interface SourceDetail { source: LegalSource; role: "admin" | "fiscal"; snapshots: LegalSnapshot[]; provisions: LegalProvision[]; people: Record<string, string> }

export function SourceDetailPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api<SourceDetail>("/api/legal-sources/" + id), [id]);
  const [mode, setMode] = useState<"none" | "snapshot" | "provision" | "license">("none");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Fonte não encontrada.")} />;
  const { source, snapshots, provisions, people, role } = data;
  const done = () => { setMode("none"); reload(); };
  return (
    <>
      <div className="eyebrow"><Link to={"/catalogo?org=" + source.organizationId + "&aba=fontes"}>Catálogo legal</Link> / Fonte</div>
      <div className="heading">
        <div>
          <h1>{source.title}</h1>
          <p>{source.kind} {source.number ?? ""} · {source.issuer} · {source.jurisdiction}{source.uf ? "/" + source.uf : ""} · publicada em {formatDate(source.publishedAt)}</p>
        </div>
        <div className="statusgroup"><span className="badge rascunho">{CATEGORY_LABEL[source.category]}</span><LicenseBadge status={source.licenseStatus} /></div>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Referência oficial</dt><dd>{source.officialUrl ? <a href={source.officialUrl} rel="noreferrer noopener" target="_blank">{source.officialUrl}</a> : "—"}</dd>
          <dt>Normativa</dt><dd>{source.normative ? "Sim — pode fundamentar regras" : "Não — só confronto ou complemento"}</dd>
          <dt>Instrumento de licença</dt><dd>{source.licenseReference ?? "—"}</dd>
          <dt>Cadastrada por</dt><dd>{people[source.createdBy] ?? source.createdBy} em {formatDateTime(source.createdAt)}</dd>
        </dl>
      </div>
      {source.licenseStatus === "LICENCA_NAO_VERIFICADA" && <Notice tone="warning">Licença não verificada: não envie o conteúdo; registre só hash e referência. Regras que citam esta fonte não podem ser submetidas, aprovadas ou ativadas.</Notice>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button type="button" className="button" onClick={() => setMode("snapshot")}>Registrar snapshot</button>
        <button type="button" className="button" disabled={!snapshots.length} onClick={() => setMode("provision")}>Cadastrar dispositivo</button>
        {role === "admin" && source.licenseStatus !== "INTERNO" && <button type="button" className="button secondary" onClick={() => setMode("license")}>Alterar licença</button>}
      </div>
      {mode === "snapshot" && <SnapshotForm source={source} onDone={done} />}
      {mode === "provision" && <ProvisionForm source={source} snapshots={snapshots} onDone={done} />}
      {mode === "license" && <LicenseForm source={source} onDone={done} />}

      <section className="tablecard">
        <div className="tablehead"><h3>Dispositivos</h3><p>Vigência própria; encerramento não apaga o registro.</p></div>
        <div className="tablewrap"><table className="compact">
          <thead><tr><th>Dispositivo</th><th>Publicação</th><th>Efeitos</th><th>Snapshot</th><th>Usado por</th><th></th></tr></thead>
          <tbody>{provisions.map((p) => <ProvisionRow key={p.id} provision={p} snapshot={snapshots.find((s) => s.id === p.snapshotId)} onChange={reload} />)}</tbody>
        </table></div>
      </section>
      <section className="tablecard">
        <div className="tablehead"><h3>Snapshots de proveniência</h3><p>O que foi consultado, quando, por quem e com qual SHA-256.</p></div>
        <div className="tablewrap"><table className="compact">
          <thead><tr><th>Consulta</th><th>Método</th><th>SHA-256</th><th>Por</th><th>Referência de guarda</th></tr></thead>
          <tbody>{snapshots.map((s) => <tr key={s.id}><td>{formatDateTime(s.retrievedAt)}<small>{s.url ?? ""}</small></td><td>{s.method}</td><td><code>{s.contentSha256.slice(0, 16)}…</code></td><td>{people[s.retrievedBy] ?? s.retrievedBy}</td><td>{s.storageRef ?? "—"}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}

function ProvisionRow({ provision: p, snapshot, onChange }: { provision: LegalProvision; snapshot?: LegalSnapshot; onChange: () => void }) {
  const [closing, setClosing] = useState(false);
  const [form, setForm] = useState({ effectsTo: "", reason: "" });
  const [error, setError] = useState<unknown>(null);
  async function close(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/legal-provisions/" + p.id + "/close-effects", { method: "POST", body: form });
      setClosing(false);
      onChange();
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <>
      <tr>
        <td><strong>{p.reference}</strong><small>{p.heading ?? ""}</small></td>
        <td>{formatDate(p.publishedAt)}</td>
        <td>{formatDate(p.effectsFrom)} → {p.effectsTo ? formatDate(p.effectsTo) : "em aberto"}{p.effectsClosedReason && <small>Encerrado: {p.effectsClosedReason}</small>}</td>
        <td>{snapshot ? <code>{snapshot.contentSha256.slice(0, 10)}…</code> : "—"}</td>
        <td>{(p.usedBy ?? []).map((u) => <small key={u.versionId}><Link to={"/catalogo/versoes/" + u.versionId}>{u.ruleCode} v{u.version}</Link> ({u.role}, {STATUS_LABEL[u.status]})</small>)}</td>
        <td>{!p.effectsClosedAt && <button type="button" className="linkbutton" onClick={() => setClosing(!closing)}>Encerrar efeitos</button>}</td>
      </tr>
      {closing && (
        <tr><td colSpan={6}>
          <form className="actions" onSubmit={close}>
            <label>Fim dos efeitos<input type="date" value={form.effectsTo} onChange={(e) => setForm({ ...form, effectsTo: e.target.value })} required /></label>
            <label>Motivo<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></label>
            <button type="submit" className="button">Confirmar</button>
          </form>
          <ErrorBox error={error} />
        </td></tr>
      )}
    </>
  );
}

function useSubmit(onDone: () => void) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<unknown>) => async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

function SnapshotForm({ source, onDone }: { source: LegalSource; onDone: () => void }) {
  const restricted = source.licenseStatus === "LICENCA_NAO_VERIFICADA";
  const [f, setF] = useState({ retrievedAt: new Date().toISOString().slice(0, 16), url: source.officialUrl ?? "", method: "MANUAL", content: "", contentSha256: "", storageRef: "", notes: "" });
  const { error, busy, run } = useSubmit(onDone);
  const submit = run(() => {
    const body: Record<string, unknown> = { retrievedAt: new Date(f.retrievedAt).toISOString(), method: f.method };
    for (const key of ["url", "content", "contentSha256", "storageRef", "notes"] as const) if (f[key].trim()) body[key] = key === "content" ? f[key] : f[key].trim();
    return api("/api/legal-sources/" + source.id + "/snapshots", { method: "POST", body });
  });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  return (
    <form className="card form" onSubmit={submit}>
      <h3>Snapshot de proveniência</h3>
      <p className="muted">{restricted ? "Fonte com licença não verificada: informe apenas o SHA-256 da cópia guardada fora do sistema." : "Cole o conteúdo consultado para o servidor calcular o SHA-256 (o texto não é armazenado), ou informe o hash."}</p>
      <div className="formgrid">
        <label>Consultado em<input type="datetime-local" value={f.retrievedAt} onChange={set("retrievedAt")} required /></label>
        <label>Método<select value={f.method} onChange={set("method")}><option>MANUAL</option>{!restricted && <option>IMPORTACAO_ASSISTIDA</option>}</select></label>
        <label className="span2">URL consultada<input value={f.url} onChange={set("url")} /></label>
        {!restricted && <label className="span2">Conteúdo consultado (opcional, só para o hash)<textarea rows={4} value={f.content} onChange={set("content")} /></label>}
        <label className="span2">SHA-256 (opcional se colar o conteúdo)<input value={f.contentSha256} onChange={set("contentSha256")} /></label>
        <label>Referência de guarda (área restrita)<input value={f.storageRef} onChange={set("storageRef")} /></label>
        <label>Observações<input value={f.notes} onChange={set("notes")} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="actions"><button type="submit" className="button" disabled={busy}>Registrar</button></div>
    </form>
  );
}

function ProvisionForm({ source, snapshots, onDone }: { source: LegalSource; snapshots: LegalSnapshot[]; onDone: () => void }) {
  const [f, setF] = useState({ snapshotId: snapshots[0]?.id ?? "", reference: "", heading: "", officialText: "", publishedAt: source.publishedAt, effectsFrom: "", effectsTo: "" });
  const { error, busy, run } = useSubmit(onDone);
  const submit = run(() => {
    const body: Record<string, unknown> = { snapshotId: f.snapshotId, reference: f.reference, publishedAt: f.publishedAt, effectsFrom: f.effectsFrom };
    for (const key of ["heading", "officialText", "effectsTo"] as const) if (f[key].trim()) body[key] = f[key];
    return api("/api/legal-sources/" + source.id + "/provisions", { method: "POST", body });
  });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  return (
    <form className="card form" onSubmit={submit}>
      <h3>Dispositivo legal</h3>
      <p className="muted">A data de publicação e o início dos efeitos são campos distintos. Não invente datas: use as da publicação oficial.</p>
      <div className="formgrid">
        <label className="span2">Snapshot de origem<select value={f.snapshotId} onChange={set("snapshotId")}>{snapshots.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.retrievedAt)} — {s.contentSha256.slice(0, 12)}…</option>)}</select></label>
        <label>Referência (art./§/anexo/item)<input value={f.reference} onChange={set("reference")} required /></label>
        <label>Ementa / título<input value={f.heading} onChange={set("heading")} /></label>
        <label>Publicação<input type="date" value={f.publishedAt} onChange={set("publishedAt")} required /></label>
        <label>Início dos efeitos<input type="date" value={f.effectsFrom} onChange={set("effectsFrom")} required /></label>
        <label>Fim dos efeitos (opcional)<input type="date" value={f.effectsTo} onChange={set("effectsTo")} /></label>
        {source.licenseStatus === "OFICIAL_PUBLICO" && <label className="span2">Texto oficial (opcional)<textarea rows={3} value={f.officialText} onChange={set("officialText")} /></label>}
      </div>
      <ErrorBox error={error} />
      <div className="actions"><button type="submit" className="button" disabled={busy}>Cadastrar</button></div>
    </form>
  );
}

function LicenseForm({ source, onDone }: { source: LegalSource; onDone: () => void }) {
  const [f, setF] = useState({ licenseStatus: source.licenseStatus === "INTERNO" ? "OFICIAL_PUBLICO" : source.licenseStatus, licenseReference: source.licenseReference ?? "", justification: "" });
  const { error, busy, run } = useSubmit(onDone);
  const submit = run(() => api("/api/legal-sources/" + source.id + "/license", { method: "PATCH", body: { licenseStatus: f.licenseStatus, justification: f.justification, ...(f.licenseReference.trim() ? { licenseReference: f.licenseReference.trim() } : {}) } }));
  return (
    <form className="card form" onSubmit={submit}>
      <h3>Situação de licença</h3>
      <div className="formgrid">
        <label>Situação<select value={f.licenseStatus} onChange={(e) => setF({ ...f, licenseStatus: e.target.value as typeof f.licenseStatus })}>{["OFICIAL_PUBLICO", "LICENCIADO_CONFIRMADO", "LICENCA_NAO_VERIFICADA"].map((k) => <option key={k} value={k}>{LICENSE_LABEL[k]}</option>)}</select></label>
        <label>Instrumento autorizador<input value={f.licenseReference} onChange={(e) => setF({ ...f, licenseReference: e.target.value })} /></label>
        <label className="span2">Justificativa<textarea rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} required /></label>
      </div>
      <ErrorBox error={error} />
      <div className="actions"><button type="submit" className="button" disabled={busy}>Confirmar</button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Regra: versões e histórico
// ---------------------------------------------------------------------------

interface RuleDetail {
  rule: TaxRule;
  versions: RuleVersionSummary[];
  trail: WorkflowEntry[];
  audit: { id: string; at: string; action: string; entityType: string; entityId: string | null; actorUserId: string | null }[];
  people: Record<string, string>;
}

function Trail({ entries, people, showVersion }: { entries: WorkflowEntry[]; people: Record<string, string>; showVersion?: boolean }): ReactNode {
  if (!entries.length) return <p className="muted">Nenhuma decisão registrada.</p>;
  return (
    <div className="tablewrap"><table className="compact">
      <thead><tr><th>Decisão</th>{showVersion && <th>Versão</th>}<th>De → para</th><th>Quem</th><th>Quando</th><th>Justificativa / autorização</th></tr></thead>
      <tbody>{entries.map((t) => (
        <tr key={t.id}>
          <td><strong>{ACTION_LABEL[t.action] ?? t.action}</strong></td>
          {showVersion && <td>v{t.version}</td>}
          <td>{STATUS_LABEL[t.fromStatus]} → {STATUS_LABEL[t.toStatus]}</td>
          <td>{people[t.decidedBy] ?? t.decidedBy}</td>
          <td>{formatDateTime(t.decidedAt)}</td>
          <td style={{ whiteSpace: "normal" }}>{t.justification ?? "—"}{t.authorizationReference && <small>Autorização: {t.authorizationReference}</small>}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function RuleDetailPage({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => api<RuleDetail>("/api/tax-rules/" + id), [id]);
  const [creating, setCreating] = useState(false);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Regra não encontrada.")} />;
  const { rule, versions, trail, audit, people } = data;
  return (
    <>
      <div className="eyebrow"><Link to={"/catalogo?org=" + rule.organizationId}>Catálogo legal</Link> / Regra</div>
      <div className="heading"><div><h1>{rule.code}</h1><p>{rule.title} · {rule.layer} · {rule.kind}</p></div></div>
      <GovernanceNotice />
      <div className="actions"><button type="button" className="button" onClick={() => setCreating(!creating)}>{creating ? "Fechar" : "Nova versão"}</button></div>
      {creating && <VersionForm orgId={rule.organizationId} rule={rule} onCreated={(versionId) => navigate("/catalogo/versoes/" + versionId)} />}
      <section className="tablecard">
        <div className="tablehead"><h3>Versões</h3><p>Append-only: o conteúdo de cada versão é imutável (SHA-256).</p></div>
        <div className="tablewrap"><table className="compact">
          <thead><tr><th>Versão</th><th>Situação</th><th>Efeitos</th><th>Autor</th><th>Motivo</th><th>Hash</th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id} className="clickable" onClick={() => navigate("/catalogo/versoes/" + v.id)}>
              <td><strong>v{v.version}</strong></td><td><VersionBadge status={v.status} /></td>
              <td>{formatDate(v.effectsFrom)} → {v.effectsEndedOn ? formatDate(v.effectsEndedOn) + " (encerrada)" : v.effectsTo ? formatDate(v.effectsTo) : "em aberto"}</td>
              <td>{people[v.authorId] ?? v.authorId}</td><td style={{ whiteSpace: "normal" }}>{v.changeReason}</td><td><code>{v.contentSha256.slice(0, 10)}…</code></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="tablecard"><div className="tablehead"><h3>Trilha de aprovações</h3></div><Trail entries={trail} people={people} showVersion /></section>
      <section className="tablecard">
        <div className="tablehead"><h3>Auditoria</h3></div>
        <div className="tablewrap"><table className="compact">
          <thead><tr><th>Evento</th><th>Quem</th><th>Quando</th></tr></thead>
          <tbody>{audit.map((e) => <tr key={e.id}><td>{e.action}</td><td>{e.actorUserId ? people[e.actorUserId] ?? e.actorUserId : "sistema"}</td><td>{formatDateTime(e.at)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Versão: condições, fundamento, prontidão e workflow
// ---------------------------------------------------------------------------

interface VersionDetail {
  rule: TaxRule;
  version: RuleVersion;
  provisions: { role: ProvisionRole; provision: LegalProvision; source: LegalSource }[];
  trail: WorkflowEntry[];
  readiness: { code: string; message: string }[];
  availableOperations: RuleOperation[];
  versions: RuleVersionSummary[];
  people: Record<string, string>;
  notice: string;
}

export function VersionDetailPage({ id }: { id: string }) {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<VersionDetail>("/api/tax-rule-versions/" + id), [id]);
  const [operation, setOperation] = useState<RuleOperation | null>(null);
  const [form, setForm] = useState({ justification: "", authorizationReference: "", effectsEndedOn: "" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Versão não encontrada.")} />;
  const { rule, version, provisions, trail, readiness, availableOperations, people } = data;
  const isAuthor = me?.user.id === version.authorId;

  async function execute(event: FormEvent) {
    event.preventDefault();
    if (!operation) return;
    const spec = OPERATIONS[operation];
    const body: Record<string, unknown> = { expectedStatus: version.status };
    if (spec.needsJustification || form.justification.trim()) body.justification = form.justification;
    if (spec.needsAuthorization) body.authorizationReference = form.authorizationReference;
    if (spec.needsEndDate) body.effectsEndedOn = form.effectsEndedOn;
    setBusy(true);
    setActionError(null);
    try {
      await api("/api/tax-rule-versions/" + version.id + "/" + spec.path, { method: "POST", body });
      setOperation(null);
      setForm({ justification: "", authorizationReference: "", effectsEndedOn: "" });
      reload();
    } catch (failure) {
      setActionError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="eyebrow"><Link to={"/catalogo?org=" + rule.organizationId}>Catálogo legal</Link> / <Link to={"/catalogo/regras/" + rule.id}>{rule.code}</Link> / v{version.version}</div>
      <div className="heading">
        <div>
          <h1>{rule.code} · versão {version.version}</h1>
          <p>{rule.title} · {rule.layer} · autor {people[version.authorId] ?? version.authorId}{isAuthor ? " (você)" : ""} · criada em {formatDateTime(version.createdAt)}</p>
        </div>
        <div className="statusgroup"><VersionBadge status={version.status} /></div>
      </div>
      <Notice tone="warning">{data.notice}</Notice>

      <div className="twocol">
        <div className="card">
          <div className="section-label">Vigência e integridade</div>
          <dl className="kv">
            <dt>Início dos efeitos</dt><dd>{formatDate(version.effectsFrom)}</dd>
            <dt>Fim previsto</dt><dd>{version.effectsTo ? formatDate(version.effectsTo) : "em aberto"}</dd>
            <dt>Encerrada em</dt><dd>{version.effectsEndedOn ? formatDate(version.effectsEndedOn) : "—"}</dd>
            <dt>Motivo</dt><dd>{version.changeReason}</dd>
            <dt>Schema</dt><dd>v{version.conditionsSchemaVersion}</dd>
            <dt>SHA-256</dt><dd><code>{version.contentSha256}</code></dd>
            {version.supersededByVersionId && <><dt>Substituída por</dt><dd><Link to={"/catalogo/versoes/" + version.supersededByVersionId}>ver versão</Link></dd></>}
          </dl>
        </div>
        <div className="card">
          <div className="section-label">Condições de aplicação</div>
          <pre className="code">{JSON.stringify(version.conditions, null, 2)}</pre>
        </div>
      </div>

      <section className="tablecard">
        <div className="tablehead"><h3>Fundamento legal</h3><p>Só dispositivos de normas oficiais fundamentam; confronto e interpretação complementam.</p></div>
        <div className="tablewrap"><table className="compact">
          <thead><tr><th>Papel</th><th>Fonte</th><th>Dispositivo</th><th>Efeitos</th><th>Licença</th></tr></thead>
          <tbody>{provisions.map((l) => (
            <tr key={l.provision.id} className="clickable" onClick={() => navigate("/catalogo/fontes/" + l.source.id)}>
              <td><strong>{l.role}</strong></td><td>{l.source.title}<small>{CATEGORY_LABEL[l.source.category]}</small></td>
              <td>{l.provision.reference}</td><td>{formatDate(l.provision.effectsFrom)} → {l.provision.effectsTo ? formatDate(l.provision.effectsTo) : "em aberto"}</td>
              <td><LicenseBadge status={l.source.licenseStatus} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {readiness.length > 0 && (
        <div className="alerts"><h3>Pendências para submeter, aprovar ou ativar</h3><ul>{readiness.map((r, index) => <li key={index}>{r.message}</li>)}</ul></div>
      )}

      <section className="card" style={{ marginTop: 22 }}>
        <div className="section-label">Workflow</div>
        <p className="muted">RASCUNHO → EM REVISÃO TÉCNICA → APROVADA → ATIVA. Quem escreveu a versão não aprova, não devolve nem ativa. Ativação e suspensão são restritas a administradores e exigem justificativa.</p>
        {availableOperations.length === 0 && <p className="muted">{isAuthor && version.status === "EM_REVISAO_TECNICA" ? "Aguardando revisão por outra pessoa." : "Nenhuma operação disponível para você nesta situação."}</p>}
        <div className="actions">
          {availableOperations.map((o) => <button key={o} type="button" className={OPERATIONS[o].tone} onClick={() => { setOperation(o); setActionError(null); }}>{OPERATIONS[o].label}</button>)}
          {(version.status === "ATIVA" || version.status === "APROVADA" || version.status === "RASCUNHO" || version.status === "SUSPENSA") && <button type="button" className="button secondary" onClick={() => setCreating(!creating)}>Nova versão a partir desta</button>}
        </div>
        {operation && (
          <form className="form" onSubmit={execute}>
            <h3>{OPERATIONS[operation].label}</h3>
            {(OPERATIONS[operation].needsJustification || operation === "SUBMETE") && <label>Justificativa{OPERATIONS[operation].needsJustification ? "" : " (opcional)"}<textarea rows={3} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} required={OPERATIONS[operation].needsJustification} /></label>}
            {OPERATIONS[operation].needsAuthorization && <label>Referência da autorização de negócio (ata, decisão formal)<input value={form.authorizationReference} onChange={(e) => setForm({ ...form, authorizationReference: e.target.value })} required /></label>}
            {OPERATIONS[operation].needsEndDate && <label>Fim da vigência<input type="date" value={form.effectsEndedOn} onChange={(e) => setForm({ ...form, effectsEndedOn: e.target.value })} required /></label>}
            <div className="actions"><button type="submit" className="button" disabled={busy}>Confirmar</button><button type="button" className="button secondary" onClick={() => setOperation(null)}>Cancelar</button></div>
          </form>
        )}
        <ErrorBox error={actionError} />
      </section>
      {creating && <VersionForm orgId={rule.organizationId} rule={rule} base={{ conditions: version.conditions, provisions: provisions.map((p) => ({ provisionId: p.provision.id, role: p.role })) }} onCreated={(versionId) => { setCreating(false); navigate("/catalogo/versoes/" + versionId); }} />}

      <section className="tablecard"><div className="tablehead"><h3>Histórico de decisões desta versão</h3></div><Trail entries={trail} people={people} /></section>
      <section className="tablecard">
        <div className="tablehead"><h3>Outras versões da regra</h3></div>
        <div className="tablewrap"><table className="compact"><tbody>{data.versions.map((v) => (
          <tr key={v.id} className="clickable" onClick={() => navigate("/catalogo/versoes/" + v.id)}><td><strong>v{v.version}</strong>{v.id === version.id ? " (esta)" : ""}</td><td><VersionBadge status={v.status} /></td><td>{formatDate(v.effectsFrom)}</td><td style={{ whiteSpace: "normal" }}>{v.changeReason}</td></tr>
        ))}</tbody></table></div>
      </section>
    </>
  );
}
