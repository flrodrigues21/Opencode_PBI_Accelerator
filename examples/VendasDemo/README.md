# VendasDemo

Projeto Power BI demonstrativo, autocontido e ficticio. O modelo usa somente expressoes Power Query M locais com `#table`; nao acessa rede, arquivos externos, credenciais ou gateway.

Esta pasta e a fonte canonica usada por `/demo-powerbi`. Trabalhe na copia independente criada pelo comando, nao neste exemplo distribuido. O comando recusa destinos existentes e informa o `VendasDemo.pbip` que deve ser aberto.

## Conteudo

- `DimProduto`: seis produtos em tres categorias.
- `DimCalendario`: datas continuas de 1 de janeiro a 31 de marco de 2026.
- `FatoVendas`: 120 vendas deterministicas.
- Relacionamentos 1:N, com filtro unidirecional das dimensoes para a fato.
- Medidas: `Receita Total`, `Custo Total`, `Lucro`, `Margem %` e `Quantidade Vendida`.
- Pagina `Visão Geral`: quatro cards, dois graficos, tabela por produto e filtros de mes/categoria.

## Totais Esperados

| Indicador | Valor |
|---|---:|
| Linhas de venda | 120 |
| Quantidade vendida | 360 |
| Receita total | R$ 720.000,00 |
| Custo total | R$ 503.400,00 |
| Lucro | R$ 216.600,00 |
| Margem | 30,0833% |

Os totais mensais estao em `expected-totals.json`. O teste confere a definicao deterministica no TMDL e recalcula os valores independentemente do Power BI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\Test-VendasDemo.ps1"
```

## Validacao PBIR

Com o acelerador atualizado e a partir desta pasta:

```powershell
& "<InstallRoot>\node\node_modules\.bin\powerbi-report-author.cmd" validate ".\VendasDemo.pbip" --no-schema
```

Abra `VendasDemo.pbip` no Power BI Desktop para carregar o modelo e confirmar a renderizacao. Como caches locais nao sao distribuidos, a primeira abertura pode exigir uma unica atualizacao manual antes da conferencia visual. Arquivos locais do Desktop em `.pbi` sao ignorados pelo Git.
