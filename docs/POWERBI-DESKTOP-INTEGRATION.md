# Integracao segura com Power BI Desktop

## Modos de execucao e foco

Antes da primeira chamada ao Desktop ou Bridge para uma tarefa e alvo, pergunte:

```text
Como você quer executar?
1. Acompanhar na tela — o Desktop pode abrir e mostrar as etapas.
2. Em background — você continua usando sua janela enquanto eu trabalho sem tomar o foco.
```

A primeira chamada recebe `--task-id <id> --execution-mode attended|background`. O adaptador persiste a escolha por tarefa e caminho em `%LOCALAPPDATA%\PowerBI-OpenCode-Accelerator\execution-mode`; retomadas passam apenas o mesmo `--task-id`. Informar outro `--execution-mode` altera explicitamente o checkpoint.

Sem escolha, o adaptador retorna `EXECUTION_MODE_REQUIRED` antes de carregar a Bridge. Em `background`, somente operacoes classificadas `BACKGROUND_SAFE` ou `OFFLINE` sao aceitas. `resolve`, `capabilities` e `capture-all` usam a Bridge sem automacao de janela; `open`, Save As e pedidos manuais de refresh/save retornam `FOCUS_POLICY_BLOCKED`. A policy tambem bloqueia qualquer futura operacao de host ainda nao classificada; um nome de comando inexistente na CLI retorna `COMMAND_FAILED`. O modo nao autoriza mouse, teclado, ativacao de janela ou APIs privadas.

O launcher detecta sua sessao interativa do Windows e passa `--session-id`. Descoberta, selecao por caminho/PID e validacao real aceitam apenas processos `PBIDesktop` com o mesmo `SessionId`; processos de outras sessoes sao ignorados e registrados apenas como diagnostico informativo. Se a sessao nao puder ser determinada, nenhuma operacao Desktop e tentada.

## Causas verificadas

### Abertura reportada como falha

`@microsoft/powerbi-desktop-bridge-cli@1.0.0` executa `PBIDesktop.exe` com `detached: true`, descarta os streams do Desktop e chama `unref()`. Em seguida, o comando `open` permanece ativo por ate 60 segundos em `findBridge()`. Se o host do OpenCode tiver timeout menor, ele interrompe o PowerShell/Node que ainda aguarda e pode apresentar `ChildProcess.kill`, embora o Desktop ja tenha sido iniciado.

O erro nao e produzido pelo Modeling MCP. O adaptador evita a janela longa: registra o lancamento imediatamente, limita sua propria espera e retorna `READY`, `OPENING` ou `TARGET_NOT_READY` como estado, sem interpretar a interrupcao como falha de abertura. Um wrapper de shell que acompanha toda a arvore GUI ainda pode exibir `ChildProcess.kill` depois de o processo Node terminar; nesse caso, use o JSON/stdout e o checkpoint do adaptador, confirme que nao restou processo Node e resolva o mesmo alvo em vez de repetir `open`.

### Instancia errada

Depois do lancamento, o `open` original chama `findBridge()` sem PID nem caminho. Uma unica Bridge ja existente satisfaz a busca, mesmo que pertenca a outro arquivo. O JSON pode, portanto, combinar `launchedProcessId` do novo processo com `pid` e manifesto de outro relatorio.

O adaptador faz preflight e correlaciona o caminho retornado por `application.state.get/v1` com o caminho solicitado. Para PBIP, tambem compara a pasta `.Report`. O PID lancado e apenas candidato. Nenhum match retorna `TARGET_NOT_READY`; varios matches retornam `AMBIGUOUS_TARGET`.

### Captura e timeout

O `screenshot-all` oficial e serial, mas e uma unica chamada longa para o host. O adaptador chama uma pagina por vez, mantem uma unica sessao Bridge, grava checkpoint antes e depois de cada pagina e usa lock por Desktop PID. O prazo total padrao e 20 segundos e inclui selecao, conexao e paginas.

A API nao fornece ID da operacao de screenshot nem cancelamento. Se uma pagina fica em voo alem do prazo, o adaptador fecha sua conexao, marca a pagina como `unknown`/`OPERATION_STATE_UNKNOWN`, mantem o PID em quarentena e nunca repete automaticamente essa pagina. Isso nao e apresentado como cancelamento do trabalho no Desktop. Chamadas novas para esse caminho/PID retornam `HOST_STATE_UNKNOWN` antes de consultar a Bridge. Depois que o usuario encerrar o PID antigo e resolver explicitamente o alvo para outro PID, somente paginas ainda `pending` podem continuar; paginas `completed` e `unknown` permanecem ignoradas.

