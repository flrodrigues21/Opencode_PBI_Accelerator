# Power BI + OpenCode Accelerator (Windows, local)

Acelerador independente para trabalhar com projetos Power BI PBIP/PBIR/TMDL no OpenCode. O padrão é local e orientado a arquivos: não habilita Fabric, Power BI Service, OAuth, publicação nem MCP remoto.

> Projeto não oficial, sem afiliação ou endosso da Microsoft, OpenCode ou Anomaly. Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Componentes

| Camada | Função | Padrão |
|---|---|---|
| Skills | Instruções Markdown descobertas pelo OpenCode | Habilitadas |
| CLIs npm | Validação/autoria PBIR e comunicação com Desktop | Instaladas localmente |
| Power BI Modeling MCP | Ferramentas de modelagem contra Desktop/modelo local | Desabilitado; opt-in |

Skills não são executáveis. As CLIs são processos locais. MCP é um servidor de ferramentas separado e exige configuração explícita no cliente.

### `powerbi-authoring` e `fabric-skills`

O instalador copia somente o plugin oficial `plugins/powerbi-authoring`, adequado ao fluxo local Power BI:

- `powerbi-report-cli`: planejar, desenhar, editar e validar relatórios;
- `semantic-model-authoring`: TMDL, DAX e modelos semânticos;
- `common/`: dependências relativas usadas pelas skills.

O bundle `fabric-skills` é diferente: inclui skills, agentes e MCPs hospedados para workloads Fabric. Ele não é instalado por padrão e não é necessário para PBIP local.

As skills próprias `rode-o-bpa` e `check-updates` continuam instaladas. Skills desconhecidas já existentes em `<InstallRoot>\skills` não são removidas.

## Versões Fixadas

| Componente | Versão/SHA |
|---|---|
| `microsoft/skills-for-fabric` | tag `v0.3.19`, SHA `bc42aaf734771bf752c1d7082dd91e5a6ca72b9f` |
| `@microsoft/powerbi-report-authoring-cli` | `0.5.0` (Node `>=20`) |
| `@microsoft/powerbi-desktop-bridge-cli` | `1.0.0` (Node `>=20`) |
| `@microsoft/powerbi-modeling-mcp` | `1.0.0` (Node `>=18`) |

Origem do SHA: branch `main` e tag `v0.3.19` do repositório oficial Microsoft, verificadas em 26/10/2026.

O pin anterior, `ac156d284ab8e51f121af3f42303ea79c88cdab5`, antecedia 15 commits e as releases `v0.3.13` a `v0.3.19`. A mudança mais relevante para este projeto é a consolidação das quatro skills antigas de relatório em `powerbi-report-cli`. O `.mcp.json` oficial ainda usa `@latest`; o acelerador não o importa e fixa o MCP em `1.0.0`.

Comparação oficial: <https://github.com/microsoft/skills-for-fabric/compare/ac156d284ab8e51f121af3f42303ea79c88cdab5...bc42aaf734771bf752c1d7082dd91e5a6ca72b9f>

## Requisitos

Fluxo local:

- Windows PowerShell 5.1 ou superior;
- Git;
- Node.js 20 ou superior, com npm;
- OpenCode;
- Power BI Desktop apenas para testar a bridge ou validar visualmente;
- Tabular Editor apenas para executar BPA.

Azure CLI, login Azure, workspace, capacidade/licença Fabric e Power BI Service não são exigidos para o fluxo exclusivo por arquivos. Esses requisitos só se aplicam se o usuário decidir trabalhar com recursos cloud, fora do escopo padrão deste acelerador.

## Instalar Ou Atualizar

No PowerShell 5.1:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& ".\Install-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

O mesmo comando faz instalação limpa ou atualização idempotente. Antes de alterar a instalação funcional, ele:

1. baixa o SHA fixado em uma pasta temporária;
2. valida manifests, skills completas, frontmatter, `common`, links relativos e versões npm;
3. executa `npm ci` no staging;
4. salva inventário e backup dos arquivos gerenciados;
5. aplica o payload e executa rollback automático se a troca falhar.

Arquivos pessoais e skills não gerenciadas são preservados. Uma colisão desconhecida interrompe a instalação; `-Force` só deve ser usado após revisão e preserva o destino anterior no backup. `-SkipNpmInstall` existe para testes controlados e não deve ser usado em uma atualização normal.

