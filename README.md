# Power BI + OpenCode Accelerator

[**Português**](README.md) | [English](README.en.md)

Crie, valide e documente projetos Power BI PBIP/PBIR/TMDL por arquivos, com operações controladas no Desktop quando elas forem realmente necessárias.

> Projeto não oficial, sem afiliação ou endosso da Microsoft, OpenCode ou Anomaly. Consulte os [avisos de terceiros](THIRD_PARTY_NOTICES.md).

| Comece por aqui | Resultado esperado |
|---|---|
| [**Quero instalar do zero**](#install-from-scratch) | Accelerator instalado, projeto preparado e primeira demo validada |
| [**Quero validar um PBIP existente**](#validate-existing-pbip) | Diagnóstico por arquivos, evidências e próximos passos sem alterar o projeto |
| [**Quero criar uma proposta de dashboard a partir de uma base**](#create-dashboard-proposal) | Protótipo PBIP separado, medidas, fontes e premissas documentadas |

<a id="install-from-scratch"></a>
## Quero instalar do zero

Você precisa de Windows PowerShell 5.1+, Git, Node.js 20+, npm e OpenCode no `PATH`. O Power BI Desktop é opcional para análise por arquivos e necessário para abrir, atualizar ou conferir o resultado visual. Veja o [guia interativo completo](docs/INTERACTIVE-QUICKSTART.md#requirements).

### Início rápido

Os caminhos abaixo são exemplos. Substitua-os pelos seus diretórios.

```powershell
git clone https://github.com/flrodrigues21/Opencode_PBI_Accelerator.git `
  "C:\Ferramentas\Opencode_PBI_Accelerator"
Set-Location "C:\Ferramentas\Opencode_PBI_Accelerator"
Set-ExecutionPolicy -Scope Process Bypass

& ".\Install-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator"

New-Item -ItemType Directory -Path "C:\Projetos\PowerBI-Primeiro-Resultado" -Force | Out-Null
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado"
```

O instalador valida pré-requisitos, dependências fixadas e payload antes de aplicar; cria inventário e backup e instala os CLIs locais. O launcher prepara `.opencode`, preserva configurações existentes e abre o OpenCode na pasta do projeto.

No OpenCode, execute:

```text
/demo-powerbi
```

A demo cria `VendasDemo-Demo` sem sobrescrever diretórios existentes. Confirme a instalação e os arquivos gerados:

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Test-PowerBI-OpenCodeAccelerator.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado\VendasDemo-Demo"
```

Esse fluxo é offline em relação ao Desktop. Para abrir a demo, execute o launcher abaixo e escolha **Acompanhar na tela**; a opção **Background** registra o modo, mas não abre nem ativa o Desktop.

```powershell
& "C:\OpenCode\PowerBI-Accelerator\bin\Start-PowerBI-OpenCode.ps1" `
  -InstallRoot "C:\OpenCode\PowerBI-Accelerator" `
  -ProjectPath "C:\Projetos\PowerBI-Primeiro-Resultado\VendasDemo-Demo" `
  -OpenDesktop
```

<a id="validate-existing-pbip"></a>
## Quero validar um PBIP existente

**Quando usar:** antes de refresh, publicação, revisão técnica ou entrega de um PBIP existente.

**O que sai:** resumo executivo, documentação Markdown, evidências por arquivo e uma lista separada do que ainda depende do Desktop.

<details>
<summary><strong>Copiar prompt de validação</strong></summary>

Os caminhos são fictícios e devem ser substituídos.

```text
Use o Accelerator clonado em C:\Ferramentas\Opencode_PBI_Accelerator.
Leia as instruções aplicáveis e valide o projeto C:\Projetos\Vendas\Vendas.pbip.
Comece pela análise offline: confira PBIR, TMDL, referências entre relatório
e modelo, fontes e objetos ausentes. Preserve o projeto. Gere um resumo
executivo e uma documentação Markdown com evidências e próximos passos.
Separe o que foi verificado por arquivos do que depende do Desktop.
Sem refresh ou publicação.
```

</details>

<a id="create-dashboard-proposal"></a>
## Quero criar uma proposta de dashboard a partir de uma base

**Quando usar:** quando há dados disponíveis, mas ainda não existe um desenho validado de indicadores e páginas.

**O que sai:** protótipo PBIP em outra pasta, proposta de indicadores, filtros e páginas, além de medidas, fontes e premissas documentadas.

<details>
<summary><strong>Copiar prompt de proposta</strong></summary>

Os caminhos são fictícios e devem ser substituídos.

```text
Use o Accelerator clonado em C:\Ferramentas\Opencode_PBI_Accelerator.
Inspecione a base em C:\Projetos\Vendas\dados: arquivos, colunas, tipos,
grão e qualidade. Proponha indicadores, filtros e páginas com base no que
os dados permitem responder. Crie um protótipo PBIP separado em
C:\Projetos\Vendas\proposta e documente as medidas, fontes e premissas.
Se não puder renderizar o protótipo, diga o que ficou validado offline.
Preserve a base original e não publique.
```

</details>

<details>
<summary><strong>Exemplo curto: revisar cards e drillthrough sem refresh</strong></summary>

```text
Use o Accelerator clonado em C:\Ferramentas\Opencode_PBI_Accelerator e revise
os cards e o drillthrough de C:\Projetos\Vendas\Vendas.pbip sem refresh.
Compare os IDs usados na origem e no detalhe dentro do mesmo contexto de filtro,
documente divergências e preserve o projeto. Separe a evidência de PBIR/TMDL
de qualquer confirmação visual que ainda dependa do Desktop.
```

</details>

<a id="execution-modes"></a>
## Acompanhar na tela ou Background

| Modo | Use quando | Limite principal |
|---|---|---|
| **Acompanhar na tela** | É necessário abrir o PBIP ou conferir o resultado visual | Refresh, `Ctrl+S` e Save As continuam manuais |
| **Background** | A análise pode seguir por arquivos ou consultar um alvo já aberto sem tomar o foco | Não abre, atualiza nem salva; operações de foco desconhecido são bloqueadas |

Abrir, atualizar ou salvar pode exigir mudança para o modo acompanhado e uma ação explícita do usuário; o Accelerator não automatiza mouse, teclado ou diálogos.

<a id="client-tracks"></a>
## Onde executar o prompt

| Cliente | Como usar | Suporte do Accelerator |
|---|---|---|
| **OpenCode** | Abra o projeto com o launcher e cole o prompt na conversa; `/demo-powerbi` está disponível | Integração principal e testada por CLI/arquivos |
| **Claude Code** | Abra o terminal na pasta do projeto, execute `claude` e cole o prompt com o caminho do clone | Não testado; leitura manual das instruções e uso dos CLIs |
| **Codex CLI** | Abra o terminal na pasta do projeto, execute `codex` e cole o prompt com o caminho do clone | Não testado; leitura manual das instruções e uso dos CLIs |
| **VS Code** | Abra a pasta e cole o prompt no chat da extensão assistente escolhida, por exemplo GitHub Copilot Chat | VS Code sozinho não executa prompts; integração não testada |

O instalador do OpenCode não configura os outros clientes e `/demo-powerbi` não existe neles. Veja comandos, arquivos a ler, alternativa por CLI e o MCP opcional somente para OpenCode no [guia por cliente](docs/INTERACTIVE-QUICKSTART.md#client-tracks).

<details>
<summary><strong>Escopo, evidências e versões</strong></summary>

- O fluxo padrão é local e orientado a arquivos; Fabric, publicação, OAuth e MCP remoto estão fora do escopo.
- Validação estática, Bridge conectada, modelo carregado e resultado visual são evidências diferentes.
- A Bridge 1.0.0 não fornece Save, Save As nem exportação PBIX/PBIP completa.
- Foram validados 36 testes Node, 124 verificações transacionais e um smoke real no Windows com isolamento por sessão e preservação de foco.
- Versões e dependências fixadas estão no [guia interativo](docs/INTERACTIVE-QUICKSTART.md#requirements).

</details>

<a id="documentation"></a>
## Documentação

- [Do zero ao primeiro resultado e trilhas por cliente](docs/INTERACTIVE-QUICKSTART.md)
- [Integração Desktop, comandos e solução de problemas](docs/POWERBI-DESKTOP-INTEGRATION.md)
- [Demo distribuída e totais esperados](examples/VendasDemo/README.md)
- [Roteiro manual com dados públicos](tests/manual/powerbi-open-data-smoke.md)
- [Comando OpenCode `/demo-powerbi`](.opencode/commands/demo-powerbi.md)
- [Avisos e licenças de terceiros](THIRD_PARTY_NOTICES.md)

Para contribuir, abra uma [issue](https://github.com/flrodrigues21/Opencode_PBI_Accelerator/issues), mantenha artefatos locais fora do Git e envie um pull request com escopo e evidências claros. Código sob licença [MIT](LICENSE).