Consultas de estado executam em um subprocesso limitado a cinco segundos. Se ele exceder o prazo, somente esse subprocesso de diagnostico e terminado; ele nunca lanca o Desktop. O adaptador retorna `STATUS_QUERY_TIMEOUT`, nao abre outra instancia e preserva no diagnostico o codigo de saida seguro do worker.

### Save As e exportacao

O manifesto observado expoe apenas:

- `application.state.get/v1`;
- `report.snapshot.capture/v1`;
- `file.reload/v1`.

Nao ha Save ou Save As. A documentacao oficial de PBIP afirma explicitamente que PBIX para PBIP e PBIP para PBIX so podem ser convertidos em `File > Save as` no Power BI Desktop, nao programaticamente. O Modeling MCP faz operacoes de modelo e pode exportar TMDL/TMSL; isso nao inclui paginas, visuais, recursos e o projeto PBIP completo. O checkpoint exige um destino inicialmente inexistente; a retomada de PBIP valida o JSON, a referencia relativa e `definition.pbir`, e a retomada de PBIX exige um arquivo nao vazio que nao esteja sendo gravado naquele instante.

Referencias:

- <https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview#frequently-asked-questions>
- <https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-external-editing>
- <https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-external-tools>
- README instalado de `@microsoft/powerbi-desktop-bridge-cli@1.0.0`.

## Comandos

### Edicao PBIR em lote com o Desktop aberto

Antes da primeira escrita no PBIR, registre se o alvo esta aberto sem abrir outra instancia:

```powershell
$edit = & "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" prepare-pbir-edit "C:\Relatorios\Vendas.pbip" --task-id "revisao-vendas" --execution-mode attended | ConvertFrom-Json
```

- `PBIR_EDIT_OFFLINE_READY`: o alvo nao foi observado na sessao interativa atual. Conclua e valide todo o lote em disco antes de abrir o Desktop. Se o resultado incluir `CROSS_SESSION_INSTANCES_IGNORED`, confirme primeiro que nenhuma outra sessao do Windows possui esse projeto aberto.
- `PBIR_EDIT_TARGET_OPEN`: o alvo exato ja esta aberto; um unico aviso externo pode precisar ser aplicado depois do lote.
- `PBIR_EDIT_STATE_UNKNOWN`: a Bridge nao conseguiu provar se o alvo esta aberto. Nao presuma que esta fechado.

Somente uma tarefa pode manter um lote PBIR ativo por alvo. Outra `task-id` recebe `PBIR_EDIT_OWNED_BY_ANOTHER_TASK` e nao pode escrever ou substituir esse lote. A propriedade continua durante `READY_TO_TEST` e termina somente com `complete-pbir-review --tested`. Use `--new-batch` apenas para abandonar e substituir uma revisao ainda pertencente a mesma tarefa.

Nao solicite confirmacao a cada arquivo. Depois de concluir as escritas e executar a validacao PBIR, marque o mesmo lote como validado:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" complete-pbir-edit $edit.checkpointPath --task-id "revisao-vendas" --validated
```

Sem `--validated`, o estado permanece `BATCH_VALIDATION_REQUIRED`. Uma preparacao repetida reutiliza o lote ativo sem consultar o Desktop novamente. `--new-batch` cria um checkpoint distinto e troca atomicamente o ponteiro de propriedade do alvo. O status auxiliar do checkpoint anterior e atualizado para `SUPERSEDED` quando possivel; mesmo se essa gravacao falhar, o ponteiro autoritativo faz comandos atrasados retornarem `BATCH_SUPERSEDED` com o caminho atual, sem alterar o lote novo.

Classifique o aviso sem inferir seu tipo a partir de `hasUnsavedChanges`:

```powershell
# Somente depois de confirmar visualmente o aviso de alteracoes externas:
$review = & "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" request-pbir-review $edit.checkpointPath --task-id "revisao-vendas" --notice-type external --notice-confirmed | ConvertFrom-Json

# Alternativas separadas:
# --notice-type power-query
# --notice-type session-unsaved --session-changes-need-save
# --notice-type unknown
# --notice-type none
```

`hasUnsavedChanges=true` indica apenas trabalho nao salvo na sessao. Ele nao confirma aviso externo nem pendencia do Power Query. `session-unsaved` so pede `Ctrl+S` quando `--session-changes-need-save` declara que ha trabalho novo que precisa ser persistido. `unknown` informa que o tipo nao foi identificado e nao emite instrucao de Apply ou `Ctrl+S`. `none` retorna `TARGET_CONFIRMATION_REQUIRED`; retome com o PID resolvido para confirmar o alvo antes do teste. Em background, `request-pbir-review` retorna `FOCUS_POLICY_BLOCKED` e nao tenta resolver o aviso tomando o foco.

Para o aviso externo confirmado, a unica orientacao emitida inclui o caminho, a janela do projeto, o motivo e a acao **Confirmar e aplicar**. Repetir o pedido para o mesmo lote retorna o checkpoint pendente sem repetir a orientacao.

Depois que o operador concluir a acao exata, retome uma vez com o PID ja resolvido:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume-pbir-review $edit.checkpointPath --task-id "revisao-vendas" --completed --pid 1234
```

