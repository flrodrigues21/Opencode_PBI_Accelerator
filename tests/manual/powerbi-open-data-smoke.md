# Smoke manual: Power BI com dados publicos

Use este roteiro para validar uma branch do Accelerator em uma instalacao descartavel. Substitua os valores entre `<...>` e nao reutilize projetos ou estados de producao.

## Pre-requisitos

- Windows com Power BI Desktop e OpenCode disponiveis.
- Branch sob teste em worktree conhecido.
- Diretorio temporario fora do repositorio para instalacao, dados, PBIPs, screenshots e checkpoints.
- Nenhum `PBIDesktop` aberto na sessao interativa atual. Processos de outras sessoes devem ser ignorados, nunca encerrados.
- Uma segunda aplicacao visivel para observar preservacao de foco.

## Prompt reutilizavel

```text
Instale a branch atual do Power BI OpenCode Accelerator em <INSTALL_ROOT_TEMPORARIO>, sem alterar instalacoes globais. Confirme por SHA-256 que launcher, adapter, biblioteca e skill instalados correspondem ao worktree.

Escolha um conjunto oficial de dados publicos, estruturado, recente e pequeno o bastante para repetir o teste. Registre pagina oficial, recurso direto, data de extracao, licenca quando disponivel, esquema, grao e regra de recorte. Baixe e transforme tudo fora do repositorio. Antes de montar o dashboard, verifique duplicatas e conflitos no grao; nao some linhas ambiguas. Calcule pelo menos dois totais de referencia por um segundo caminho independente do transformador principal.

Crie duas copias independentes de um PBIP descartavel, uma para Background e outra para Acompanhado. Monte um dashboard simples com titulo, indicador, evolucao temporal, comparacao por categoria ou geografia e filtros. Valide JSON/PBIR e TMDL offline antes de abrir o Desktop.

Teste Background primeiro. Entre pelo launcher normal sem informar modo na chamada, confirme que ele oferece Acompanhado e Background e escolha Background. Mantenha outra aplicacao em primeiro plano e amostre GetForegroundWindow durante todo o trabalho. Confirme que open, refresh, save e Save As sao bloqueados antes de chamadas ao Desktop; valide separadamente que uma futura operacao de host sem classificacao e bloqueada pela policy. Um nome de comando inexistente deve falhar com COMMAND_FAILED. Consultas e capturas classificadas como background-safe nao podem mudar o foco. Confirme que nenhum PBIDesktop foi criado na sessao atual.

Teste Acompanhado depois, em projeto equivalente e limpo. Entre novamente pelo launcher sem informar modo e escolha Acompanhado. Observe a abertura e renderizacao. Resolva o alvo somente quando caminho normalizado, PID e SessionId coincidirem. Se houver processos em outras sessoes, registre que foram ignorados. Use a Bridge publica para conferir capacidades e capturar cada pagina.

Quando refresh ou Ctrl+S forem necessarios, use request-refresh ou request-save. Repita a solicitacao antes da acao para provar que o checkpoint nao pede a mesma intervencao duas vezes. Solicite ao operador uma unica acao objetiva, espere confirmacao explicita e somente entao execute resume --completed. Capture antes e depois para distinguir sessao nao salva de PBIP salvo.

Teste filtros simples e compare o resultado visual com os totais independentes. Para validar retomada incremental, interrompa apos uma unidade concluida, por exemplo uma pagina com --max-pages 1, e retome apenas as pendentes; confirme no checkpoint que a unidade concluida nao foi repetida. Se o relatorio tiver uma unica pagina, use os checkpoints manuais de refresh/save como caso de interrupcao e retomada sem repeticao.

Alterne explicitamente Acompanhado para Background no alvo ja aberto. Com outra aplicacao em primeiro plano, execute resolve, capabilities e capture-all e confirme foco preservado; request-save e request-refresh devem continuar bloqueados.

Rode os testes focados do adapter, a suite transacional, checks de sintaxe e validadores offline. Revise git status e diff. Nao adicione ao Git downloads, PBIPs, caches, checkpoints, screenshots, credenciais ou caminhos absolutos locais. Registre somente este roteiro e correcoes de produto ou testes justificadas por falhas reproduzidas. Nao faca commit, push, PR ou publicacao.

Ao final, relate: fonte e recorte; totais independentes; evidencias Background/Acompanhado; foco; caminho/PID/SessionId; checkpoints e retomada; arquivos salvos; testes; falhas encontradas e correcoes; artefatos temporarios deixados fora do Git.
```

## Criterios de aprovacao

- Instalacao temporaria corresponde ao worktree e nao altera escopo global.
- Background nao abre ou ativa Desktop nem automatiza mouse ou teclado.
- Acompanhado abre somente o alvo descartavel da sessao atual.
- Caminho, PID, `SessionId` e Bridge identificam o mesmo alvo.
- Dashboard renderiza, filtros respondem e numeros batem com duas verificacoes independentes.
- Refresh/save manual e retomada nao duplicam a acao concluida.
- Capturas declaram corretamente `REPORTED_SAVED` ou `SESSION_DIFFERS_FROM_DISK`.
- Suites automatizadas e validacoes offline passam.
- Somente roteiro e correcoes justificadas aparecem no diff; artefatos do smoke ficam fora do Git.
