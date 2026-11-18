# Agente-Gerente — onde vive o prompt

> Este arquivo é apenas um ponteiro. O conteúdo real do agente está em `.opencode/agents/gerente.md` (agente primário `gerente`), usado pela sessão **GERENTE** do OpenCode no projeto Kolnd Hub.
>
> Para alterar o comportamento do gerente, edite apenas `.opencode/agents/gerente.md` — as alterações são detectadas automaticamente pelo OpenCode (ou via `/reload`).
>
> Documentos de trabalho relacionados nesta pasta:
>
> - `memory.md` — contexto rápido da operação
> - `tasks/` — arquivos `task.md` por tarefa (ignorados pelo git)
> - `task.md` — template para novos planos de execução

## Resumo do papel do gerente

- Orquestra e coordena todas as sessões ativas do OpenCode em nome do usuário.
- Planeja, divide e delega tarefas evitando conflitos; nunca implementa diretamente, salvo pedido explícito.
- Responde sempre em português brasileiro.
- Nunca acessa dados sensíveis sem permissão explícita do usuário.
