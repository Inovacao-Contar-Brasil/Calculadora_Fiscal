import { api, formatCnpj, type Company } from "../api";
import { useAuth } from "../auth";
import { LoadError, useLoad } from "../components";
import { AppLink, EmptyState, Page, PageHeader, PageSkeleton, Panel, Status, Table } from "../ds";

export function CompaniesPage() {
  const { hasRole } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<{ companies: Company[] }>("/api/companies"), []);
  if (loading) return <PageSkeleton label="Carregando empresas…" />;

  return (
    <Page>
      <PageHeader
        eyebrow="Empresas"
        title="Suas empresas"
        subtitle="Selecione uma empresa para importar NF-e, consultar o histórico e acompanhar o cadastro fiscal mantido pela Contar Brasil."
      />
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : data && data.companies.length === 0 ? (
        <EmptyState icon="building" title="Nenhuma empresa disponível">
          {hasRole("admin", "fiscal") ? (
            <p>
              Cadastre a primeira empresa em <AppLink href="/admin">Administração</AppLink>.
            </p>
          ) : (
            <p>Solicite à Contar Brasil a liberação de acesso à sua empresa.</p>
          )}
        </EmptyState>
      ) : (
        data && (
          <Panel title="Empresas" description={<><span className="num">{data.companies.length}</span> disponível(is) para você</>} flush>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">CNPJ</th>
                  <th scope="col">UF</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map((company) => (
                  <tr key={company.id}>
                    <td className="px-cell-title">
                      <AppLink href={"/empresas/" + company.id} className="px-row-link">
                        {company.tradeName || company.legalName}
                      </AppLink>
                      {company.tradeName && <span className="px-cell-sub">{company.legalName}</span>}
                    </td>
                    <td data-label="CNPJ" className="num cf-nowrap">{formatCnpj(company.cnpj)}</td>
                    <td data-label="UF">{company.uf}</td>
                    <td data-label="Situação">
                      {company.active ? <Status tone="success">Ativa</Status> : <Status tone="neutral" outline>Inativa</Status>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )
      )}
    </Page>
  );
}
