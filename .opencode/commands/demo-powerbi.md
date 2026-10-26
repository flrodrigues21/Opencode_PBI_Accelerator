---
description: Cria uma copia independente e validada da demo Power BI VendasDemo
---

Prepare uma copia independente de `examples/VendasDemo` usando o fluxo gerenciado pelo acelerador.

Destino solicitado pelo usuario: `$ARGUMENTS`

Regras de execucao:

1. Priorize terminal, arquivos e CLIs. Mostre progresso com `[ETAPA x/y]`, `[OK]`, `[AVISO]` e `[PROXIMO]` apenas quando houver informacao nova.
2. Resolva a raiz do acelerador por `POWERBI_OPENCODE_ACCELERATOR`; nao presuma um caminho fixo. Se a variavel nao existir, informe que o usuario deve instalar o acelerador e abrir o OpenCode por `Start-PowerBI-OpenCode.ps1` ou pelo atalho gerado.
3. Se `$ARGUMENTS` contiver um destino, trate todo o argumento como um unico caminho, removendo apenas aspas externas. Se estiver vazio, use `<pasta-atual>\VendasDemo-Demo` somente quando esse caminho ainda nao existir; caso contrario, pergunte ao usuario por outro destino.
4. Nunca sobrescreva, mescle ou apague um destino existente. Nao edite o exemplo canonico.
5. Execute, com timeout explicito de 60 segundos:

   `& <raiz>\bin\Test-PowerBI-OpenCodeAccelerator.ps1 -InstallRoot <raiz> -ProjectPath <pasta-atual> -PrepareDemo -DemoDestination <destino>`

6. Nao recrie o PBIP manualmente. O script deve copiar a demo ficticia, rejeitar caches/junctions/caminhos privados, validar referencias relativas e totais, e usar a CLI PBIR quando disponivel.
7. Nao exija cloud, credenciais, gateway ou publicacao. Bridge e MCP sao opcionais; use-os somente se o usuario pedir, com timeout e no maximo uma nova tentativa justificada.
8. Ao final, diferencie arquivos gerados, estrutura validada, consultas executadas e validacao visual. Nunca declare carregamento do modelo ou validacao visual sem evidencia correspondente.
9. Informe o caminho completo de `VendasDemo.pbip`. Explique que, na primeira abertura, o Desktop pode exigir uma unica atualizacao manual para carregar as tabelas locais antes da conferencia visual.
