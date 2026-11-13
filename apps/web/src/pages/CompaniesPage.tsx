import { api, formatCnpj, type Company } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, useLoad } from "../components";
import { Link } from "../router";

export function CompaniesPage() {
  const { hasRole } = useAuth();
  const { data, error, loading } = useLoad(() => api<{ companies: Company[] }>("/api/companies"), []);
  return (
    <>
      <div className="eyebrow">Empresas</div>
      <div className="heading">
        <div>
          <h1>Suas empresas</h1>
          <p>Selecione uma empresa para importar NF-e, consultar o histórico e acompanhar o cadastro fiscal mantido pela Contar Brasil.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && <Loading />}
      {data && data.companies.length === 0 && (
        <Empty title="Nenhuma empresa disponível.">
          {hasRole("admin", "fiscal") ? <>Cadastre a primeira empresa em <Link to="/admin">Administração</Link>.</> : "Solicite à Contar Brasil a liberação de acesso à sua empresa."}
        </Empty>
      )}
      {data && data.companies.length > 0 && (
        <div className="cardgrid">
          {data.companies.map((company) => (
            <Link key={company.id} to={"/empresas/" + company.id} className="card companycard">
              <strong>{company.tradeName || company.legalName}</strong>
              {company.tradeName && <span className="muted">{company.legalName}</span>}
              <span className="muted">{formatCnpj(company.cnpj)} · {company.uf}</span>
              {!company.active && <span className="badge rejeitado">Inativa</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