A retomada grava a tentativa antes de consultar a Bridge, relê o alvo uma unica vez e nunca executa reload. Um aviso externo concluido ou `none` confirmado retorna `READY_TO_TEST`; Power Query ou save da sessao retorna a `BATCH_VALIDATED` para que um aviso externo ainda pendente possa ser classificado. Repetir a mesma retomada nao relê o alvo e nao pede `Ctrl+S` por reflexo.

Depois de confirmar visualmente a revisao, os dados e as interacoes sem outro aviso, conclua a revisao e libere a propriedade do alvo:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" complete-pbir-review $edit.checkpointPath --task-id "revisao-vendas" --tested
```

Sem `--tested`, o comando retorna `INTERACTION_VALIDATION_REQUIRED`. Um checkpoint `COMPLETE` nao bloqueia uma tarefa posterior.

Todas as continuacoes PBIR exigem explicitamente a mesma `--task-id`; possuir apenas o caminho do checkpoint nao concede a propriedade da tarefa.

Um processo encerrado durante uma transicao pode deixar `PBIR_EDIT_STALE_LOCK`. O resultado informa `lockPath` e `staleOwnerPid`. Confirme no sistema operacional que esse PID nao existe e que nenhum processo do Accelerator usa o alvo; somente depois remova exatamente o arquivo indicado em `lockPath` e repita o comando. O adaptador nunca remove esse lock automaticamente, evitando uma corrida com um novo proprietario.

Se essa leitura falhar ou usar um PID incorreto, a retomada grava `TARGET_READ_FAILED` ou `TARGET_NOT_READY` e nao tenta novamente automaticamente. Depois de corrigir a Bridge ou o PID, permita uma unica nova leitura de recuperacao explicitamente:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume-pbir-review $edit.checkpointPath --task-id "revisao-vendas" --completed --pid 1234 --retry-target-read
```

Abrir sem confundir timeout com falha:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" open "C:\Relatorios\Vendas.pbip" --task-id "revisao-vendas" --execution-mode attended --wait-seconds 15
```

Resolver novamente sem abrir outra instancia:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resolve "C:\Relatorios\Vendas.pbip" --task-id "revisao-vendas"
```

Descobrir capacidades uma vez para o PID correto:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" capabilities "C:\Relatorios\Vendas.pbip" --task-id "revisao-vendas" --pid 1234
```

Capturar incrementalmente:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" capture-all "C:\Relatorios\Vendas.pbip" --task-id "revisao-vendas" --pid 1234 --output-dir ".\screenshots" --total-seconds 20 --page-seconds 10
```

Registrar Save As manual e retomar:

```powershell
$result = & "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" save-as "C:\Relatorios\Origem.pbix" "C:\Relatorios\Copia\Vendas.pbip" --task-id "conversao-vendas" --execution-mode attended | ConvertFrom-Json
# Execute apenas a acao manual informada em $result.manualAction.
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume $result.checkpointPath
# Para PBIX, escolha o modo do novo alvo e forneca o PID explicito:
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume $result.checkpointPath --pid 1234 --task-id "conversao-vendas" --execution-mode attended
```

Solicitar uma unica intervencao manual e retomar sem repetir o pedido:

```powershell
$refresh = & "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" request-refresh "C:\Relatorios\Vendas.pbip" --task-id "revisao-vendas" | ConvertFrom-Json
# Somente depois de o usuario confirmar que concluiu:
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume $refresh.checkpointPath --completed
```

`request-save` usa o mesmo fluxo e solicita Ctrl+S uma unica vez. Ambos sao bloqueados em background.

Estados estruturados esperados (`EXECUTION_MODE_REQUIRED`, `FOCUS_POLICY_BLOCKED`, `TARGET_NOT_READY`, `AMBIGUOUS_TARGET`, `HOST_BUSY`, `HOST_STATE_UNKNOWN`, `PARTIAL_TIMEOUT` e `UNSUPPORTED_CAPABILITY`) usam codigo de processo zero para que o OpenCode nao os transforme em erro opaco; o chamador deve ler `ok` e `status`. Erros de comando, argumento, destino ou lancamento usam codigo diferente de zero. O worker de status registra seu `exitCode` no diagnostico quando e interrompido, e stdout/stderr do adaptador nao sao redirecionados para o Desktop.

