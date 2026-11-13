import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { ErrorBox } from "../components";
import { navigate } from "../router";

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
    <div className="loginwrap">
      <form className="card loginform" onSubmit={onSubmit}>
        <div className="eyebrow">Acesso restrito</div>
        <h1>Entrar</h1>
        <p className="muted">Use as credenciais fornecidas pela Contar Brasil. Cada acesso é individual e registrado.</p>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="button" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
