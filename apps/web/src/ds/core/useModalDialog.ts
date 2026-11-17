/*
 * Comportamento único dos diálogos modais nativos (<dialog>): abre como modal
 * (foco preso, página inerte), Esc pede o fechamento e, ao sair, o foco volta
 * a quem abriu. Usado por Dialog, Sheet e CommandPalette.
 */
import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';

export function useModalDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  // Capturado na primeira renderização, antes de um autoFocus interno roubar o foco.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);
  return {
    ref,
    /** Esc: o diálogo só fecha quando quem o hospeda remove o componente. */
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    /** Clique no fundo (fora do conteúdo) fecha; uso opcional. */
    onBackdropClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
  };
}
