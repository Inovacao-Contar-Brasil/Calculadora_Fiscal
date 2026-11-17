/*
 * Ícones da prévia premium: traço de 1,6 px, cantos arredondados, grade 24 px.
 * Desenhos genéricos próprios (nenhum ícone proprietário de terceiros).
 * Candidatos a substituir src/ui/icons.tsx após a aprovação visual.
 */
import type { ReactNode } from 'react';

const PATHS = {
  home: (
    <>
      <path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5 6.2 5.6A1 1 0 0 1 7.2 5h9.6a1 1 0 0 1 1 .6l2.2 7.9V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M4 13.5h4.2l1.3 2.2h5l1.3-2.2H20" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 14.7c1.8.6 3 2.2 3.5 4.8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m19.5 19.5-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronUpDown: <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M6 18l1.3-1.3M16.7 7.3 18 6" />
    </>
  ),
  moon: <path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1z" />,
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h8" />
      <path d="M10.5 12H20m-3-3.2 3.2 3.2-3.2 3.2" />
    </>
  ),
  swap: <path d="M7 4.5 4 7.5l3 3M4 7.5h13M17 13.5l3 3-3 3M20 16.5H7" />,
  briefcase: (
    <>
      <rect x="3.5" y="7" width="17" height="12.5" rx="1.5" />
      <path d="M9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M3.5 12.5h17" />
    </>
  ),
  wallet: (
    <>
      <path d="M18.5 7.5V6a1 1 0 0 0-1-1H6a2 2 0 0 0 0 4h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V7" />
      <path d="M16 14h1.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 19z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  book: (
    <>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" />
      <path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19M9 8h6" />
    </>
  ),
  idCard: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 15.5c.5-1.3 1.6-2 3-2s2.5.7 3 2M14.5 10h3M14.5 13h3" />
    </>
  ),
  heart: (
    <path d="M12 19.5s-7.5-4.4-7.5-9.6A4 4 0 0 1 12 7.7a4 4 0 0 1 7.5 2.2c0 5.2-7.5 9.6-7.5 9.6z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 20.5 19h-17z" />
      <path d="M12 10v4M12 16.6v.1" />
    </>
  ),
  minusCircle: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12h7" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="1.5" />
      <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
    </>
  ),
  userX: (
    <>
      <circle cx="10" cy="8.5" r="3.2" />
      <path d="M4.5 19.5c.7-3.2 2.9-5 5.5-5 1.2 0 2.3.4 3.2 1M16.5 15.5l4 4M20.5 15.5l-4 4" />
    </>
  ),
  arrowUpRight: <path d="M8 16 16 8M9.5 8H16v6.5" />,
  arrowLeft: <path d="M19 12H5m5.5-6L5 12l5.5 6" />,
  more: (
    <>
      <circle cx="6" cy="12" r="0.9" fill="currentColor" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
      <circle cx="18" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.8 5 6.5v5c0 4.3 2.9 7.6 7 8.8 4.1-1.2 7-4.5 7-8.8v-5z" />
      <path d="m9.2 12 2 2 3.8-3.8" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="m13.5 8.5 3 3" />
    </>
  ),
  list: <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.1M4.5 12h.1M4.5 17h.1" />,
  bars: <path d="M5 20v-6M10 20V9M15 20v-9M20 20V5" />,
  layers: (
    <>
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  building: (
    <>
      <path d="M5 20V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V20M15 10h3a1 1 0 0 1 1 1v9M3.5 20h17" />
      <path d="M8.5 8h3M8.5 11.5h3M8.5 15h3" />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 5v4h4M12 8v4l2.8 1.8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`px-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
