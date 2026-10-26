[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$expectedPath = Join-Path $PSScriptRoot 'expected-totals.json'
$expected = Get-Content -LiteralPath $expectedPath -Raw | ConvertFrom-Json
$modelRoot = Join-Path $PSScriptRoot 'VendasDemo.SemanticModel\definition'
$factTmdl = Get-Content -LiteralPath (Join-Path $modelRoot 'tables\FatoVendas.tmdl') -Raw
$productTmdl = Get-Content -LiteralPath (Join-Path $modelRoot 'tables\DimProduto.tmdl') -Raw
$calendarTmdl = Get-Content -LiteralPath (Join-Path $modelRoot 'tables\DimCalendario.tmdl') -Raw

$requiredFactFragments = @(
    'Precos = {5200, 1450, 1850, 2400, 480, 620}',
    'Custos = {3900, 980, 1200, 1650, 290, 370}',
    '{1..120}',
    'ProdutoId = Number.Mod(VendaId - 1, 6) + 1',
    'Quantidade = Number.Mod((VendaId - 1) * 3, 5) + 1',
    'Data = Date.AddDays(#date(2026, 1, 1), Number.Mod((VendaId - 1) * 17, 90))',
    "measure 'Receita Total' = SUMX(FatoVendas, FatoVendas[Quantidade] * FatoVendas[PrecoUnitario])",
    "measure 'Custo Total' = SUMX(FatoVendas, FatoVendas[Quantidade] * FatoVendas[CustoUnitario])",
    'measure Lucro = [Receita Total] - [Custo Total]',
    "measure 'Margem %' = DIVIDE([Lucro], [Receita Total])",
    "measure 'Quantidade Vendida' = SUM(FatoVendas[Quantidade])"
)
foreach ($fragment in $requiredFactFragments) {
    if (-not $factTmdl.Contains($fragment)) { throw "Definicao TMDL inesperada em FatoVendas: $fragment" }
}
if ([regex]::Matches($productTmdl, '(?m)^\s*\{\d+,').Count -ne 6) { throw 'DimProduto deve conter exatamente seis produtos.' }
if (-not $calendarTmdl.Contains('Datas = List.Dates(#date(2026, 1, 1), 90, #duration(1, 0, 0, 0))')) {
    throw 'DimCalendario deve conter 90 datas a partir de 01/01/2026.'
}
$prices = @(5200, 1450, 1850, 2400, 480, 620)
$costs = @(3900, 980, 1200, 1650, 290, 370)
$rows = New-Object System.Collections.Generic.List[object]

foreach ($saleId in 1..120) {
    $productIndex = ($saleId - 1) % 6
    $quantity = ((($saleId - 1) * 3) % 5) + 1
    $date = [datetime]'2026-01-01'
    $date = $date.AddDays((($saleId - 1) * 17) % 90)
    $rows.Add([pscustomobject]@{
        Date = $date
        Quantity = $quantity
        Revenue = $quantity * $prices[$productIndex]
        Cost = $quantity * $costs[$productIndex]
    })
}

$actual = [ordered]@{
    rowCount = $rows.Count
    quantity = ($rows | Measure-Object -Property Quantity -Sum).Sum
    revenue = ($rows | Measure-Object -Property Revenue -Sum).Sum
    cost = ($rows | Measure-Object -Property Cost -Sum).Sum
}
$actual.profit = $actual.revenue - $actual.cost
$actual.margin = $actual.profit / $actual.revenue

foreach ($property in @('rowCount', 'quantity', 'revenue', 'cost', 'profit')) {
    if ([decimal]$actual[$property] -ne [decimal]$expected.$property) {
        throw "Total inesperado para ${property}: $($actual[$property]); esperado: $($expected.$property)."
    }
}

if ([math]::Abs([double]$actual.margin - [double]$expected.margin) -gt 0.000000000001) {
    throw "Margem inesperada: $($actual.margin); esperada: $($expected.margin)."
}

foreach ($group in ($rows | Group-Object { $_.Date.ToString('yyyy-MM') })) {
    $monthExpected = $expected.months.($group.Name)
    if ($null -eq $monthExpected) {
        throw "Mes inesperado: $($group.Name)."
    }

    $monthRows = @($group.Group)
    $monthActual = @{
        rowCount = $monthRows.Count
        quantity = ($monthRows | Measure-Object -Property Quantity -Sum).Sum
        revenue = ($monthRows | Measure-Object -Property Revenue -Sum).Sum
        cost = ($monthRows | Measure-Object -Property Cost -Sum).Sum
    }

    foreach ($property in @('rowCount', 'quantity', 'revenue', 'cost')) {
        if ([decimal]$monthActual[$property] -ne [decimal]$monthExpected.$property) {
            throw "Total inesperado para $($group.Name)/${property}."
        }
    }
}

[pscustomobject]$actual | Format-List
'VendasDemo totals: PASS'
