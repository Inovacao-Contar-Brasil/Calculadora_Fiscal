# ADR-005 — Armazenamento de XML, LGPD, retenção e auditoria

**Status:** aceita (com pendências de negócio) · **Data:** 2026-11-13

## Contexto

A NF-e contém dados pessoais e fiscais de terceiros (CNPJ/CPF, endereços, valores). O sistema precisa guardar o documento original para reprocessamento e prova, controlar acesso e registrar quem fez o quê. A Issue #2 pede ADR sobre "armazenamento de XML, LGPD, acesso, criptografia, retenção e auditoria".

## Decisão

1. **XML original íntegro** na coluna `nfe_documents.raw_xml` (texto), exatamente como recebido, mais `sha256` dos bytes. O documento nunca é alterado; conferências e avisos ficam em colunas separadas (`warnings`, `totals`).
2. **Deduplicação idempotente** por `(company_id, access_key)` (índice único). Reimportar devolve o documento existente (`duplicate: true`) e sinaliza `contentDiffers` quando os bytes divergem — o original prevalece.
3. **Vínculo obrigatório com a empresa**: o CNPJ do destinatário no XML tem que ser o CNPJ da empresa escolhida; caso contrário 422. Isso impede que um cliente deposite notas de terceiros na própria conta.
4. **Acesso**: leitura do documento e download do XML passam pela autorização por empresa (ADR-003). O download gera evento `NFE_XML_DOWNLOADED`.
5. **Auditoria** (`audit_events`, append-only): ator, organização, empresa, ação, entidade, metadados e IP. Eventos atuais: login/logout/falha, criação de usuário/empresa/acesso, versões de cadastro fiscal, importação (inclusive duplicada), download, transições de revisão e reabertura. Gravados **na mesma transação** da operação sempre que há escrita.
6. **Criptografia em repouso**: delegada ao PostgreSQL gerenciado/volume criptografado do ambiente de produção (a decidir). Em trânsito: TLS obrigatório no proxy (`COOKIE_SECURE`, HSTS via Helmet).
7. **Nenhum dado real no repositório**: `.gitignore` bloqueia `*.xml`, `*.pfx`, `*.p12`, `*.pem`, `.env*`; testes usam XML sintético e CNPJs gerados.
8. **Retenção e exclusão**: **pendente de decisão de negócio** (prazo legal de guarda de documentos fiscais vs. direito de exclusão LGPD; sugestão inicial: reter enquanto a empresa for cliente ativa e por 5 anos após, com anonimização de dados pessoais de terceiros quando solicitado). Até a decisão, não há rotina de exclusão.

## Alternativas consideradas

| Opção | Por que não agora |
|---|---|
| XML em object storage (S3/GCS) com ponteiro no banco | Melhor para volume alto; adiciona um serviço e credenciais. O esquema permite migrar depois (`raw_xml` → URL + hash) sem mudar a API. |
| Criptografia por coluna (pgcrypto / app-level) | Dificulta busca e reprocessamento; só justificável se o ambiente de produção não oferecer criptografia em repouso. |
| Não guardar o XML, só os campos extraídos | Impede reprocessamento após homologação de regras e perde valor probatório. |
| Guardar hash apenas da chave | A chave já é única por NF-e; o hash do conteúdo detecta adulteração/divergência e por isso é mantido. |

## Consequências

- Tamanho máximo do XML: 5 MB (`MAX_XML_BYTES`), limite também no `bodyLimit` da rota.
- Logs da aplicação não devem conter o XML nem dados pessoais; o logger registra apenas erros e metadados.
- Antes do piloto externo: definir retenção, DPO/base legal, política de acesso de suporte e procedimento de resposta a incidentes (ver `docs/SEGURANCA.md`).
