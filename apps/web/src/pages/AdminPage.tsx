import { useState, type FormEvent } from "react";
import { api, formatCnpj, formatDateTime, type Company, type OrgUser } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, Notice, useLoad } from "../components";
import { Link } from "../router";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

export function AdminPage() {
  const { me } = useAuth();
  const adminOrgs = (me?.memberships ?? []).filter((m) => m.role === "admin");
  const [orgId, setOrgId] = useState(adminOrgs[0]?.organizationId ?? "");
  if (!orgId) return <ErrorBox error={new Error("Você não administra nenhuma organização.")} />;

  return (
    <>
      <div className="eyebrow">Administração</div>
      <div className="heading">
        <div>
          <h1>Organização</h1>
          <p>Cadastro de empresas clientes e de usuários. O cadastro fiscal de cada empresa é feito na página da empresa.</p>
        </div>
        {adminOrgs.length > 1 && (
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {adminOrgs.map((m) => <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>)}
          </select>
        )}
      </div>
      <div className="twocol">
        <CompaniesAdmin orgId={orgId} />
        <UsersAdmin orgId={orgId} />
      </div>
    </>
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
    <section>
      <form className="card form" onSubmit={onSubmit}>
        <h3>Nova empresa</h3>
        <div className="formgrid">
          <label>CNPJ<input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} required placeholder="00.000.000/0000-00" /></label>
          <label>UF
            <select value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}>{UFS.map((uf) => <option key={uf}>{uf}</option>)}</select>
          </label>
          <label className="span2">Razão social<input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required /></label>
          <label className="span2">Nome fantasia<input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} /></label>
        </div>
        <ErrorBox error={error} />
        <button type="submit" className="button" disabled={busy}>{busy ? "Salvando…" : "Cadastrar empresa"}</button>
      </form>
      <ErrorBox error={list.error} />
      {list.loading && <Loading />}
      {!list.loading && companies.length === 0 && <Empty title="Nenhuma empresa cadastrada." />}
      {companies.length > 0 && (
        <section className="tablecard">
          <div className="tablehead"><h3>Empresas ({companies.length})</h3></div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Empresa</th><th>CNPJ</th><th>UF</th></tr></thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={"/empresas/" + c.id}><strong>{c.legalName}</strong></Link>{c.tradeName && <small>{c.tradeName}</small>}</td>
                    <td>{formatCnpj(c.cnpj)}</td>
                    <td>{c.uf}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
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
    <section>
      <form className="card form" onSubmit={onSubmit} autoComplete="off">
        <h3>Novo usuário</h3>
        <div className="formgrid">
          <label className="span2">Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="span2">E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="off" /></label>
          <label>Senha inicial<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} autoComplete="new-password" /></label>
          <label>Papel
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="cliente">Cliente</option>
              <option value="fiscal">Fiscal</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
        </div>
        <Notice>Mínimo de 12 caracteres. Entregue a senha por canal seguro e peça a troca no primeiro acesso. Clientes precisam de liberação por empresa (aba Acessos).</Notice>
        <ErrorBox error={error} />
        <button type="submit" className="button" disabled={busy}>{busy ? "Salvando…" : "Criar usuário"}</button>
      </form>
      <ErrorBox error={list.error} />
      {list.loading && <Loading />}
      {list.data && (
        <section className="tablecard">
          <div className="tablehead"><h3>Usuários ({list.data.users.length})</h3></div>
          <div className="tablewrap">
            <table className="compact">
              <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Último acesso</th></tr></thead>
              <tbody>
                {list.data.users.map((u) => (
                  <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{formatDateTime(u.lastLoginAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
