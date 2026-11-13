# ADR-006 — Transição do leitor local para ingestão no backend

**Status:** aceita · **Data:** 2026-11-13

## Contexto

O PR #1 lia o XML no navegador, sem envio a servidor — adequado para um protótipo, inviável para histórico, revisão fiscal e isolamento. A transição não pode fragilizar a segurança que o leitor local já tinha (rejeição de DTD/entidades, limite de tamanho, validação de modelo 55, valores em centavos inteiros).

## Decisão

1. O parser (`parseNfe`) foi **movido sem alteração funcional** para `packages/domain/src/nfe/parser.ts`, com os testes originais. Passa a rodar **no servidor**.
2. O frontend envia o arquivo como `application/xml` em `POST /api/companies/:id/documents`. Não há mais parsing no navegador; a interface só exibe o que a API devolve.
3. Defesas na API, nesta ordem: autenticação → autorização por empresa → `bodyLimit` (5 MB + folga) → rate limit (60/min) → `parseNfe` (DTD/entidades proibidas, XML bem formado, modelo 55, limite de 2000 itens, monetários válidos) → chave de acesso de 44 dígitos → CNPJ do destinatário = empresa → dedupe → transação única (documento + itens + fila de revisão + auditoria).
4. Erros do parser são mapeados para **422** com a mensagem do domínio (já pensada para o usuário); qualquer outra falha é 500 genérico com log interno.
5. O parser **não** valida assinatura digital, autorização na SEFAZ nem eventos (cancelamento, carta de correção). Isso fica registrado nos limites do produto até haver decisão de integrar consulta à SEFAZ.

## Alternativas consideradas

| Opção | Por que não |
|---|---|
| Manter parsing no navegador e enviar JSON extraído | O servidor não poderia confiar nos dados nem guardar o original; o cliente poderia forjar itens. |
| Upload `multipart/form-data` | Mais complexidade (streams, limites por parte) para um único arquivo pequeno; corpo cru com `Content-Type: application/xml` é suficiente e mais simples de validar. |
| Fila assíncrona para processar o XML | Latência da leitura é de milissegundos; processamento síncrono dá resposta imediata (duplicado, divergência, pendências). Reavaliar se houver importação em lote. |

## Consequências

- `apps/web` não depende mais de `fast-xml-parser`; o bundle diminuiu.
- Qualquer evolução do parser deve manter o princípio "ler sem interpretar": campos declarados, conferência aritmética, nenhuma inferência tributária.
- Importação em lote (vários XML / ZIP) e consulta de situação na SEFAZ são trabalho futuro.
