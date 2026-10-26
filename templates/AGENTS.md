# Power BI PBIP + OpenCode (modo local)

## Escopo
- Trabalhe exclusivamente nos arquivos locais PBIP, PBIR e TMDL deste projeto.
- Nao use Power BI Service, Fabric, OAuth, APIs remotas ou publicacao.
- Nao solicite, grave ou utilize credenciais do cliente.
- Nao altere fontes, credenciais, parametros, medidas ou RLS sem pedido explicito.

## Regras
1. Use `powerbi-report-cli` para planejar, desenhar, editar e validar relatorios locais.
2. Use `semantic-model-authoring` apenas para trabalho local em TMDL, DAX e modelos sem acesso a nuvem.
3. Antes de editar PBIR, explique um plano e aguarde aprovacao, exceto se a implementacao imediata for solicitada.
4. Inspecione os arquivos locais antes de criar bindings. Nunca invente tabelas, colunas, medidas ou propriedades PBIR.
5. Depois de cada lote de mudancas, execute `powerbi-report-author validate <pasta-.Report>`.
6. Reload e screenshot com `powerbi-desktop` somente quando solicitados; nunca atualize dados automaticamente.
7. O modeling MCP e opt-in e local. Nao presuma que esta habilitado ou conectado.
8. Nao altere RLS, relacionamentos ou medidas criticas sem explicar impacto e rollback.
9. Nao atualize manualmente a versao `$schema`.
