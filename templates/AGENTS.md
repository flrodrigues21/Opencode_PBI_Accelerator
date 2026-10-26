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
6. Reload, refresh e screenshot com `powerbi-desktop` somente ao final de um lote e quando forem necessarios; nunca atualize dados repetidamente durante a edicao.
7. O modeling MCP e opt-in e local. Nao presuma que esta habilitado ou conectado.
8. Nao altere RLS, relacionamentos ou medidas criticas sem explicar impacto e rollback.
9. Nao atualize manualmente a versao `$schema`.

## Execucao Backend Primeiro
1. Priorize arquivos, scripts, CLIs, APIs locais e consultas programaticas para criar, inspecionar e validar PBIP, PBIR e TMDL. Use MCP somente quando houver beneficio concreto e sempre com timeout explicito.
2. Reserve a interface grafica para etapas que realmente dependam dela, como abrir o projeto no Desktop e conferir a renderizacao final. Evite cliques repetidos em Atualizar, Aplicar, dialogos ou menus quando existir alternativa programatica suportada.
3. Nao traga janelas para frente, mova o mouse, digite na interface ou capture a tela durante etapas resolviveis pelo terminal. Antes de uma etapa grafica necessaria, avise brevemente e concentre as acoes em um unico lote curto.
4. Agrupe mudancas e valide os arquivos antes de executar uma unica atualizacao final, quando necessaria. Nao recarregue um Desktop com alteracoes nao salvas sem preserva-las.
5. Mostre progresso relevante no terminal com mensagens no formato `[ETAPA x/y]`, `[OK]`, `[AVISO]` e `[PROXIMO]`. Durante operacoes demoradas, informe apenas progresso sustentado por evidencia; nao invente percentuais nem repita mensagens sem informacao nova.
6. Execute comandos externos com timeout explicito e faca no maximo uma nova tentativa quando houver motivo verificavel. Se bridge ou MCP nao conectar, registre a falha e continue pelas verificacoes de arquivos; nao entre em ciclos de conexao, clique, atualizacao e nova tentativa.
7. Nao encerre o Power BI Desktop nem processos existentes para destravar automacao. Em caso de dialogo bloqueante ou necessidade de interacao humana, conclua as etapas independentes e informe a acao manual minima.
8. Diferencie explicitamente `arquivos gerados`, `estrutura e referencias validadas`, `modelo carregado e consultas executadas` e `resultado visual conferido`. Evidencia de uma etapa nao comprova as demais.
