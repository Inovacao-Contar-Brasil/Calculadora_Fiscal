/*
 * Shell autenticado da Calculadora sobre o Design System oficial (mesma
 * composição do OrgLayout do Hub). O DS só recebe dados por propriedade:
 * itens de navegação já filtrados pelo papel, usuário e títulos. A
 * autorização real continua no backend.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role } from "./api";
import { useAuth } from "./auth";
import {
  AccountMenu,
  AppearanceSwitch,
  AppLinkProvider,
  AppShell,
  Avatar,
  BottomNav,
  CommandPalette,
  Header,
  Icon,
  Sheet,
  Sidebar,
  SkipLink,
  type NavItem,
  type PaletteItem,
} from "./ds";
import { navigate, usePath } from "./router";

interface Location {
  section: "empresas" | "revisao" | "admin" | "outro";
  ancestors: { label: string; href: string }[];
  current: string;
}

/** Onde a pessoa está, para o cabeçalho ("organização › seção › página"). */
export function describePath(path: string): Location {
  const empresas = { label: "Empresas", href: "/empresas" };
  const revisao = { label: "Revisão fiscal", href: "/revisao" };
  if (path === "/empresas" || path === "/") return { section: "empresas", ancestors: [], current: "Empresas" };
  if (path.startsWith("/empresas/")) return { section: "empresas", ancestors: [empresas], current: "Empresa" };
  if (path.startsWith("/documentos/")) return { section: "empresas", ancestors: [empresas], current: "NF-e" };
  if (path === "/revisao") return { section: "revisao", ancestors: [], current: "Revisão fiscal" };
  if (path.startsWith("/revisao/")) return { section: "revisao", ancestors: [revisao], current: "Produto" };
  if (path === "/admin") return { section: "admin", ancestors: [], current: "Administração" };
  return { section: "outro", ancestors: [], current: "Página não encontrada" };
}

/** Itens de navegação permitidos ao papel (só apresentação: o backend decide o acesso). */
export function navItemsFor(hasRole: (...roles: Role[]) => boolean): NavItem[] {
  const items: NavItem[] = [{ id: "empresas", label: "Empresas", icon: "building", href: "/empresas" }];
  if (hasRole("admin", "fiscal")) items.push({ id: "revisao", label: "Revisão fiscal", icon: "inbox", href: "/revisao" });
  if (hasRole("admin")) items.push({ id: "admin", label: "Administração", icon: "shield", href: "/admin" });
  return items;
}

interface Destination extends PaletteItem {
  href: string;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { me, logout, hasRole } = useAuth();
  const path = usePath();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = useMemo(() => navItemsFor(hasRole), [hasRole]);
  const destinations = useMemo<Destination[]>(
    () => items.map((item) => ({ id: item.id, group: "Ir para", label: item.label, icon: item.icon, href: item.href })),
    [items],
  );
  const search = useMemo(
    () => (query: string): readonly Destination[] =>
      destinations.filter((item) => item.label.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))),
    [destinations],
  );

  if (!me) return null;
  const where = describePath(path);
  const user = { name: me.user.name, email: me.user.email };
  const organizationName = me.memberships[0]?.organizationName || "Calculadora Fiscal";
  const signOut = () => void logout().then(() => navigate("/login"));

  return (
    <AppLinkProvider value={(href) => navigate(href)}>
      <SkipLink />
      <AppShell
        sidebar={
          <Sidebar
            brandHref="/empresas"
            brandLabel="Calculadora Fiscal — início"
            caption="Espaço de trabalho"
            items={items}
            currentId={where.section}
            footer={<AccountMenu user={user} onSignOut={signOut} />}
          />
        }
        header={<Header organizationName={organizationName} ancestors={where.ancestors} current={where.current} onSearch={() => setSearchOpen(true)} />}
        bottomNav={<BottomNav items={items} currentId={where.section} more={(close) => <AccountSheet user={user} onSignOut={signOut} onClose={close} />} />}
      >
        {children}
        <p className="cf-footnote">Calculadora Fiscal · Nenhum cálculo tributário homologado nesta versão: valores exibidos são os declarados no XML.</p>
      </AppShell>
      {searchOpen && (
        <CommandPalette
          search={search}
          onSelect={(item) => navigate(item.href)}
          onClose={() => setSearchOpen(false)}
          placeholder="Buscar página…"
          emptyMessage={() => "Nenhuma página disponível para o seu papel."}
          scopeNote="Apenas páginas permitidas ao seu papel"
        />
      )}
    </AppLinkProvider>
  );
}

/**
 * Painel "Mais" do celular: conta, aparência e sair. Composto com peças públicas
 * do DS (Sheet, AppearanceSwitch) porque o MoreSheet do Hub traz "Trocar
 * organização", que não existe na Calculadora.
 */
function AccountSheet({ user, onSignOut, onClose }: { user: { name: string; email: string }; onSignOut: () => void; onClose: () => void }) {
  return (
    <Sheet label="Mais opções" onClose={onClose}>
      <div className="px-sheet-head">
        <Avatar name={user.name} size={36} tone="brand" />
        <div className="px-account-text">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </div>
        <button type="button" className="px-icon-btn" aria-label="Fechar" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <AppearanceSwitch />
      <div className="px-sheet-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            onClose();
            onSignOut();
          }}
        >
          <Icon name="logout" size={16} />
          Sair
        </button>
      </div>
    </Sheet>
  );
}
