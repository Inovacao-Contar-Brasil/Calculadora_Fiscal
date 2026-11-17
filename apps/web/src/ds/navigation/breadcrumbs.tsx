import { AppLink } from '../core/link';

/** Trilha de navegação: o último item (ou um item sem endereço) é a página atual. */
export function Breadcrumbs({ items }: { items: readonly { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="breadcrumbs">
      <ol>
        {items.map((item, index) =>
          index === items.length - 1 || !item.href ? (
            <li key={item.label} aria-current="page">
              {item.label}
            </li>
          ) : (
            <li key={item.label}>
              <AppLink href={item.href}>{item.label}</AppLink>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
