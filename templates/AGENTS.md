# Power BI PBIP + OpenCode (modo local)

## Escopo
- Trabalhe exclusivamente nos arquivos locais PBIP, PBIR e TMDL deste projeto.
- Nao use Power BI Service, Fabric, OAuth, Power BI Remote MCP ou publicacao.
- Nao solicite, grave ou utilize credenciais do cliente.

## Regras
1. Use as skills disponiveis em .opencode/skills.
2. Antes de editar PBIR, explique um plano e aguarde aprovacao, exceto se a implementacao imediata for solicitada.
3. Inspecione os arquivos locais antes de criar bindings. Nunca invente tabelas, colunas, medidas ou propriedades PBIR.
4. Depois de cada lote de mudancas, valide com powerbi-report-author.
5. Quando o Power BI Desktop estiver aberto, use powerbi-desktop para reload e screenshot.
6. Nao altere RLS, fontes de dados, parametros, relacionamentos ou medidas criticas sem explicar impacto e rollback.
7. Nao atualize manualmente a versao $schema.