## Retornos resumidos

Alvo pronto:

```json
{
  "ok": true,
  "status": "READY",
  "desktop": { "status": "FILE_OPEN", "pid": 1234 },
  "bridge": { "status": "CONNECTED", "pid": 1234 },
  "engine": { "status": "NOT_EXPOSED", "code": "UNSUPPORTED_CAPABILITY" },
  "mcp": { "status": "NOT_CHECKED" }
}
```

Lancamento ainda nao confirmado:

```json
{
  "ok": false,
  "status": "TARGET_NOT_READY",
  "launch": { "launchedProcessId": 5678, "pidIsCandidateOnly": true },
  "action": "Run resolve for this target; do not repeat open automatically."
}
```

Captura interrompida com resultado parcial:

```json
{
  "ok": false,
  "status": "PARTIAL_TIMEOUT",
  "progress": { "completed": 2, "total": 5 },
  "operationStateUnknown": true,
  "offlineWorkCanContinue": true
}
```

## Limites

- A Bridge identifica inequivocamente caminho, Desktop PID e conexao Bridge.
- A Bridge nao expoe engine/porta do Analysis Services. O adaptador nao usa descoberta interna nao documentada.
- O Modeling MCP documenta descoberta por nome do arquivo, nao um handoff por Desktop PID. Antes de alteracoes, o agente deve verificar a identidade retornada pelo MCP; com varias instancias sem identidade inequivoca, deve parar.
- Para PBIX, o adaptador pode provar apenas que um arquivo nao vazio apareceu; como a inspecao interna do pacote e proibida, retorna `DESTINATION_APPEARED` e exige confirmacao manual de que o Save terminou antes de novas operacoes de host. Para PBIP, valida os arquivos publicos do projeto e pode retornar `READY_TO_RESUME`.
- Quando `resume` recebe um PID explicito para PBIX, o destino e tratado como novo alvo e exige escolha propria ou checkpoint de modo ja existente. `READY_TO_RESUME` exige evidencia publica simultanea: `currentFilePath` igual ao destino e `hasUnsavedChanges=false`. Sem essa evidencia, o estado permanece `MANUAL_CONFIRMATION_PENDING`; o adaptador nao abre, salva ou encerra o Desktop.
- O adaptador nao salva, encerra, recarrega ou atualiza sessoes automaticamente.
- Capturas sempre representam a sessao Desktop. Cada item em `captures[]` preserva sua propria `sourceEvidence`; `diskAlignment=SESSION_DIFFERS_FROM_DISK` indica que aquela imagem nao comprova o conteudo do PBIP em disco. O agregado retorna `MIXED` quando uma retomada combina estados diferentes.
- `capture-all` e classificado como background-safe porque usa somente a Bridge e nao contem chamada de ativacao de janela. A verificacao empirica de foco depende do roteiro real e permanece pendente quando ja existe outra instancia Desktop.
- Falha visual nao invalida testes de arquivo independentes.

## Atualizacao e rollback

Instale ou atualize pelo fluxo transacional existente:

```powershell
& ".\Install-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

Reinicie o OpenCode para que a nova skill e as instrucoes sejam descobertas. Projetos com `AGENTS.md` existente continuam preservados; incorpore manualmente as regras de alvo seguro se desejar aplica-las ali.

Para rollback, use o comando impresso pelo instalador ou o backup mais recente:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\Restore-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

Os checkpoints ficam em `%LOCALAPPDATA%\PowerBI-OpenCode-Accelerator` e nao contem tokens. Eles podem ser mantidos durante rollback para diagnostico ou removidos manualmente quando nao houver operacao pendente.

## Validacao real descartavel

O repositorio inclui `tests/Invoke-LiveDesktopValidation.ps1`. O script recusa executar se qualquer `PBIDesktop.exe` ja existir na sessao interativa atual, ignora processos de outras sessoes, abre o PBIP uma unica vez em modo acompanhado, confirma caminho/PID/Bridge, muda explicitamente o checkpoint para background e pede que o operador mantenha o terminal em primeiro plano. Ele compara a janela em foco antes e depois da captura incremental. O script nunca salva, recarrega, atualiza, encerra processos, ativa janelas ou aceita uma Bridge alheia.

```powershell
& ".\tests\Invoke-LiveDesktopValidation.ps1" -ProjectPath "C:\caminho-descartavel\VendasDemo"
```

A conexao MCP permanece uma etapa explicita depois que o script provar que a sessao descartavel e a unica instancia Desktop. Registre engine/porta e nome do modelo retornados pelo Modeling MCP antes de qualquer escrita; se a identidade nao for inequivoca, pare.
