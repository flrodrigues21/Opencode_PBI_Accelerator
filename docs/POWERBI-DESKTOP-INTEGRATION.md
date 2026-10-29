# Integracao segura com Power BI Desktop

## Causas verificadas

### Abertura reportada como falha

`@microsoft/powerbi-desktop-bridge-cli@1.0.0` executa `PBIDesktop.exe` com `detached: true`, descarta os streams do Desktop e chama `unref()`. Em seguida, o comando `open` permanece ativo por ate 60 segundos em `findBridge()`. Se o host do OpenCode tiver timeout menor, ele interrompe o PowerShell/Node que ainda aguarda e pode apresentar `ChildProcess.kill`, embora o Desktop ja tenha sido iniciado.

O erro nao e produzido pelo Modeling MCP. O adaptador evita a janela longa: registra o lancamento imediatamente, limita sua propria espera e retorna `OPENING` ou `TARGET_NOT_READY` como estado, sem interpretar a interrupcao como falha de abertura.

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

Abrir sem confundir timeout com falha:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" open "C:\Relatorios\Vendas.pbix" --wait-seconds 15
```

Resolver novamente sem abrir outra instancia:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resolve "C:\Relatorios\Vendas.pbix"
```

Descobrir capacidades uma vez para o PID correto:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" capabilities "C:\Relatorios\Vendas.pbip" --pid 1234
```

Capturar incrementalmente:

```powershell
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" capture-all "C:\Relatorios\Vendas.pbip" --pid 1234 --output-dir ".\screenshots" --total-seconds 20 --page-seconds 10
```

Registrar Save As manual e retomar:

```powershell
$result = & "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" save-as "C:\Relatorios\Origem.pbix" "C:\Relatorios\Copia\Vendas.pbip" | ConvertFrom-Json
# Execute apenas a acao manual informada em $result.manualAction.
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume $result.checkpointPath
# Para PBIX, forneca o PID explicito para confirmar caminho atual e hasUnsavedChanges=false:
& "$env:POWERBI_OPENCODE_ACCELERATOR\bin\powerbi-desktop-safe.cmd" resume $result.checkpointPath --pid 1234
```

Estados estruturados esperados (`TARGET_NOT_READY`, `AMBIGUOUS_TARGET`, `HOST_BUSY`, `HOST_STATE_UNKNOWN`, `PARTIAL_TIMEOUT` e `UNSUPPORTED_CAPABILITY`) usam codigo de processo zero para que o OpenCode nao os transforme em erro opaco; o chamador deve ler `ok` e `status`. Erros de comando, argumento, destino ou lancamento usam codigo diferente de zero. O worker de status registra seu `exitCode` no diagnostico quando e interrompido, e stdout/stderr do adaptador nao sao redirecionados para o Desktop.

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
- Quando `resume` recebe um PID explicito para PBIX, `READY_TO_RESUME` exige evidencia publica simultanea: `currentFilePath` igual ao destino e `hasUnsavedChanges=false`. Sem essa evidencia, o estado permanece `MANUAL_CONFIRMATION_PENDING`; o adaptador nao abre, salva ou encerra o Desktop.
- O adaptador nao salva, encerra, recarrega ou atualiza sessoes automaticamente.
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

O repositorio inclui `tests/Invoke-LiveDesktopValidation.ps1`. O script recusa executar se qualquer `PBIDesktop.exe` ja existir, abre o PBIP uma unica vez, confirma caminho/PID/Bridge, verifica que engine e MCP continuam separados, captura uma pagina com `--max-pages 1` e retoma somente as paginas pendentes. Ele nunca salva, recarrega, atualiza, encerra processos ou aceita uma Bridge alheia.

```powershell
& ".\tests\Invoke-LiveDesktopValidation.ps1" -ProjectPath "C:\caminho-descartavel\VendasDemo"
```

A conexao MCP permanece uma etapa explicita depois que o script provar que a sessao descartavel e a unica instancia Desktop. Registre engine/porta e nome do modelo retornados pelo Modeling MCP antes de qualquer escrita; se a identidade nao for inequivoca, pare.
