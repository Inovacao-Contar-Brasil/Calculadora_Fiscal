/*
 * Estrutura da aplicação: raiz do tema, link "pular para o conteúdo" e o shell
 * (barra lateral, cabeçalho, conteúdo e navegação inferior).
 *
 * O shell só organiza regiões: quem hospeda entrega `Sidebar`, `Header` e
 * `BottomNav` já alimentados com os próprios dados (organização, permissões,
 * rotas). Assim a Fundação e a prévia usam exatamente a mesma estrutura.
 */
import type { ReactNode, Ref } from 'react';
import { ThemeRoot } from '../../theme/ThemeProvider';

/** Âncora do conteúdo principal (alvo do link "pular para o conteúdo"). */
export const MAIN_CONTENT_ID = 'conteudo';

/**
 * Raiz do Design System: aplica o tema white-label (modo de cor + marca da
 * organização, vindos dos provedores de `theme`) e a camada visual oficial.
 * Tudo que usa componentes `ds` precisa estar dentro dela.
 */
export function DesignSystemRoot({
  children,
  organizationId,
  className = '',
}: {
  children: ReactNode;
  /** Identifica o escopo para testes e depuração (não é dado sensível). */
  organizationId?: string;
  className?: string;
}) {
  return (
    <ThemeRoot
      className={`hub-premium px-root ${className}`.trim()}
      organizationId={organizationId}
    >
      {children}
    </ThemeRoot>
  );
}

export function SkipLink({ children = 'Pular para o conteúdo' }: { children?: ReactNode }) {
  return (
    <a className="px-skip" href={`#${MAIN_CONTENT_ID}`}>
      {children}
    </a>
  );
}

export function AppShell({
  sidebar,
  header,
  bottomNav,
  children,
  mainRef,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  /** Navegação do celular; aparece abaixo de 900 px. */
  bottomNav?: ReactNode;
  children: ReactNode;
  /** Para levar o foco ao conteúdo depois de uma troca de página. */
  mainRef?: Ref<HTMLElement>;
}) {
  return (
    <div className="px-app">
      {sidebar}
      <div className="px-column">
        {header}
        <main className="px-main" id={MAIN_CONTENT_ID} ref={mainRef} tabIndex={-1}>
          {children}
        </main>
      </div>
      {bottomNav}
    </div>
  );
}
