# Homologação fiscal — pendências do projeto

**Status:** materiais exemplificativos recebidos para análise interna; homologação de regras e critérios ainda pendente. Documento de trabalho, não é parecer tributário.

O material inclui três NF-e em XML com relatórios de ST, antecipação e caso combinado, além de demonstrativos adicionais, planilha de rateio de frete com múltiplos CT-e e alguns DANFEs/DACTEs. Esses documentos contêm dados fiscais de clientes e **não devem ser incluídos neste repositório**. Números apresentados nos documentos são referências históricas, não parametrização legal universal.

**Achados preliminares:** em exemplos com IPI, o total da NF-e é maior que o valor dos produtos; o leitor precisa mostrar ambos separadamente. Há casos em que ICMS-ST calculado no demonstrativo é positivo apesar de não constar valor de ST destacado no XML. As alíquotas/percentuais fixados manualmente em planilhas não devem ser convertidos em regras sem validação e base legal.

**Insumos ainda pendentes para homologação:** CT-e em XML (os exemplos de transporte incluem PDF), identificação formal dos critérios de rateio, tratamento de créditos e reconciliação do custo unitário. Resultados de relatório fiscal não equivalem automaticamente a custo de estoque.

## Material solicitado
- XML de compra interestadual com ICMS-ST.
- XML com antecipação tributária.
- XML com múltiplos itens e frete.
- Demonstrativos correspondentes conferidos pelo Fiscal (A10 / ST Minas Gerais).
- Explicação do critério usado atualmente para rateio do frete e composição do custo.

## Para cada cenário, registrar
- UF origem/destino, competência e fato gerador.
- Regime de fornecedor/destinatário, benefícios e regimes especiais aplicáveis.
- Finalidade por produto: revenda, uso/consumo, insumo, etc.
- Descrição comercial, NCM/CEST/CFOP, origem, segmento e enquadramento legal do item.
- Tratamento de imposto já retido/destacado, créditos recuperáveis e tributos que compõem o custo.
- Base, MVA, alíquotas, arredondamento, cálculos intermediários, resultado por item e fundamento legal vigente.
- Frete destacado nos itens, frete global, CT-e separado, despesas acessórias, descontos e regra que impede dupla contagem.
- Total por item, custo unitário, conferência contra o cálculo manual e nome da pessoa que homologou.

## Critérios de aceite
- XML lido sem mudança dos campos originais; divergências sinalizadas.
- Regra tributária identificável, versionada e justificada legalmente.
- Comparação item a item contra cálculos já conferidos; exceções registradas.
- Nenhum valor não homologado exposto como custo definitivo para o cliente.
- Auditoria e reprocessamento definidos antes da liberação.
