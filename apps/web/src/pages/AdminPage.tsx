import { useState, type FormEvent } from "react";
import { api, formatCnpj, formatDateTime, type Company, type OrgUser, type Role } from "../api";
import { useAuth } from "../auth";
import { ApiErrorAlert, LoadError, useLoad } from "../components";
import { Alert, AppLink, Button, EmptyState, Field, Input, Loading, Page, PageHeader, Panel, PanelGrid, Select, Status, Table } from "../ds";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const ROLE_LABEL: Record<Role, string> = { cliente: "Cliente", fiscal: "Fiscal", admin: "Administrador" };

export function AdminPage() {
  const { me } = useAuth();
  const adminOrgs = (me?.memberships ?? []).filter((m) => m.role === "admin");
  const [orgId, setOrgId] = useState(adminOrgs[0]?.organizationId ?? "");
  if (!orgId) {
    return (
      <Page>
        <EmptyState icon="shield" title="Sem organização para administrar">
          <p>Você não administra nenhuma organização.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Administração"
        title="Organização"
        subtitle="Cadastro de empresas clientes e de usuários. O cadastro fiscal de cada empresa é feito na página da empresa."
        actions={
          adminOrgs.length > 1 ? (
            <label className="px-select-inline">
              <span>Organização</span>
              <select className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {adminOrgs.map((m) => <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>)}
              </select>
            </label>
          ) : undefined
        }
      />
      <PanelGrid>
        <CompaniesAdmin orgId={orgId} />
        <UsersAdmin orgId={orgId} />
      </PanelGrid>
    </Page>
  );
}

function CompaniesAdmin({ orgId }: { orgId: string }) {
  const list = useLoad(() => api<{ companies: Company[] }>("/api/companies"), [orgId]);
  const [form, setForm] = useState({ cnpj: "", legalName: "", tradeName: "", uf: "MG" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/organizations/" + orgId + "/companies", { method: "POST", body: { cnpj: form.cnpj, legalName: form.legalName, tradeName: form.tradeName || undefined, uf: form.uf } });
      setForm({ cnpj: "", legalName: "", tradeName: "", uf: form.uf });
      list.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const companies = (list.data?.companies ?? []).filter((c) => c.organizationId === orgId);
  return (
    <>
      <Panel title="Empresas" description={<><span className="num">{companies.length}</span> cadastrada(s)</>} span="main" flush>
        {list.loading ? (
          <div className="px-form"><Loading label="Carregando empresas…" /></div>
        ) : list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : companies.length === 0 ? (
          <EmptyState icon="building" title="Nenhuma empresa cadastrada" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">CNPJ</th>
                <th scope="col">UF</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td className="px-cell-title">
                    <AppLink href={"/empresas/" + c.id} className="px-row-link">{c.legalName}</AppLink>
                    {c.tradeName && <span className="px-cell-sub">{c.tradeName}</span>}
                  </td>
                  <td data-label="CNPJ" className="num">{formatCnpj(c.cnpj)}</td>
                  <td data-label="UF">{c.uf}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      <Panel title="Nova empresa" span="side" flush>
        <form className="px-form" onSubmit={onSubmit}>
          <Field label="CNPJ">{(p) => <Input {...p} value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} required placeholder="00.000.000/0000-00" inputMode="numeric" />}</Field>
          <Field label="UF">
            {(p) => (
              <Select {...p} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}>
                {UFS.map((uf) => <option key={uf}>{uf}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Razão social">{(p) => <Input {...p} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />}</Field>
          <Field label="Nome fantasia">{(p) => <Input {...p} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />}</Field>
          <ApiErrorAlert error={error} />
          <div className="px-form-actions">
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Cadastrar empresa"}</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}

function UsersAdmin({ orgId }: { orgId: string }) {
  const list = useLoad(() => api<{ users: OrgUser[] }>("/api/organizations/" + orgId + "/users"), [orgId]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "cliente" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/organizations/" + orgId + "/users", { method: "POST", body: form });
      setForm({ name: "", email: "", password: "", role: "cliente" });
      list.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Usuários" description={<><span className="num">{list.data?.users.length ?? 0}</span> na organização</>} span="main" flush>
        {list.loading ? (
          <div className="px-form"><Loading label="Carregando usuários…" /></div>
        ) : list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : (
          list.data && (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Papel</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Último acesso</th>
                </tr>
              </thead>
              <tbody>
                {list.data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-cell-title"><strong>{u.name}</strong><span className="px-cell-sub">{u.email}</span></td>
                    <td data-label="Papel">{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td data-label="Situação">{u.active ? <Status tone="success">Ativo</Status> : <Status tone="neutral" outline>Inativo</Status>}</td>
                    <td data-label="Último acesso" className="num">{formatDateTime(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        )}
      </Panel>
      <Panel title="Novo usuário" span="side" flush>
        <form className="px-form" onSubmit={onSubmit} autoComplete="off">
          <Field label="Nome">{(p) => <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />}</Field>
          <Field label="E-mail">{(p) => <Input {...p} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="off" />}</Field>
          <Field label="Senha inicial" hint="Mínimo de 12 caracteres">{(p) => <Input {...p} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} autoComplete="new-password" />}</Field>
          <Field label="Papel">
            {(p) => (
              <Select {...p} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="cliente">Cliente</option>
                <option value="fiscal">Fiscal</option>
                <option value="admin">Administrador</option>
              </Select>
            )}
          </Field>
          <Alert tone="info">Entregue a senha por canal seguro e peça a troca no primeiro acesso. Clientes precisam de liberação por empresa (aba Acessos).</Alert>
          <ApiErrorAlert error={error} />
          <div className="px-form-actions">
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Criar usuário"}</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
