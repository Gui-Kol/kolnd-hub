# Checklist manual - controle do computador (task 08)

Data da execução automatizada: 2026-11-26
Branch: `Dev`. Sem commit, por decisão do projeto.

Este checklist separa o que foi provado por comando/teste do que exige olho
humano. Itens não executados ficam explicitamente **pendentes**; nada é marcado
como "aprovado" por inferência.

## Evidências automatizadas

### Testes unitários (Node, sem ação real)

Nenhum teste abre aplicativo, fecha processo, move arquivo, agenda desligamento,
aciona UIAutomation ou toca no registro. `spawn`, `execFile`, `fs`, `dialog`,
`clock` e o runner de PowerShell são fakes nas suítes abaixo.

| Etapa | Arquivo                                   | Casos  |
| ----- | ----------------------------------------- | ------ |
| T1    | `src/shared/permissions.test.ts`          | 4      |
| T1    | `src/main/ipc/actions.test.ts`            | 4      |
| T1    | `src/main/store.test.ts` (migração 1.7.0) | 1 novo |
| T2    | `src/main/actions/appCatalog.test.ts`     | 4      |
| T3    | `src/main/actions/processes.test.ts`      | 4      |
| T4    | `src/main/actions/search.test.ts`         | 4      |
| T5    | `src/main/actions/readFile.test.ts`       | 5      |
| T6    | `src/main/actions/fileOps.test.ts`        | 5      |
| T7    | `src/main/actions/system.test.ts`         | 4      |
| T8    | `src/main/routines/scheduler.test.ts`     | 5      |
| T9    | `src/main/actions/uia.test.ts`            | 4      |
| T10   | `src/main/audit/actions.test.ts`          | 5      |
| T10   | `src/main/actions/tools.test.ts`          | 3      |
| T10b  | `src/main/gemini/engine-tools.test.ts`    | 5      |
| T10b  | `src/main/voice-tools.test.ts`            | 2      |
| T10b  | `src/main/gemini/live.test.ts` (resposta) | 1 novo |

### Defaults provados por teste/smoke

- `permissions.categories`: `apps.launch=ask`, `apps.close=ask`, `files.read=ask`,
  `files.write=ask`, `web.search=allow`, `system.power=deny`, `uia.control=deny`.
- `microphone` continua no mesmo campo da task 06 e não é tocado por mudança de
  categoria.
- Pausa global persiste em `permissions.paused` e o gate devolve `deny` para
  qualquer categoria antes da confirmação, inclusive para a visão de tela.
- `system.power` e `uia.control` nascem `deny`: energia/UIA só executam depois de
  `permissions:set` com decisão `allow`.

### Smoke de runtime

Executado na T12 com `ABSOLEM_SMOKE=1` e `ABSOLEM_TEST_USERDATA` temporário.
Saída real (`SMOKE_EXIT=0`):

```
smoke: permissions:get + actions:pause/status
{"before":{"ok":true,"permissions":{"microphone":false,"paused":false,"categories":{
 "apps.launch":"ask","apps.close":"ask","files.read":"ask","files.write":"ask",
 "system.power":"deny","uia.control":"deny","web.search":"allow"}}},
 "pauseOn":{"ok":true,"paused":true},
 "during":{"ok":true,"status":{"paused":true,...}},
 "pauseOff":{"ok":true,"paused":false},
 "after":{"ok":true,"status":{"paused":false,...}}}
```

`permissions:get` devolveu os defaults (`ask`/`allow`/`deny`), a pausa alternou e
`userData/audit/actions.jsonl` NÃO existia ao final: nenhuma ferramenta de ação
foi executada pelo smoke. `config.json` terminou com `permissions.paused=false`.

Comandos automatizados da T12/T10b: `npm run verify` exit 0 (82 arquivos, 302
testes), `npm run verify:build` exit 0, `npx electron-builder --dir` exit 0,
smoke exit 0.

## Checklist manual (exige olho humano)

