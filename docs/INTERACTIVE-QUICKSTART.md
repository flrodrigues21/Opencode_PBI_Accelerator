# Do zero ao primeiro resultado

[**Português**](INTERACTIVE-QUICKSTART.md) | [English](INTERACTIVE-QUICKSTART.en.md) | [Voltar para a home](../README.md)

Este guia mostra como instalar o Accelerator, confirmar a instalação e usar os mesmos arquivos e CLIs com diferentes assistentes. Os caminhos são exemplos e devem ser substituídos.

1. [Preparar o ambiente](#requirements)
2. [Instalar e confirmar](#install-and-confirm)
3. [Escolher o modo de execução](#execution-modes)
4. [Abrir no cliente escolhido](#client-tracks)
5. [Saber quando o Desktop é necessário](#desktop-boundary)

<a id="requirements"></a>
## 1. Preparar o ambiente

### Requisitos

| Componente | Requisito mínimo ou escopo | Versão testada |
|---|---|---|
| Windows | PowerShell 5.1 e suporte a junctions | Windows 11, build `26100` |
| Windows PowerShell | `5.1+` | `5.1.26100.33648` |
| Git for Windows | Obrigatório | `2.55.0.windows.3` |
| Node.js | `20+` | `24.15.0` |
| npm | Incluído com o Node.js | `11.12.1` |
| OpenCode | Obrigatório para a integração principal | `1.19.4` |
| Power BI Desktop | Opcional para arquivos; obrigatório para Bridge e validação visual | `2.159.883.0 (26.10)` |
| Tabular Editor | Opcional, somente para BPA | Não exercitado no smoke |

Instalação e atualização precisam de rede para Git e npm. Azure CLI, login Azure, Fabric, Power BI Service, gateway e credenciais de cliente não são necessários no fluxo local por arquivos. O provedor LLM escolhido pode exigir rede separadamente.

O instalador fixa estas dependências:

| Componente | Versão |
|---|---|
| `microsoft/skills-for-fabric` | `v0.3.19`, SHA `bc42aaf734771bf752c1d7082dd91e5a6ca72b9f` |
| `@microsoft/powerbi-report-authoring-cli` | `0.5.0` |
| `@microsoft/powerbi-desktop-bridge-cli` | `1.0.0` |
| `@microsoft/powerbi-modeling-mcp` | `1.0.0` |

<a id="install-and-confirm"></a>
## 2. Instalar e confirmar

### Clonar e instalar

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git `
  "C:\Ferramentas\Opencode_PBI_Accelerator"
Set-Location "C:\Ferramentas\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass

& ".\Install-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

O instalador:

- verifica Git, Node.js 20+, npm e OpenCode;
- valida a fonte Microsoft no commit fixado;
- executa `npm ci` em staging;
- cria inventário e backup antes de aplicar;
- instala skills, comandos, templates e CLIs sob `InstallRoot`;
- faz rollback automático se a aplicação falhar.

Ele não instala Power BI Desktop, Claude Code, Codex, VS Code nem extensões de editor.

### Preparar uma pasta de trabalho

Use uma pasta diferente do clone para evitar gerar junctions, atalhos e demos dentro do repositório-fonte.

```powershell
New-Item -ItemType Directory -Path "C:\Projetos\PowerBI-Primeiro-Resultado" -Force | Out-Null

& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado" `
  -InitializeOnly
```

O launcher cria ou preserva:

- junctions `.opencode\skills` e `.opencode\common` para a instalação;
- `.opencode\commands\demo-powerbi.md`, sem substituir comando existente;
- `AGENTS.md`, apenas quando ausente;
- `Abrir-PowerBI-OpenCode.ps1` e `.cmd`, apenas quando ausentes.

Um `AGENTS.md` existente é preservado, não mesclado. Diretórios locais conflitantes de skills/common exigem `-Force` e são movidos para backup.

### Confirmar a instalação

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado"
```

O diagnóstico verifica inventário, skills, dependências Markdown, versões npm, sintaxe PowerShell e arquivos PBIP/PBIR/TMDL encontrados. Sem `-TestBridge`, ele não abre nem consulta o Desktop e termina informando que a validação visual não foi executada.

### Criar a primeira demo

Inicie o OpenCode na pasta preparada:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado"
```

Cole na conversa:

```text
/demo-powerbi
```

O comando cria `VendasDemo-Demo`, valida estrutura, referências, TMDL, totais e PBIR quando o CLI está disponível. Não abre o Desktop, não executa refresh e não substitui um destino existente.

Valide novamente apontando para a cópia:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado\VendasDemo-Demo"
```

<a id="execution-modes"></a>
## 3. Escolher o modo de execução

Ao usar `-OpenDesktop` sem `-ExecutionMode`, o launcher pergunta:

```text
Como você quer executar?
1. Acompanhar na tela — o Desktop pode abrir e mostrar as etapas.
2. Em background — você continua usando sua janela enquanto eu trabalho sem tomar o foco.
```

| Operação | Acompanhar na tela | Background |
|---|---:|---:|
| Analisar PBIP/PBIR/TMDL por arquivos | Sim | Sim |
| Abrir um PBIP | Sim | Bloqueado |
| Consultar/capturar alvo já aberto pela Bridge | Sim | Sim |
| Refresh, `Ctrl+S` ou Save As | Intervenção manual | Bloqueado |
| Mouse, teclado, diálogo ou ativação de janela | Não automatizado | Não automatizado |

Para escolher sem prompt:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado\VendasDemo-Demo" `
  -OpenDesktop `
  -ExecutionMode attended `
  -ExecutionTaskId "primeira-demo"
```

Trocar `attended` por `background` registra o modo e inicia o OpenCode, mas não abre nem ativa o Desktop. Em modo acompanhado, refresh, save e Save As usam checkpoints e continuam manuais; em Background, esses pedidos são bloqueados em vez de tomar o foco.

<a id="client-tracks"></a>
## 4. Abrir no cliente escolhido

### OpenCode: integração principal

**Onde abrir o projeto:** use `-ProjectPath` no launcher.

**Onde colar o prompt:** na conversa aberta pelo OpenCode.

**Como apontar para o Accelerator:** o launcher usa a instalação em `C:\OpenCode\PowerBI-Accelerator`; no prompt, informe o clone `C:\Ferramentas\Opencode_PBI_Accelerator` quando quiser que o agente leia a documentação-fonte.

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\Vendas"
```

Suporte nativo do projeto: descoberta de skills por `.opencode`, template `AGENTS.md`, `/demo-powerbi`, variáveis do launcher e CLIs instalados. A cobertura automatizada valida o empacotamento e o launcher; a resposta final ainda depende do modelo/provedor usado.

#### Modeling MCP opcional, somente nesta trilha

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\Vendas" `
  -EnableModelingMcp
```

O launcher cria uma configuração OpenCode temporária para `@microsoft/powerbi-modeling-mcp@1.0.0` e a remove ao sair. A geração e resolução da configuração são testadas com fixtures; conexão real, identidade do modelo e escrita por MCP não foram comprovadas pelo teste live. Use somente com o Desktop/modelo correto aberto e confirme a identidade antes de escrever.

### Claude Code: leitura de instruções e CLI, não testado

**Onde abrir o projeto:** em um terminal na pasta do projeto.

**Onde colar o prompt:** na sessão iniciada pelo comando `claude`.

```powershell
Set-Location "C:\Projetos\Vendas"
claude
```

No prompt, informe o clone e peça a leitura de `README.md`, `templates\AGENTS.md`, de `C:\OpenCode\PowerBI-Accelerator\skills\<skill>\SKILL.md` e de `docs\POWERBI-DESKTOP-INTEGRATION.md`. Os CLIs instalados ficam em `C:\OpenCode\PowerBI-Accelerator\node\node_modules\.bin`; use caminhos completos porque o launcher só os adiciona ao `PATH` do OpenCode. O instalador não cria `.claude`, não instala plugin Claude e não fornece `/demo-powerbi` nesse cliente. Esta trilha não foi testada; prefira análise por arquivos e invoque explicitamente os CLIs quando necessário.

### Codex CLI: leitura de instruções e CLI, não testado

**Onde abrir o projeto:** em um terminal na pasta do projeto.

**Onde colar o prompt:** na sessão iniciada pelo comando `codex`.

```powershell
Set-Location "C:\Projetos\Vendas"
codex
```

No prompt, informe o clone e os mesmos arquivos de instrução, incluindo a skill instalada em `C:\OpenCode\PowerBI-Accelerator\skills`. Os CLIs ficam em `C:\OpenCode\PowerBI-Accelerator\node\node_modules\.bin` e devem ser chamados pelo caminho completo. O Accelerator não cria configuração `.codex`, não instala skills no Codex e não fornece `/demo-powerbi`. Esta trilha não foi testada; use os arquivos como contexto e os scripts/CLIs como ferramentas explícitas.

### VS Code: o assistente escolhido executa o prompt, não o editor

**Onde abrir o projeto:** na pasta-alvo.

```powershell
code "C:\Projetos\Vendas"
```

**Onde colar o prompt:** no painel de chat da extensão assistente instalada. Por exemplo, se você usa **GitHub Copilot Chat**, é essa extensão que recebe e executa o prompt; o VS Code sozinho não executa prompts.

Inclua o caminho do clone e de `C:\OpenCode\PowerBI-Accelerator\skills` no prompt e peça leitura explícita das instruções. O instalador não configura VS Code, Copilot ou outro assistente. Nenhuma extensão do VS Code foi testada com o Accelerator; se o assistente não puder executar comandos, faça a análise por arquivos e rode pelo caminho completo os CLIs de `C:\OpenCode\PowerBI-Accelerator\node\node_modules\.bin` em um terminal separado.

### Alternativa comum por arquivos e CLI

Independentemente do cliente, a validação instalada pode ser executada diretamente:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\Vendas"
```

Isso não transforma outros clientes em integrações nativas; apenas fornece uma evidência reproduzível por arquivos.

<a id="desktop-boundary"></a>
## 5. Saber quando o Desktop é necessário

### Pode seguir sem Desktop

- instalar, atualizar e restaurar o Accelerator;
- preparar um projeto e criar a demo;
- inspecionar PBIP, PBIR, TMDL, DAX, Power Query M e referências relativas;
- executar o diagnóstico padrão e a validação PBIR;
- propor páginas, medidas e documentação em uma cópia separada;
- registrar checkpoints e trabalhar em modo background por arquivos.

### Exige Desktop ou uma sessão já aberta

- abrir o PBIP no modo acompanhado;
- obter evidência Bridge de caminho, PID, sessão ou páginas;
- capturar e conferir renderização;
- executar refresh, `Ctrl+S` ou Save As manualmente;
- conectar o Modeling MCP a um modelo local real.

Background não elimina essa dependência: consultas Bridge em background exigem que o relatório correto já esteja aberto.

## Atualização e rollback

Execute novamente o instalador para atualizar. Backups ficam em `<InstallRoot>\backups`. Para restaurar o backup válido mais recente:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\Restore-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

## Próximos passos

- Copie um dos [prompts da home](../README.md#validate-existing-pbip).
- Consulte [Integração segura com Power BI Desktop](POWERBI-DESKTOP-INTEGRATION.md) antes de usar Bridge, capturas ou checkpoints.
- Veja a [VendasDemo](../examples/VendasDemo/README.md) para estrutura e totais esperados.
- Use o [roteiro de dados públicos](../tests/manual/powerbi-open-data-smoke.md) apenas em cópias descartáveis.
