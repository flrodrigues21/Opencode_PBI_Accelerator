---
name: rode-o-bpa
description: >
  Run the Best Practice Analyzer (BPA) against a Power BI semantic model using
  Tabular Editor. Imports the official Microsoft BPA rules (BPARules.json) and
  guides the agent through analyzing, interpreting results, and fixing issues.
  Use when the user wants to: (1) run BPA on a model, (2) check best practices,
  (3) analyze model quality, (4) find performance issues, (5) validate DAX patterns.
  Triggers: "run BPA", "best practice analyzer", "analyze model", "check model quality",
  "validate semantic model", "rodar BPA", "melhorar modelo".
---

# Rode o BPA (Best Practice Analyzer)

Executa o Best Practice Analyzer do Tabular Editor contra um modelo semantico Power BI
usando as regras oficiais da Microsoft.

## Quando executar

Executar esta skill quando o usuario solicitar:
- Analise de best practices do modelo
- Verificacao de qualidade do modelo semantico
- Identificacao de problemas de performance ou DAX
- Validacao antes de publicar/deployar

## Pre-requisitos

- **Tabular Editor 2 ou 3** instalado e acessivel via PATH
- **Power BI Desktop** com o modelo aberto (para conexao via TOM)
- Arquivo `BPARules.json` disponivel em `skills/rode-o-bpa/references/BPARules.json`

## Procedimento

### Passo 1: Localizar o modelo

1. Identificar o arquivo `.pbip` na pasta do projeto
2. Identificar a pasta `.SemanticModel` correspondente
3. Confirmar que o Power BI Desktop esta com o modelo aberto

### Passo 2: Copiar regras BPA para o Tabular Editor

O Tabular Editor procura as regras BPA em:
- **TE2**: `%LOCALAPPDATA%\TabularEditor\BPARules.json`
- **TE3**: `%LOCALAPPDATA%\TabularEditor3\BPARules.json`

Copiar o arquivo `skills/rode-o-bpa/references/BPARules.json` para o diretorio correto:

```powershell
# Para Tabular Editor 2
$bpaSource = Join-Path $PSScriptRoot "..\skills\rode-o-bpa\references\BPARules.json"
$bpaDest = Join-Path $env:LOCALAPPDATA "TabularEditor\BPARules.json"
Copy-Item $bpaSource $bpaDest -Force

# Para Tabular Editor 3
$bpaDest3 = Join-Path $env:LOCALAPPDATA "TabularEditor3\BPARules.json"
Copy-Item $bpaSource $bpaDest3 -Force
```

### Passo 3: Executar o BPA via script C#

Criar e executar um script no Tabular Editor que:

1. Conecta ao modelo via TOM (Tabular Object Model)
2. Carrega as regras BPA
3. Executa a analise
4. Retorna os resultados

Script base para TE2:

```csharp
// Carregar modelo
var model = Model;

// Contar violacoes por severidade
int severe = 0, warning = 0, info = 0;

// Listar tabelas
Information("=== Tabelas ===");
foreach (var table in model.Tables) {
    Information($"  {table.Name} ({table.Columns.Count} colunas)");
}

// Listar medidas
Information("=== Medidas ===");
foreach (var table in model.Tables) {
    foreach (var measure in table.Measures) {
        Information($"  [{table.Name}].[{measure.Name}]");
    }
}

// Listar relacionamentos
Information("=== Relacionamentos ===");
foreach (var rel in model.Relationships) {
    Information($"  {rel.FromTable.Name}[{rel.FromColumn.Name}] -> {rel.ToTable.Name}[{rel.ToColumn.Name}] ({rel.CrossFilteringBehavior})");
}

Information("Analise BPA concluida.");
```

### Passo 4: Interpretar resultados

Classificar as violacoes encontradas por categoria:

| Categoria | Descricao | Acao recomendada |
|---|---|---|
| **Performance** | Problemas que afetam velocidade e uso de memoria | Corrigir antes de publicar |
| **DAX Expressions** | Padroes inadequados em expressoes DAX | Revisar e refatorar |
| **Error Prevention** | Riscos de erros no deploy/processamento | Corrigir obrigatorimente |
| **Formatting** | Formatacao e apresentacao dos dados | Corrigir para melhor UX |
| **Maintenance** | Limpeza e organizacao do modelo | Corrigir para manutenibilidade |
| **Naming Conventions** | Padroes de nomenclatura | Seguir convencoes do projeto |

### Passo 5: Priorizar correcoes

1. **Severidade 3 (alta)**: Corrigir imediatamente - causam erros ou problemas criticos
2. **Severidade 2 (media)**: Corrigir antes do deploy - afetam performance/qualidade
3. **Severidade 1 (baixa)**: Corrigir quando possivel - melhorias desejaveis

### Passo 6: Aplicar correcoes

Para cada violacao corrigivel:

1. Explicar o problema encontrado
2. Mostrar a correcao sugerida
3. Aplicar a correcao no arquivo TMDL/PBIR correspondente
4. Validar com `powerbi-report-author validate`

## Regras BPA incluidas

O arquivo `BPARules.json` contem **~70 regras** organizadas por categoria:

- **Performance** (~25 regras): Tipos de dados, relacionamentos, particoes, Power Query
- **DAX Expressions** (~15 regras): Qualificacao de colunas/medidas, DIVIDE, TREATAS
- **Error Prevention** (~10 regras): Caracteres invalidos, colunas sem fonte, RLS
- **Formatting** (~15 regras): Format strings, categorias de dados, chaves estrangeiras
- **Maintenance** (~10 regras): Colunas/medidas desnecessarias, integridade referencial
- **Naming Conventions** (~5 regras): Nomes de particoes, caracteres especiais, espacos

## Referencias

- **Repositorio Microsoft**: https://github.com/microsoft/Analysis-Services/tree/master/BestPracticeRules
- **Tabular Editor BPA docs**: https://docs.tabulareditor.com/features/using-bpa.html
- **Artigo SQLBI**: https://www.sqlbi.com/articles/best-practice-analyzer/
- **Blog CAT**: https://www.elegantbi.com/post/top10bestpractices

## Must

- Copiar BPARules.json para o diretorio correto do Tabular Editor antes de executar
- Classificar violacoes por severidade e categoria
- Priorizar correcoes: Severidade 3 > 2 > 1
- Explicar cada problema antes de corrigir
- Validar correcoes com powerbi-report-author

## Prefer

- Usar Tabular Editor 3 quando disponivel (experiencia superior)
- Agrupar violacoes por categoria no relatorio
- Sugerir fix scripts do BPA quando disponiveis
- Documentar decisoes de ignorar regras (com justificativa)

## Avoid

- Ignorar violacoes de severidade 3 sem justificativa
- Corrigir automaticamente sem explicar o problema
- Pular a validacao pos-correcao
- Modificar regras BPA sem necessidade