| Item                        | Como verificar                                                                                          | Resultado esperado                                                                     | Auditoria                                                                            | Resultado                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| Abrir app                   | Com `apps.launch=ask`, pedir "abrir Bloco de Notas"; confirmar                                          | Processo `notepad.exe` aparece; nome fora do catálogo é recusado                       | `actions.jsonl` com `tool:open_app`, `category:apps.launch`, `decision:ask-accepted` | pendente - exige execução real        |
| Fechar app                  | Abrir o Bloco de Notas e pedir para fechar; depois tentar `explorer.exe`                                | Fecha sem `/F`; `explorer.exe`/sessão `Services` recusam sempre                        | `tool:close_process`, `category:apps.close`; blocklist gera `decision:denied`/erro   | pendente - exige execução real        |
| Listar processos            | Pedir a lista de processos                                                                              | Até 500 linhas com nome, PID, sessão e memória                                         | `tool:list_processes`, `category:internal`                                           | pendente - exige execução real        |
| Buscar arquivo              | Pedir um arquivo conhecido em Documentos                                                                | Resultado dentro de Documentos/Desktop/Downloads; AppData e `node_modules` fora        | `tool:search_files`, `category:files.read`                                           | pendente - exige execução real        |
| Ler arquivo                 | Pedir a leitura de um `.md` grande                                                                      | Texto com aviso de truncamento em 1 MB/2.000 linhas; conteúdo NÃO aparece na auditoria | `tool:read_file`, `safeArgs` só com `path`                                           | pendente - exige execução real        |
| Mover 3 arquivos e desfazer | Criar 3 arquivos de teste, pedir mover, confirmar o plano e desfazer                                    | Plano mostra origem -> destino; journal em `file-ops`; desfazer devolve os 3           | `tool:apply_file_ops` e `tool:undo_file_op`, `category:files.write`                  | pendente - exige execução real        |
| Bloquear estação            | Com `system.power=allow`, pedir bloqueio                                                                | Estação bloqueia e o balão avisa                                                       | `tool:lock_workstation`, `category:system.power`                                     | pendente - exige execução real        |
| Agendar desligamento        | Com `system.power=allow`, pedir desligar e cancelar em seguida                                          | Aviso de 60 s; `shutdown /a` cancela antes do prazo                                    | `tool:shutdown_computer` e `tool:cancel_shutdown`                                    | pendente - exige execução real        |
| Rotina                      | Criar rotina para 1 min à frente com o app aberto                                                       | Executa no minuto; rotina sensível pede confirmação na hora; atraso > 1 h é pulado     | `tool:routine:<id>`                                                                  | pendente - exige execução real        |
| Pausa                       | `Control+Alt+P` (ou `actions:pause`) e tentar abrir um app                                              | Nada executa enquanto pausado; alternar reativa                                        | `actions.jsonl` sem execução durante a pausa                                         | pendente - atalho real exige execução |
| Volume                      | Com `system.power=allow`, pedir volume 30                                                               | Se o efeito for confirmado, reporta sucesso; senão "não suportado neste equipamento"   | `tool:set_volume`                                                                    | pendente - depende do equipamento     |
| Brilho                      | Com `system.power=allow`, pedir brilho 50                                                               | Mesma regra do volume (verificação obrigatória)                                        | `tool:set_brightness`                                                                | pendente - depende do equipamento     |
| UIAutomation                | Somente com `uia.control=allow` explícito, abrir o Bloco de Notas, ler a árvore e acionar "Salvar como" | Árvore parcial em timeout; campo `IsPassword` recusado; 1 ação por 2 s                 | `tool:get_ui_tree`/`tool:invoke_element`                                             | pendente - gate desligado por padrão  |

## Fora do escopo (não testar nesta task)

- Terminal/shell livre, script arbitrário, instalação de software.
- Elevação/UAC e qualquer ação administrativa.
- Automação de mouse/teclado por coordenada.
- Integração com o Agendador de Tarefas do Windows.
- Envio de mensagens, compras, transações financeiras.
- Edição de conteúdo de arquivo (só mover/renomear/copiar/excluir para a Lixeira).
- Otimização/limpeza de disco e desinstalação.
