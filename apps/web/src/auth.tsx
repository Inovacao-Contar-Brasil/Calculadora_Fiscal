import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Me, type Role } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  /** Papel mais alto entre as organizações do usuário (para exibir navegação). */
  hasRole(...roles: Role[]): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/auth/me"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMe(null);
      else throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setMe(null);
  }, []);

  const hasRole = useCallback((...roles: Role[]) => !!me && me.memberships.some((m) => roles.includes(m.role)), [me]);

  return <AuthContext.Provider value={{ me, loading, login, logout, refresh, hasRole }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fora do AuthProvider");
  return value;
}
