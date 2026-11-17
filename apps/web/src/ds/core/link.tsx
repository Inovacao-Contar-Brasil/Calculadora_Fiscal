/*
 * Porta de navegação da linguagem premium. Os componentes reutilizáveis só
 * conhecem endereços (href) e sempre renderizam um link real (abre em nova
 * aba, mostra o endereço). Quem os hospeda informa como navegar sem recarregar:
 * a prévia usa a própria rota em memória e o produto passará o `navigate` do
 * roteador. Sem provedor, o link navega normalmente.
 */
import { createContext, useContext, type AnchorHTMLAttributes } from 'react';

export type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  /** Marca o destino como a página atual (aria-current="page"). */
  current?: boolean;
};

/** Navegação no cliente para um endereço interno. */
export type AppNavigate = (href: string) => void;

const NavigateContext = createContext<AppNavigate | null>(null);

export const AppLinkProvider = NavigateContext.Provider;

export function AppLink({ href, current, onClick, ...rest }: AppLinkProps) {
  const navigate = useContext(NavigateContext);
  return (
    <a
      {...rest}
      href={href}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!navigate || event.defaultPrevented) return;
        // Clique com modificador ou botão do meio segue o comportamento do navegador.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}
