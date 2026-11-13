# Arquitetura e evolução para o Hub

## Primeira entrega — leitor local de NF-e
- React + TypeScript + Vite.
- Leitura do XML no browser, sem upload de documentos ou armazenamento persistente.
- O importador em `src/lib/nfe.ts` retorna um modelo tipado independente da interface.
- Aceita NF-e modelo 55 em `nfeProc/NFe` ou `NFe` direto. Outros formatos exigem novos adaptadores.
- Validação sintática, limite de tamanho, rejeição de DTD/entidades declaradas e conferência aritmética preliminar de totais.
- Campos monetários declarados são lidos em centavos inteiros. Não há apuração tributária, rateio ou classificação fiscal.
- Os testes utilizam XML inteiramente sintético.

## Arquitetura de destino (ainda NÃO implementada)
- Aplicação web e API autenticada.
- PostgreSQL com isolamento por organização/empresa, políticas de autorização e trilhas de auditoria.
- Documento fiscal imutável armazenado com hash e controle de acesso; segregação por tenant.
- Motor tributário determinístico, regras legais versionadas com vigência e memória de cálculo.
- Motor separado para apropriação de frete/despesas, tratamento de créditos e custo unitário.
- Fila de revisão de exceções pelo Fiscal; somente casos homologados em autosserviço.
- APIs independentes para futura incorporação ao Hub, evitando acoplamento ao frontend.

## Limites e segurança
- O protótipo não valida assinatura digital, autorização na SEFAZ, eventos/cancelamentos nem a integridade legal de uma NF-e.
- A conferência atual compara valores declarados entre itens e total; não garante o fechamento da NF-e ou correção fiscal.
- XMLs de clientes, certificados e credenciais nunca devem ser commitados.
- Antes de produção: autenticação, autorização, LGPD, testes de isolamento, upload seguro, restrições de acesso e aprovação fiscal.
- Nenhuma fórmula de ICMS-ST, antecipação ou rateio entra em produção sem caso real conferido e homologação expressa.

## Próximas etapas
1. Receber com autorização XMLs e demonstrativos reais do setor Fiscal, preferencialmente anonimizados nos ambientes de desenvolvimento.
2. Elaborar matriz de cenários (UF, regime, finalidade, NCM/CEST/descrição, datas e exceções).
3. Formalizar regras legais e critérios de rateio, com datas de vigência.
4. Desenvolver os motores de forma independente, com testes comparativos por item.
5. Introduzir backend, autenticação, banco e revisão fiscal antes do primeiro piloto externo.
