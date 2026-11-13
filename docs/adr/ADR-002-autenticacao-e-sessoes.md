# ADR-002 — Autenticação, sessões e proteção de credenciais

**Status:** aceita · **Data:** 2026-11-13

## Contexto

Clientes da contabilidade e equipe interna acessam a aplicação com login individual. A Issue #2 exige "sessões seguras; operação sem login bloqueada" e proíbe depender apenas de filtros no frontend. Não há decisão de fornecedor de identidade; o Hub Contar Brasil poderá, no futuro, trazer SSO.

## Decisão

1. **Sessões opacas armazenadas no banco** (`sessions`): o cookie carrega um token aleatório de 32 bytes; o banco guarda apenas o **SHA-256** do token. Expiração absoluta configurável (`SESSION_TTL_HOURS`, padrão 12h), revogação explícita no logout e na troca de senha.
2. **Cookie** `cf_session`: `HttpOnly`, `SameSite=Strict`, `Secure` em produção (ou `COOKIE_SECURE=true`), `Path=/`. O frontend nunca lê o token.
3. **Senhas com scrypt** nativo do Node (N=2¹⁵, r=8, p=1, salt 16 bytes, chave 64 bytes), formato autodescritivo para elevar custo no futuro. Política mínima: 12 caracteres, sem repetição trivial.
4. **CSRF**: `SameSite=Strict` + verificação do cabeçalho `Origin` em todo método mutável contra `ALLOWED_ORIGINS` ou o próprio host. Requisições JSON/XML não são "simple requests", o que já exige preflight de CORS — que a API não habilita.
5. **Rate limit** no login por IP (`LOGIN_RATE_LIMIT_MAX`, padrão 10/min) e global (300/min). Resposta idêntica para "e-mail inexistente" e "senha errada", com verificação de hash fictício para equalizar tempo.
6. **Cabeçalhos de segurança** via Helmet (CSP restritiva, `frame-ancestors 'none'`, HSTS, no-referrer).
7. **Auditoria**: `LOGIN`, `LOGIN_FAILED` (sem e-mail completo, só domínio), `LOGOUT`, `PASSWORD_CHANGED`.
8. Implementação própria, pequena e testada, em `apps/api/src/auth/`.

## Alternativas consideradas

| Opção | Por que não agora |
|---|---|
| JWT stateless | Revogação imediata é requisito (troca de senha, desligamento de usuário). Sessão em banco resolve sem lista de bloqueio. |
| Auth.js (NextAuth) | Orientado a Next.js e provedores OAuth; adaptador para Fastify é periférico. |
| Lucia | Descontinuada como biblioteca (hoje é um guia), cuja recomendação é exatamente a abordagem adotada. |
| Keycloak / Ory | Infraestrutura pesada para o estágio atual; viável quando o Hub definir IdP. |
| Supabase/Clerk/Auth0 | Dependência de fornecedor e dados de identidade de clientes fora do controle da Contar Brasil, sem decisão de negócio. |
| Argon2id | Preferível em teoria, mas exige módulo nativo; scrypt é aceito pela OWASP e vem no Node. Migração é possível pelo formato autodescritivo. |

## Consequências

- Troca de senha encerra as outras sessões do usuário.
- O rate limit é em memória por processo; com várias réplicas, usar store Redis (`@fastify/rate-limit` suporta) — pendência registrada no HANDOFF.
- Falta MFA e recuperação de senha por e-mail; ambos dependem de um serviço de e-mail ainda não decidido.
- Quando houver SSO pelo Hub, a tabela `users` continua sendo a identidade local e `sessions` pode ser alimentada por um novo provedor sem mudar a autorização.
