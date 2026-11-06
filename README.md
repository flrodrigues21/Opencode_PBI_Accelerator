# Power BI + OpenCode Accelerator

[**Português**](README.md) | [English](README.en.md)

O Accelerator prepara o OpenCode para criar, validar e operar projetos Power BI PBIP/PBIR/TMDL locais com segurança, voltado a analistas e desenvolvedores de BI que querem combinar automação por arquivos com intervenções controladas no Desktop.

> Projeto não oficial, sem afiliação ou endosso da Microsoft, OpenCode ou Anomaly. Consulte os [avisos de terceiros](THIRD_PARTY_NOTICES.md).

## Início rápido

No Windows PowerShell:

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git
Set-Location ".\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass

& ".\Install-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"

& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath (Get-Location).Path
```

No OpenCode, crie a primeira cópia independente da demo:

```text
/demo-powerbi
```

O destino padrão é `VendasDemo-Demo`; uma pasta existente nunca é sobrescrita. Para preparar o projeto gerado e escolher como abrir o Desktop:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath ".\VendasDemo-Demo" `
  -OpenDesktop
```

O launcher pergunta se a tarefa deve ser executada acompanhada ou em background. A demo contém dados fictícios autocontidos e totais verificáveis; veja a [documentação da VendasDemo](examples/VendasDemo/README.md).

## Modos de execução

| Modo | Quando usar | O que funciona | Intervenção do usuário |
|---|---|---|---|
| **Acompanhar na tela** | Abertura inicial, refresh, salvamento ou inspeção visual | Abre o PBIP, resolve caminho/PID/sessão e permite consultas e capturas pela Bridge | Refresh, `Ctrl+S` e Save As continuam manuais e são pedidos somente quando necessários |
| **Background** | Validação por arquivos e consultas seguras enquanto você usa outra janela | Trabalho offline, `resolve`, capabilities e captura Bridge de um alvo já aberto | Nenhuma para operações permitidas; para abrir, atualizar ou salvar, altere explicitamente para o modo acompanhado |

Background bloqueia `open`, refresh, Save, Save As e qualquer operação cujo comportamento de foco não esteja classificado. Ele não automatiza mouse, teclado, diálogos ou ativação de janela.

## Comportamento validado

- A descoberta considera somente processos Power BI da sessão interativa do Windows; caminho, PID e `SessionId` precisam corresponder.
- Operações Bridge permitidas em background preservaram a janela em primeiro plano no smoke test real.
- Capturas multipágina e intervenções manuais usam checkpoints; trabalho já concluído não é repetido na retomada.
- Refresh e `Ctrl+S` são solicitados uma única vez por checkpoint e só são marcados como concluídos após confirmação explícita.
- A Bridge 1.0.0 não fornece Save, Save As nem exportação PBIX/PBIP completa; essas ações não são anunciadas como automáticas.

Detalhes, estados estruturados e solução de problemas estão em [Integração segura com Power BI Desktop](docs/POWERBI-DESKTOP-INTEGRATION.md).

## Pré-requisitos e versões testadas

| Componente | Requisito mínimo ou escopo | Versão testada nesta branch |
|---|---|---|
| Windows | Windows com PowerShell 5.1 e suporte a junctions | Windows 11, build `26100` |
| Windows PowerShell | `5.1+` | `5.1.26100.33648` |
| Git for Windows | Obrigatório; sem versão mínima fixada | `2.55.0.windows.3` |
| Node.js | `20+` | `24.15.0` |
| npm | Incluído com o Node.js | `11.12.1` |
| OpenCode | Obrigatório; sem versão mínima fixada | `1.19.4` |
| Power BI Desktop | Opcional para arquivos; obrigatório para Bridge e validação visual | `2.159.883.0 (26.10)` |
| Tabular Editor | Opcional, somente para BPA | Não exercitado no smoke desta branch |

Instalação e atualização precisam de rede para Git e npm. Azure CLI, login Azure, Fabric, Power BI Service, gateway e credenciais de cliente não são necessários no fluxo local por arquivos. Um provedor LLM cloud pode exigir rede separadamente.

### Dependências fixadas

| Componente | Versão |
|---|---|
| `microsoft/skills-for-fabric` | `v0.3.19`, SHA `bc42aaf734771bf752c1d7082dd91e5a6ca72b9f` |
| `@microsoft/powerbi-report-authoring-cli` | `0.5.0` |
| `@microsoft/powerbi-desktop-bridge-cli` | `1.0.0` |
| `@microsoft/powerbi-modeling-mcp` | `1.0.0` |

O instalador usa somente o plugin oficial `plugins/powerbi-authoring` necessário ao fluxo local e mantém o Modeling MCP desabilitado por padrão.

## Exemplo com dados públicos

O smoke manual criou duas cópias descartáveis de um dashboard do **Programa Mais Médicos**, com indicador, evolução temporal, comparação por UF e filtros. A fonte foi transformada fora do Git e os totais do período mais recente foram conferidos diretamente no CSV bruto e no agregado: Brasil `26.646` e São Paulo `3.394`.

O cenário validou os dois modos, isolamento por sessão, foco, refresh manual, `Ctrl+S`, persistência após reabrir e retomada por checkpoint. Downloads, PBIPs, caches e screenshots não são versionados.

Para repetir com outra fonte pública, siga [`tests/manual/powerbi-open-data-smoke.md`](tests/manual/powerbi-open-data-smoke.md).

## Como o projeto é composto

| Linguagem/formato | Papel no projeto |
|---|---|
| PowerShell | Instalador transacional, rollback, launcher, diagnóstico, preparação da demo e testes de integração |
| JavaScript (Node.js ES modules) | Adaptador da Desktop Bridge, política de foco, identidade do alvo, checkpoints e testes unitários |
| Windows Batch | Wrappers mínimos para os comandos instalados e fixtures de processo |
| Markdown | READMEs, skills, comandos OpenCode, template de agentes e roteiros manuais |
| TMDL, DAX e Power Query M | Modelo semântico, medidas e dados autocontidos da demo Power BI |
| JSON/PBIR/PBIP | Metadados do relatório, manifests, regras, fixtures e definições de projeto Power BI |

## Arquitetura e limites

- O instalador valida o payload em staging, executa `npm ci`, cria inventário e backup e faz rollback automático em falha de aplicação.
- O bootstrap cria junctions de `.opencode/skills` e `.opencode/common`, adiciona `/demo-powerbi` quando ausente e preserva `AGENTS.md`, comandos e configurações existentes.
- O fluxo padrão é local e orientado a arquivos. Fabric, publicação, OAuth e MCP remoto ficam fora do escopo.
- O Modeling MCP local é opt-in com `-EnableModelingMcp`; o launcher usa configuração temporária e não altera `opencode.json` ou `opencode.jsonc`.
- Validação estática, Bridge conectada, modelo carregado e resultado visual são evidências distintas.

Para atualizar, execute novamente o instalador. Backups ficam em `<InstallRoot>\backups`; o comando de rollback é impresso ao final e também está disponível em `Restore-PowerBI-OpenCodeAccelerator.ps1`.

## Documentação

- [Integração Desktop, comandos e solução de problemas](docs/POWERBI-DESKTOP-INTEGRATION.md)
- [Demo distribuída e totais esperados](examples/VendasDemo/README.md)
- [Roteiro manual com dados públicos](tests/manual/powerbi-open-data-smoke.md)
- [Comando OpenCode `/demo-powerbi`](.opencode/commands/demo-powerbi.md)
- [Avisos e licenças de terceiros](THIRD_PARTY_NOTICES.md)

## Testes

```powershell
node --test ".\tests\powerbi-desktop-safe.test.mjs"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tests\Run-Tests.ps1"
git diff --check
```

Na branch `feat/powerbi-execution-modes`, foram validados 36 testes Node, a suíte transacional completa e o smoke real no Windows descrito acima.

## Contribuição

Abra uma [issue](https://github.com/flrodrigues21/Opencode_PBI_Accelerator/issues) para bugs ou propostas. Para contribuir com código, crie uma branch, mantenha artefatos locais fora do Git, execute os testes acima e envie um pull request com escopo e evidências de validação claros.

## Licença

Código deste projeto: [MIT](LICENSE). Componentes Microsoft mantêm suas atribuições em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) e em [`third-party/`](third-party/).
