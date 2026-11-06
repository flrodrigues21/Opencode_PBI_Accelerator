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

## Integracao Segura Com Desktop
1. Antes da primeira chamada ao Desktop ou Bridge para cada tarefa e alvo, pergunte: `Como você quer executar? 1. Acompanhar na tela — o Desktop pode abrir e mostrar as etapas. 2. Em background — você continua usando sua janela enquanto eu trabalho sem tomar o foco.`
2. Registre a escolha com `--task-id` e `--execution-mode attended|background`. Reuse o mesmo checkpoint nas retomadas; altere o modo apenas por pedido explicito. Sem escolha, faca somente inspecao offline.
3. Em background, aceite apenas operacoes classificadas `BACKGROUND_SAFE` ou `OFFLINE`. Nao contorne `FOCUS_POLICY_BLOCKED`; abertura, acao manual e comportamento desconhecido permanecem bloqueados.
4. Use `powerbi-desktop-safe.cmd` para abrir, resolver alvo, descobrir capacidades e capturar. Nao use `powerbi-desktop open` diretamente sob o timeout do host.
5. Verifique caminho normalizado, Desktop PID e Bridge antes de operar. O PID lancado e apenas candidato; nunca substitua o alvo pela primeira Bridge disponivel.
6. Trate `arquivo aberto`, `Bridge pronta`, `engine disponivel` e `MCP conectado` como estados independentes. A Bridge nao expoe engine/porta; nao invente essa evidencia.
7. Limite descoberta e selecao ao `SessionId` interativo informado pelo launcher. Ignore processos Desktop de outras sessoes; caminho, PID e sessao devem corresponder. Com varias instancias correspondentes na sessao atual, exija `--pid`.
8. Descubra capacidades uma vez por versao/PID e reuse o checkpoint. Save, Save As e exportacao PBIX/PBIP completa nao sao capacidades da Bridge 1.0.0; ExportTMDL nao e exportacao de relatorio.
9. Nao interprete timeout como prova de falha e nao repita `open` automaticamente. Resolva novamente o mesmo caminho.
10. Capture por pagina, serialmente, com prazo total e checkpoint. Uma chamada incerta coloca o PID em quarentena: nao repita a pagina nem execute outro comando de host ate o PID antigo terminar e o alvo ser resolvido explicitamente para um novo PID.
11. Captura representa a sessao Desktop. Se `diskAlignment=SESSION_DIFFERS_FROM_DISK`, nao afirme que a imagem representa o PBIP salvo em disco.
12. Para refresh ou Ctrl+S manual, use os checkpoints `request-refresh`/`request-save` e solicite a acao uma unica vez. Conclua com `resume --completed` somente apos confirmacao explicita.
13. Se apenas a captura falhar, bloqueie somente a validacao visual e continue tarefas offline independentes. Respeite qualquer ordem do host para interromper chamadas.
14. Nao automatize mouse, teclado ou foco; nao remonte pacote PBIX; nao use APIs privadas; nao encerre nem salve sessoes do usuario automaticamente.
15. Diagnosticos devem omitir tokens, credenciais, variaveis de ambiente e caminhos de relatorios alheios.
