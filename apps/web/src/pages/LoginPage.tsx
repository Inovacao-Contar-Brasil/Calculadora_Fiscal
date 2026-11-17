import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { ApiErrorAlert } from "../components";
import { AppearanceToggle, BrandLogo, Button, Field, Icon, Input, MAIN_CONTENT_ID, type IconName } from "../ds";
import { navigate } from "../router";
import "./login.css";

const FEATURES: readonly { icon: IconName; title: string; text: string }[] = [
  { icon: "receipt", title: "NF-e guardada com integridade", text: "O XML original fica no histórico, conferido por SHA-256." },
  { icon: "shield", title: "Revisão fiscal antes de qualquer valor", text: "Nada não homologado aparece como definitivo." },
  { icon: "lock", title: "Dados isolados por empresa", text: "Cada cliente vê somente as empresas liberadas para ele." },
];

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/empresas", true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-auth" id={MAIN_CONTENT_ID}>
      <AppearanceToggle className="px-auth-mode" />
      <section className="px-auth-aside" aria-label="Sobre a Calculadora Fiscal">
        <BrandLogo variant="horizontal" className="px-auth-logo" />
        <div className="px-auth-pitch">
          <h1>Conferência de NF-e por produto, com revisão fiscal.</h1>
          <ul>
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <span className="px-auth-icon">
                  <Icon name={feature.icon} size={18} />
                </span>
                <span>
                  <strong>{feature.title}</strong>
                  {feature.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="px-auth-foot">Calculadora Fiscal · não realiza apuração tributária nesta versão</p>
      </section>
      <section className="px-auth-main" aria-labelledby="login-title">
        <form className="px-auth-form" onSubmit={onSubmit}>
          <div className="px-auth-mobile-logo">
            <BrandLogo variant="horizontal" />
          </div>
          <h2 id="login-title">Entrar</h2>
          <p className="px-page-sub">Use as credenciais fornecidas pela Contar Brasil. Cada acesso é individual e registrado.</p>
          <Field label="E-mail">
            {(props) => <Input {...props} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Senha">
            {(props) => <Input {...props} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <ApiErrorAlert error={error} />
          <Button type="submit" className="px-auth-submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </section>
    </main>
  );
}
