import { Icon } from '../core/icons';

/** Aviso breve e não bloqueante; a região anuncia a mensagem aos leitores de tela. */
export function Toast({ message }: { message: string | null }) {
  return (
    <div className="px-toast-region" role="status" aria-live="polite">
      {message && (
        <div className="px-toast" key={message}>
          <Icon name="check" size={16} />
          {message}
        </div>
      )}
    </div>
  );
}
