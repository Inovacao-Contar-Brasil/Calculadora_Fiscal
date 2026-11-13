# Segurança — modelo de ameaças e checklist pré-produção

Documento de trabalho da Sprint 1. Complementa as ADRs 002, 003 e 005.

## Ativos

- XML de NF-e e itens extraídos (dados fiscais e pessoais de terceiros).
- Cadastro fiscal das empresas (regime, CNAEs, parâmetros).
- Decisões de classificação do Fiscal e, futuramente, regras legais e cálculos.
- Credenciais e sessões de usuários; trilha de auditoria.

## Atores

| Ator | Confiança | Pode |
|---|---|---|
| Cliente (`cliente`) | baixa | importar XML e consultar nas empresas concedidas |
| Fiscal (`fiscal`) | média | tudo do cliente em todas as empresas da organização + cadastro fiscal + decisões |
| Admin (`admin`) | alta | tudo do fiscal + usuários, empresas, acessos |
| Anônimo | nenhuma | login, health |

## Ameaças e controles

| Ameaça | Controle implementado | Teste |
|---|---|---|
| Acesso sem login | `requireAuth` em todas as rotas de negócio; 401 | `auth.test.ts` |
| Cliente A lê dados de B (listagem ou por ID) | escopo por empresa em toda consulta; 404 fora do escopo | `isolation.test.ts` |
| Cliente altera cadastro fiscal / decide revisão | `loadCompanyForStaff` / `requireRole` → 403 | `isolation.test.ts` |
| Cliente importa nota de terceiro para si | CNPJ do destinatário deve ser o da empresa → 422 | `documents.test.ts` |
| Roubo de sessão via XSS | cookie `HttpOnly`; CSP `script-src 'self'`; React escapa saída | manual (headers) |
| CSRF | `SameSite=Strict` + verificação de `Origin` em métodos mutáveis → 403 | `auth.test.ts` |
| Força bruta de senha | rate limit por IP no login (429); scrypt; resposta uniforme | `auth.test.ts` |
| Enumeração de usuários | mesma mensagem para e-mail inexistente e senha errada; verificação de hash fictício | `auth.test.ts` |
| Cookie forjado | token de 32 bytes aleatórios, só o SHA-256 no banco; formato validado | `auth.test.ts` |
| Sessão eterna | `expires_at` absoluto; revogação no logout e na troca de senha | `auth.test.ts` |
| XML malicioso (XXE, bomba de entidades) | DTD/ENTITY rejeitados antes do parse; `processEntities: false`; 5 MB; 2000 itens | `parser.test.ts`, `documents.test.ts` |
| Corpo gigante / DoS simples | `bodyLimit`, rate limit global 300/min e 60/min na importação | — |
| Vazamento de stack trace | `setErrorHandler`: 500 genérico, log interno | — |
| Clickjacking | `frame-ancestors 'none'` | manual |
| Dados reais no Git | `.gitignore` (`*.xml`, `.env*`, certificados); fixtures sintéticas | revisão de PR |
| Adulteração do XML armazenado | imutável; SHA-256; `contentDiffers` em reimportação | `documents.test.ts` |
| Ações sem rastro | `audit_events` na mesma transação | `fiscal-profiles.test.ts` |

## Riscos residuais e pendências

- Rate limit em memória: com múltiplas réplicas precisa de store compartilhado (Redis).
- Sem MFA, sem recuperação de senha por e-mail, sem bloqueio de conta por tentativas (só por IP).
- Sem Row-Level Security no banco (segunda camada de isolamento) — colunas já preparadas.
- Sem validação de assinatura digital/autorização da NF-e na SEFAZ.
- Retenção/exclusão LGPD não definida (ADR-005).
- Sem varredura automática de dependências no CI (adicionar `npm audit`/Dependabot).
- Logs: garantir que o ambiente de produção não capture corpo de requisições.
- Segredos: `SEED_ADMIN_PASSWORD` só em ambiente; trocar após o primeiro login.

## Checklist antes de qualquer ambiente externo

- [ ] `NODE_ENV=production`, `DATABASE_URL` definido, `COOKIE_SECURE=true`, `TRUST_PROXY` conforme o proxy, `ALLOWED_ORIGINS` só com o domínio real.
- [ ] TLS terminado no proxy; HSTS ativo (Helmet já envia).
- [ ] Backup do PostgreSQL e teste de restauração.
- [ ] Usuário de banco da aplicação sem privilégios de DDL além das migrações.
- [ ] Revisão de acessos (`company_access`) e remoção de usuários de teste.
- [ ] Política de retenção aprovada; canal de resposta a incidentes definido.
- [ ] Testes de isolamento executados contra o banco de produção vazio (CI com PostgreSQL real já cobre).
