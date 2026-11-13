# Calculadora Fiscal — Contar Brasil

Aplicação web independente para importar XML de NF-e e, após homologação fiscal, calcular ICMS-ST, antecipação tributária, rateio de despesas e custo de aquisição por produto.

**Estado atual:** fundação e leitor de XML em desenvolvimento. Nenhum cálculo tributário está homologado; não usar os resultados preliminares para precificação ou apuração fiscal.

## Primeiro marco
1. Validar e interpretar XML de NF-e recebido por upload.
2. Exibir identificação da nota, itens, quantidades, campos fiscais declarados e totais.
3. Conferir somas sem estimar tributação ou frete.
4. Preparar a futura arquitetura modular para incorporação ao Hub Contar Brasil.

Desenvolvimento e testes devem utilizar exemplos sintéticos ou dados autorizados e tratados. Não versionar XMLs de clientes ou credenciais.