Backups ficam em `<InstallRoot>\backups`. O comando exato de rollback é impresso ao final. Para restaurar o backup mais recente:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\Restore-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator"
```

## OpenCode

O OpenCode descobre skills em `.opencode/skills/<nome>/SKILL.md`. O bootstrap cria junctions:

```text
<projeto>\.opencode\skills -> <InstallRoot>\skills
<projeto>\.opencode\common -> <InstallRoot>\common
```

Isso mantém válidas referências como `../../common/COMMON-CLI.md`. `AGENTS.md`, `opencode.json`, `opencode.jsonc` e comentários JSONC existentes são preservados. O acelerador não faz merge por regex nem reserializa configurações pessoais.

Para preparar e abrir um projeto existente:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\caminho\Projeto"
```

Se `.opencode\skills` ou `.opencode\common` já forem diretórios reais ou links para outro destino, o bootstrap para. `-Force` move diretórios reais para backup ou recria somente a junction; nunca altera o destino antigo.

## MCP Local Opt-In

O OpenCode não importa automaticamente o `.mcp.json` de plugins Claude/Copilot. Por isso o MCP permanece desligado no fluxo por arquivos.

Para iniciar o OpenCode com o Modeling MCP local somente nessa sessão:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\caminho\Projeto" -EnableModelingMcp
```

O script gera uma configuração temporária no formato OpenCode, com `type: local`, `command` em array, `enabled: true` e timeout de 30 segundos. Nenhum `opencode.json/jsonc` é alterado. Se `OPENCODE_CONFIG` já estiver definido, o script para para não substituir a configuração do usuário.

O MCP pode exigir aceite da EULA Microsoft. Para conexão com Desktop, abra o Power BI Desktop e o modelo desejado. Não registre simultaneamente MCP local e remoto com ferramentas sobrepostas.

## Smoke Test Seguro

O padrão é somente diagnóstico e não altera o projeto:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\caminho\Projeto"
```

Para testar a bridge opcionalmente, com duas tentativas e timeout explícito:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\caminho\Projeto" -TestBridge -BridgeTimeoutSeconds 5 -BridgeAttempts 2
```

Se a bridge estiver indisponível, o diagnóstico continua pelas validações de arquivos. O script não encerra o Power BI Desktop, não executa refresh, reload ou screenshot e diferencia:

- `arquivo validado`: validação estática concluída;
- `bridge conectada` ou `bridge unavailable`: estado do processo local;
- `validacao visual not executed`: nenhuma evidência visual foi produzida.

Para preparar uma cópia isolada, o destino deve ser novo:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" -InstallRoot "C:\OpenCode\PowerBI-Accelerator" -ProjectPath "C:\Relatorios\Projeto" -PrepareCopy -CopyDestination "C:\Relatorios\Projeto-Smoke"
```

O conteúdo PBIP/PBIR/TMDL original é copiado sem alteração; somente a cópia recebe junctions, `AGENTS.md` quando ausente e atalhos. Fontes, credenciais, relacionamentos, medidas e dados não são modificados.

## Limites Offline

- Instalação e atualização precisam de rede para Git e npm.
- Depois da instalação, skills e CLIs ficam locais.
- O Modeling MCP instalado localmente não é um serviço remoto, mas pode depender do Desktop/modelo aberto.
- OpenCode ainda precisa de rede se o provedor LLM for cloud. Operação totalmente offline exige um provedor local já configurado.
- Validação de arquivos não equivale a bridge conectada nem a validação visual no Desktop.

## Testes Do Repositório

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tests\Run-Tests.ps1"
git diff --check
```

Os testes usam fixtures e pastas temporárias; não acessam relatórios do usuário. Um teste real no Desktop continua sendo manual.

## Referências Oficiais

- <https://learn.microsoft.com/pt-br/fabric/fundamentals/skills-for-fabric-install>
- <https://github.com/microsoft/skills-for-fabric>
- <https://github.com/microsoft/powerbi-modeling-mcp>
- <https://opencode.ai/docs/skills/>
- <https://opencode.ai/docs/mcp-servers/>
- <https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview>

## Licenças

Código deste projeto: [MIT](LICENSE). Componentes Microsoft mantêm suas atribuições e licenças em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) e `third-party/`.
