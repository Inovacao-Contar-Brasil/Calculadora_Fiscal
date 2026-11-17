import { useEffect } from "react";
import { AppLayout } from "./AppLayout";
import { AuthProvider, useAuth } from "./auth";
import { AppLinkProvider, EmptyState, Loading, Page, ThemeProvider } from "./ds";
import { AdminPage } from "./pages/AdminPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { CompanyPage } from "./pages/CompanyPage";
import { DocumentPage } from "./pages/DocumentPage";
import { LoginPage } from "./pages/LoginPage";
import { ReviewDetailPage, ReviewQueuePage } from "./pages/ReviewPage";
import { matchPath, navigate, RouterProvider, usePath } from "./router";

/** Preferência de aparência é pessoal e deste dispositivo; não depende da organização. */
export const COLOR_MODE_STORAGE_KEY = "calculadora.color-mode";

function Routes() {
  const { me, loading, hasRole } = useAuth();
  const path = usePath();

  useEffect(() => {
    if (loading) return;
    if (!me && path !== "/login") navigate("/login", true);
    if (me && (path === "/login" || path === "/")) navigate("/empresas", true);
  }, [me, loading, path]);

  if (loading) {
    return (
      <div className="cf-boot">
        <Loading label="Verificando sessão…" />
      </div>
    );
  }
  if (!me) {
    return (
      <AppLinkProvider value={(href) => navigate(href)}>
        <LoginPage />
      </AppLinkProvider>
    );
  }

  let page: React.ReactNode;
  let params: Record<string, string> | null;
  if (path === "/empresas" || path === "/" || path === "/login") page = <CompaniesPage />;
  else if ((params = matchPath("/empresas/:id", path))) page = <CompanyPage id={params.id!} />;
  else if ((params = matchPath("/documentos/:id", path))) page = <DocumentPage id={params.id!} />;
  else if (path === "/revisao" && hasRole("admin", "fiscal")) page = <ReviewQueuePage />;
  else if ((params = matchPath("/revisao/:id", path)) && hasRole("admin", "fiscal")) page = <ReviewDetailPage id={params.id!} />;
  else if (path === "/admin" && hasRole("admin")) page = <AdminPage />;
  else
    page = (
      <Page>
        <EmptyState icon="alert" title="Página não encontrada">
          <p>O endereço não existe ou não está disponível para o seu papel.</p>
        </EmptyState>
      </Page>
    );

  return <AppLayout>{page}</AppLayout>;
}

export default function App() {
  return (
    <ThemeProvider className="hub-premium px-root" storageKey={COLOR_MODE_STORAGE_KEY}>
      <RouterProvider>
        <AuthProvider>
          <Routes />
        </AuthProvider>
      </RouterProvider>
    </ThemeProvider>
  );
}
