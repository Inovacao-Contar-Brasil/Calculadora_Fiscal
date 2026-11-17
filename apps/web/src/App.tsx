import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth";
import { Layout, Loading } from "./components";
import { AdminPage } from "./pages/AdminPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { CompanyPage } from "./pages/CompanyPage";
import { DocumentPage } from "./pages/DocumentPage";
import { LoginPage } from "./pages/LoginPage";
import { ReviewDetailPage, ReviewQueuePage } from "./pages/ReviewPage";
import { matchPath, navigate, RouterProvider, usePath } from "./router";

function Routes() {
  const { me, loading, hasRole } = useAuth();
  const path = usePath();

  useEffect(() => {
    if (loading) return;
    if (!me && path !== "/login") navigate("/login", true);
    if (me && (path === "/login" || path === "/")) navigate("/empresas", true);
  }, [me, loading, path]);

  if (loading) return <Layout><Loading label="Verificando sessão…" /></Layout>;
  if (!me) return <Layout><LoginPage /></Layout>;

  let page: React.ReactNode;
  let params: Record<string, string> | null;
  if (path === "/empresas" || path === "/" || path === "/login") page = <CompaniesPage />;
  else if ((params = matchPath("/empresas/:id", path))) page = <CompanyPage id={params.id!} />;
  else if ((params = matchPath("/documentos/:id", path))) page = <DocumentPage id={params.id!} />;
  else if (path === "/revisao" && hasRole("admin", "fiscal")) page = <ReviewQueuePage />;
  else if ((params = matchPath("/revisao/:id", path)) && hasRole("admin", "fiscal")) page = <ReviewDetailPage id={params.id!} />;
  else if (path === "/admin" && hasRole("admin")) page = <AdminPage />;
  else page = <div className="empty"><strong>Página não encontrada.</strong></div>;

  return <Layout>{page}</Layout>;
}

export default function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </RouterProvider>
  );
}
