/*
 * Folhas de estilo do Design System oficial, na ordem canônica da cascata.
 * Quem usa componentes de `src/ds` importa ESTE módulo uma única vez, na
 * entrada da aplicação — nunca as folhas individuais.
 *
 *  1. fonte (Inter Variable, auto-hospedada);
 *  2. base e tokens de plataforma (styles/global.css);
 *  3. tokens white-label por modo (theme/theme.css) e camada oficial
 *     (theme/premium.css), ambos só dentro de `.hub-theme`;
 *  4. kit, sempre nesta sequência: base, shell, header, menu, page, data,
 *     patterns, forms, overlays, responsive e motion;
 *  5. identidade e componentes de base (theme/components.css).
 *
 * A ordem 4 → 5 é a da aparência aprovada (v1.2) e não pode ser invertida:
 * regras de mesma especificidade das abas (`.tab[aria-selected]`, `.tab:hover`)
 * dependem de theme/components.css vir depois do kit.
 *
 * Estilos próprios de um módulo (ex.: requests/premium/requests.css) são
 * importados pelos componentes do módulo e entram depois destas folhas.
 *
 * As rotas funcionais atuais NÃO importam este módulo (aparência v1.1 mantida).
 */
import '@fontsource-variable/inter/opsz.css';
import '../styles/global.css';
import '../theme/theme.css';
import '../theme/premium.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/header.css';
import './styles/menu.css';
import './styles/page.css';
import './styles/data.css';
import './styles/patterns.css';
import './styles/forms.css';
import './styles/overlays.css';
import './styles/responsive.css';
import './styles/motion.css';
import '../theme/components.css';
