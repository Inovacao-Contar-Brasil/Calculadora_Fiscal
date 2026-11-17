/*
 * Integração do Design System nas telas reais da Calculadora, com a API
 * simulada (dados sintéticos). Verifica que as funcionalidades existentes
 * continuam: login, navegação por papel, tema claro/escuro e situações.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { COLOR_MODE_STORAGE_KEY } from "../src/App";
import type { Me, Role } from "../src/api";
import { ClassificationBadge, DocumentBadge } from "../src/components";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

function stubApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const result = handler(url, init) ?? { status: 404, body: { error: { code: "NOT_FOUND", message: "Recurso não encontrado." } } };
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => "application/json" },
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const meFor = (role: Role): Me => ({
  user: { id: "u-1", email: role + "@exemplo.test", name: "Pessoa Sintética" },
  memberships: [{ organizationId: "org-1", role, organizationName: "Organização Sintética" }],
});

const COMPANY = { id: "c-1", organizationId: "org-1", cnpj: "11222333000181", legalName: "Empresa Sintética Ltda", tradeName: "Sintética", uf: "MG", active: true, createdAt: "2026-11-01T10:00:00Z" };

function signedInAs(role: Role): Handler {
  return (url) => {
    if (url === "/api/auth/me") return { body: meFor(role) };
    if (url === "/api/companies") return { body: { companies: [COMPANY] } };
    return undefined;
  };
}

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => vi.unstubAllGlobals());

const themeRoot = () => document.querySelector(".hub-theme") as HTMLElement;

describe("tema e identidade", () => {
  it("aplica a camada oficial com a marca da Calculadora (sem logotipo da Contar Brasil)", async () => {
    stubApi((url) => (url === "/api/auth/me" ? { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } } } : undefined));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    const root = themeRoot();
    expect(root).toHaveClass("hub-theme", "hub-premium", "px-root");
    expect(root.dataset.brandSource).toBe("platform");
    expect(root.style.getPropertyValue("--brand-primary-600")).toBe("#366847");
    expect(screen.getAllByText("Calculadora Fiscal").length).toBeGreaterThan(0);
    expect(document.querySelector("img[src*='contarbrasil']")).toBeNull();
  });

  it("troca claro/escuro e guarda a preferência pessoal na chave da Calculadora", async () => {
    stubApi(() => ({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } } }));
    render(<App />);
    await screen.findByRole("heading", { name: "Entrar" });
    expect(themeRoot().dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("button", { name: "Usar aparência escura" }));
    expect(themeRoot().dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Usar aparência clara" })).toBeInTheDocument();
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
  });
});

describe("login", () => {
  it("entra e abre a lista de empresas no shell", async () => {
    let signedIn = false;
    const fetchMock = stubApi((url, init) => {
      if (url === "/api/auth/me") return signedIn ? { body: meFor("cliente") } : { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } } };
      if (url === "/api/auth/login" && init?.method === "POST") {
        signedIn = true;
        return { body: { user: meFor("cliente").user, expiresAt: "2026-11-17T23:00:00Z" } };
      }
      if (url === "/api/companies") return { body: { companies: [COMPANY] } };
      return undefined;
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("E-mail"), "cliente@exemplo.test");
    await userEvent.type(screen.getByLabelText("Senha"), "senha-sintetica-123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Suas empresas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sintética" })).toHaveAttribute("href", "/empresas/c-1");
    expect(window.location.pathname).toBe("/empresas");
    const login = fetchMock.mock.calls.find(([url]) => url === "/api/auth/login");
    expect(JSON.parse(String(login?.[1]?.body))).toEqual({ email: "cliente@exemplo.test", password: "senha-sintetica-123" });
  });

  it("mostra o erro da API sem sair da tela", async () => {
    stubApi((url) => {
      if (url === "/api/auth/me") return { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } } };
      if (url === "/api/auth/login") return { status: 401, body: { error: { code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." } } };
      return undefined;
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("E-mail"), "x@exemplo.test");
    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos.");
  });
});

describe("shell: navegação conforme o papel", () => {
  const navLabels = () => within(screen.getByRole("navigation", { name: "Navegação principal" })).getAllByRole("link").map((a) => a.textContent);

  it.each([
    ["cliente", ["Empresas"]],
    ["fiscal", ["Empresas", "Revisão fiscal"]],
    ["admin", ["Empresas", "Revisão fiscal", "Administração"]],
  ] as const)("%s vê %j", async (role, expected) => {
    stubApi(signedInAs(role));
    window.history.replaceState(null, "", "/empresas");
    render(<App />);
    await screen.findByRole("heading", { name: "Suas empresas" });
    expect(navLabels()).toEqual(expected);
    // Barra lateral e navegação do celular marcam a mesma seção como atual.
    expect(screen.getAllByRole("link", { name: "Empresas", current: "page" })).toHaveLength(2);
    expect(within(screen.getByRole("navigation", { name: "Navegação principal (celular)" })).getAllByRole("link").map((a) => a.textContent)).toEqual(expected);
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute("href", "#conteudo");
  });

  it("cliente que digita o endereço da revisão vê 'Página não encontrada'", async () => {
    stubApi(signedInAs("cliente"));
    window.history.replaceState(null, "", "/revisao");
    render(<App />);
    expect(await screen.findByText("Página não encontrada", { selector: "strong" })).toBeInTheDocument();
  });

  it("links internos navegam sem recarregar (AppLinkProvider)", async () => {
    stubApi((url) => signedInAs("admin")(url) ?? (url === "/api/organizations/org-1/users" ? { body: { users: [] } } : undefined));
    window.history.replaceState(null, "", "/empresas");
    render(<App />);
    await screen.findByRole("heading", { name: "Suas empresas" });
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    await userEvent.click(within(nav).getByRole("link", { name: "Administração" }));
    expect(await screen.findByRole("heading", { name: "Organização" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin");
  });
});

describe("situações acessíveis (cor nunca é o único sinal)", () => {
  it.each([
    ["PENDENTE_REVISAO", "Pendente de revisão", "warning"],
    ["EM_ANALISE", "Em análise", "info"],
    ["HOMOLOGADO", "Homologado", "success"],
    ["REJEITADO", "Rejeitado", "danger"],
  ] as const)("classificação %s", (status, label, tone) => {
    const { container } = render(<ClassificationBadge status={status} />);
    expect(container).toHaveTextContent(label);
    expect(container.querySelector(".px-status")).toHaveAttribute("data-tone", tone);
  });

  it("documento com pendências", () => {
    const { container } = render(<DocumentBadge status="COM_PENDENCIAS" />);
    expect(container).toHaveTextContent("Com pendências");
    expect(container.querySelector(".px-status")).toHaveAttribute("data-tone", "warning");
  });
});
