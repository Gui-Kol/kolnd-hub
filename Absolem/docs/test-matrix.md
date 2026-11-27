# Matriz de testes e cobertura

Documento da task 13 (T8). Consolida os testes existentes por módulo, tipo,
arquivo e critério. Não há linha "a fazer": cada linha aponta para um teste que
existe e roda em `npm test`, `npm run test:coverage` ou `npm run test:e2e`. Os
itens que dependem de ambiente humano aparecem como **manual** com o checklist
correspondente.

Execução de referência em **2026-11-26**:

- `npm test`: **496 testes em 123 arquivos**, todos verdes, cerca de 6 s.
- `npm run test:coverage`: **74,51% linhas, 68,33% ramos, 83,29% funções**
  (meta: linhas >= 70%, ramos >= 60%; statements acompanha linhas).
- `npm run test:e2e`: coberto em `tests/e2e` (ver seção 4).

## 1. Escopo da cobertura

`vitest.config.ts` inclui apenas `src/main/**/*.ts` e `src/shared/**/*.ts`.
Ficam fora, por não serem lógica pura ou por exigirem Electron real:

- `src/renderer/**`, `src/preload/**` e `scripts/**` (UI visual tem e2e/axe, sem
  meta de linha);
- `src/main/index.ts`, `src/main/testUserData.ts` (bootstrap);
- `src/main/**/instance.ts` (composição que liga Electron/store);
- `src/main/gemini/sdk.ts`, `src/main/gemini/transport.ts` (fronteira do SDK);
- `src/main/ipc/index.ts` (registro central);
- `src/main/actions/shortcut.ts`, `src/main/voice/shortcut.ts` (atalhos de SO).

A meta é global para o conjunto incluído, não por arquivo. Um módulo novo de
lógica entra na conta automaticamente pelo `include`.

## 2. Matriz de testes

### 2.1 Fundação e ciclo de vida

| Módulo            | Tipo    | Arquivo                           | Critério                                                       |
| ----------------- | ------- | --------------------------------- | -------------------------------------------------------------- |
| Logger e rotação  | unidade | `src/main/logger.test.ts`         | Redação em `info`, rotação 5 MB x 2, falha de disco não lança  |
| Store e migrações | unidade | `src/main/store.test.ts`          | Defaults, normalização, migrações 1.1 a 1.10, store em memória |
| Segredos          | unidade | `src/main/secrets.test.ts`        | Sem `safeStorage`, gravação recusada; chave nunca volta        |
| Autostart         | unidade | `src/main/autostart.test.ts`      | Suporte, falha e alternância por usuário                       |
| Primeira execução | unidade | `src/main/firstRun.test.ts`       | Flag idempotente                                               |
| Navegação         | unidade | `src/main/navigation.test.ts`     | Produção nega; dev só a origem do HMR                          |
| Instância única   | unidade | `src/main/singleInstance.test.ts` | Segunda instância foca sem bootstrap                           |
| Encerramento      | unidade | `src/main/shutdown.test.ts`       | Gancho que lança não impede os demais                          |
| Crash local       | unidade | `src/main/crashReporting.test.ts` | `uploadToServer:false`, diretório local                        |
| Tema I/O          | unidade | `src/main/theme-io.test.ts`       | Export/import válido, cancelado e inválido                     |
| Janela principal  | unidade | `src/main/lifecycle.test.ts`      | X oculta, quit fecha, session-end marca saída                  |

### 2.2 IPC e segurança

| Módulo               | Tipo       | Arquivo                               | Critério                                                                      |
| -------------------- | ---------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| IPC base             | integração | `src/main/ipc/app.test.ts`            | Payload inválido, quit marca saída                                            |
| Chat IPC             | integração | `src/main/ipc/chat.test.ts`           | Resposta imediata, delta/done, erro sem SDK                                   |
| Memória IPC          | integração | `src/main/ipc/memory.test.ts`         | Confirmação literal, campos desconhecidos, erros                              |
| Histórico IPC        | integração | `src/main/ipc/history.test.ts`        | Limite 1..200, memória pausada devolve vazio                                  |
| Overlay IPC          | integração | `src/main/ipc/overlay.test.ts`        | Status, layout, foco só do overlay                                            |
| Layout do overlay    | integração | `src/main/ipc/overlay-layout.test.ts` | Faixas e patch parcial                                                        |
| Ações/permissões IPC | integração | `src/main/ipc/actions.test.ts`        | Pausa, categoria inválida, status                                             |
| Store IPC            | integração | `src/main/ipc/store.test.ts`          | Chave desconhecida recusada                                                   |
| Diagnóstico IPC      | integração | `src/main/ipc/diagnostics.test.ts`    | Metadados sem chave, erros limitados                                          |
| Guarda de IPC        | unidade    | `src/main/security/ipc.test.ts`       | Allowlist, 8 MB/64 KB, remetente, erro sem stack                              |
| Modos degradados     | unidade    | `src/main/security/degraded.test.ts`  | Mensagem, avatar e recuperação para 10 falhas; nenhuma vira erro desconhecido |
| Redação              | unidade    | `src/main/security/redaction.test.ts` | Chave, caminho, transcrição, debug explícito                                  |
| Hardening Electron   | unidade    | `src/main/security/hardening.test.ts` | WebPreferences, CSP, webview, mídia, navegação                                |
| Permissões de mídia  | unidade    | `src/main/permissions.test.ts`        | Só `media`, só overlay, só com consentimento                                  |

### 2.3 Motor Gemini, custo e tools

| Módulo                | Tipo    | Arquivo                                   | Critério                                                                 |
| --------------------- | ------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Cliente Gemini        | unidade | `src/main/gemini/client.test.ts`          | `auth`, `quota`, `timeout`, `cancelled`, sem stack                       |
| Engine                | unidade | `src/main/gemini/engine.test.ts`          | Sem chave devolve `auth`; não toca na rede                               |
| Streaming             | unidade | `src/main/gemini/stream.test.ts`          | Um turno por vez, cancelamento, nenhum delta tardio                      |
| Live                  | unidade | `src/main/gemini/live.test.ts`            | `network`, `quota`, reconexão e barge-in                                 |
| Grounding             | unidade | `src/main/gemini/grounding.test.ts`       | Fontes, `quota`, sem chave                                               |
| Histórico de contexto | unidade | `src/main/gemini/history.test.ts`         | Janela, papéis e truncamento                                             |
| Medidor de custo      | unidade | `src/main/gemini/usage.test.ts`           | Soma diária/mensal, 80%, 100%, retenção 62 dias                          |
| Custo e idempotência  | unidade | `src/main/security/cost-limits.test.ts`   | 100% sem rede, aumento libera, `requestId` único, reset mensal, negativo |
| Guarda do SDK         | unidade | `src/main/gemini/guard.test.ts`           | Sem chave hardcoded, sem `console.*`, SDK só em `sdk.ts`                 |
| Registro de tools     | unidade | `src/main/gemini/tools/registry.test.ts`  | Schema, nomes únicos, categorias                                         |
| Roteador de tools     | unidade | `src/main/gemini/tools/router.test.ts`    | Permissão antes da execução, confirmação, timeout                        |
| Tools web             | unidade | `src/main/gemini/tools/web-tools.test.ts` | Busca/abertura e limites                                                 |
| Continuação de tools  | unidade | `src/main/gemini/engine-tools.test.ts`    | Função chamada, resposta e cancelamento                                  |
| Web no engine         | unidade | `src/main/gemini/engine-web.test.ts`      | Fontes anexadas, citação corrigida                                       |

### 2.4 Voz

| Módulo                       | Tipo       | Arquivo                                                 | Critério                                              |
| ---------------------------- | ---------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Alternância de voz           | unidade    | `src/main/voice-toggle.test.ts`                         | Consentimento, revogação, device, overlay             |
| Timeouts                     | unidade    | `src/main/voice-timeouts.test.ts`                       | Silêncio 20 s e sessão 15 min                         |
| Transcrição                  | unidade    | `src/main/voice-transcript.test.ts`                     | Parcial não sobrescreve final; interrupção            |
| Tools na voz                 | unidade    | `src/main/voice-tools.test.ts`                          | Falha de tool não fecha sessão                        |
| Barge-in                     | integração | `tests/voice/bargein.test.ts`                           | Fala durante `speaking` interrompe em menos de 300 ms |
| Consentimento e revogação UI | UI/jsdom   | `src/renderer/src/settings/consent-revocation.test.tsx` | Cada capacidade muda de estado em no máximo 2 cliques |
| Aba Voz                      | UI/jsdom   | `src/renderer/src/settings/VoiceTab.test.tsx`           | Dispositivo, limite, consentimento, teste local       |

### 2.5 Captura de tela

| Módulo                | Tipo    | Arquivo                                 | Critério                                 |
| --------------------- | ------- | --------------------------------------- | ---------------------------------------- |
| Controlador           | unidade | `src/main/capture/controller.test.ts`   | Modo `off`, confirmação, limite mensal   |
| Limites               | unidade | `src/main/capture/limits.test.ts`       | 20/h, proativa 60 s, voz, quota          |
| Privacidade/blocklist | unidade | `src/main/capture/privacy.test.ts`      | Título/processo bloqueado, duas capturas |
| Injeção por tela      | unidade | `src/main/capture/injection.test.ts`    | Envelope de dado não confiável           |
| Pergunta sobre tela   | unidade | `src/main/capture/ask.test.ts`          | Captura + envio, erro `blocked`          |
| Fontes                | unidade | `src/main/capture/sources.test.ts`      | Telas/janelas e thumbnails               |
| Janela ativa          | unidade | `src/main/capture/activeWindow.test.ts` | Título/processo e fallback               |
| Região                | unidade | `src/main/capture/region.test.ts`       | Seleção, cancelamento e limites          |

### 2.6 Ações e auditoria

| Módulo               | Tipo    | Arquivo                               | Critério                                  |
| -------------------- | ------- | ------------------------------------- | ----------------------------------------- |
| Catálogo de apps     | unidade | `src/main/actions/appCatalog.test.ts` | Allowlist e normalização                  |
| Operações de arquivo | unidade | `src/main/actions/fileOps.test.ts`    | Plano, origem/destino, journal            |
| Leitura de arquivo   | unidade | `src/main/actions/readFile.test.ts`   | Limite, caminho permitido, erro           |
| Processos            | unidade | `src/main/actions/processes.test.ts`  | Fechar sem forçar, forçar, `blocked`      |
| Busca local          | unidade | `src/main/actions/search.test.ts`     | Raízes, limite e timeout                  |
| Sistema/energia      | unidade | `src/main/actions/system.test.ts`     | Comando fixo, confirmação, falha          |
| UIA                  | unidade | `src/main/actions/uia.test.ts`        | 1/2 s, árvore, negação                    |
| Tools de ação        | unidade | `src/main/actions/tools.test.ts`      | Pausa global e confirmação                |
| Auditoria            | unidade | `src/main/audit/actions.test.ts`      | JSONL, `safeArgs`, hash, rotação, 90 dias |
| Rotinas              | unidade | `src/main/routines/scheduler.test.ts` | Agendamento, limite e erro                |

### 2.7 Memória

| Módulo                  | Tipo     | Arquivo                                                 | Critério                                                        |
| ----------------------- | -------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Banco/migrações         | unidade  | `src/main/memory/db.test.ts`                            | Schema 1->2, WAL, banco inválido                                |
| Repositório             | unidade  | `src/main/memory/repository.test.ts`                    | CRUD, FTS, arquivo, `VACUUM`                                    |
| Recuperação             | unidade  | `src/main/memory/retrieve.test.ts`                      | BM25, recência, orçamento 1.200                                 |
| Consolidação            | unidade  | `src/main/memory/consolidate.test.ts`                   | Expirada, duplicata, decay, arquivo, limite                     |
| Extração                | unidade  | `src/main/memory/extract.test.ts`                       | 5 candidatos, confiança, sensível, duplicata                    |
| Export/import           | unidade  | `src/main/memory/exportImport.test.ts`                  | JSON, 16 MB, versão, duplicata, transcrição opcional            |
| Privacidade             | unidade  | `src/main/memory/privacy.test.ts`                       | Pausa sem apagar, `removeAll`, `VACUUM`, auditoria sem conteúdo |
| Estatísticas            | unidade  | `src/main/memory/stats.test.ts`                         | Contagens, bytes aproximados, manutenção                        |
| Tela de memória         | UI/jsdom | `src/renderer/src/settings/memory/MemoryPanel.test.tsx` | Listar, editar, apagar, apagar tudo, pausar                     |
| Ciclo de vida dos dados | unidade  | `src/main/security/data-lifecycle.test.ts`              | Banco/logs/auditoria/cache, `VACUUM`, retenção, reinício        |

### 2.8 Pesquisa web

| Módulo            | Tipo    | Arquivo                             | Critério                           |
| ----------------- | ------- | ----------------------------------- | ---------------------------------- |
| Resposta e fontes | unidade | `src/main/search/answer.test.ts`    | Citações, sem fonte, merge         |
| Cache             | unidade | `src/main/search/cache.test.ts`     | TTL, limite 50, limpeza            |
| Extração          | unidade | `src/main/search/extract.test.ts`   | Texto legível, script fora         |
| Fetch             | unidade | `src/main/search/fetchPage.test.ts` | SSRF, IP privado, tamanho, timeout |
| Tool de fetch     | unidade | `src/main/search/fetchTool.test.ts` | Erro estruturado e limite          |
| Injeção por web   | unidade | `src/main/search/injection.test.ts` | Conteúdo é dado, não instrução     |
| Limites por turno | unidade | `src/main/search/limits.test.ts`    | 3/5/30 s, quota, reset por turno   |

### 2.9 Overlay

| Módulo            | Tipo    | Arquivo                                  | Critério                                      |
| ----------------- | ------- | ---------------------------------------- | --------------------------------------------- |
| Janela do overlay | unidade | `src/main/overlay/overlayWindow.test.ts` | Transparente, foco, clique, bounds, navegação |
| Monitores         | unidade | `src/main/overlay/displays.test.ts`      | WorkArea, DPI, fallback                       |
| Geometria         | unidade | `src/main/overlay/geometry.test.ts`      | Posições, offset e clamp                      |
| Primeiro plano    | unidade | `src/main/overlay/foreground.test.ts`    | Título/processo e falha                       |
| Interatividade    | unidade | `src/main/overlay/interactive.test.ts`   | Entrar/sair do avatar, reset                  |
| Atalho            | unidade | `src/main/overlay/shortcut.test.ts`      | Registro, conflito, unregister                |

### 2.10 Shared

| Módulo     | Tipo    | Arquivo                                                               | Critério                               |
| ---------- | ------- | --------------------------------------------------------------------- | -------------------------------------- |
| IPC        | unidade | `src/shared/ipc.test.ts`                                              | Prefixos e canais únicos               |
| Permissões | unidade | `src/shared/permissions.test.ts`                                      | Defaults, pausa, `effectivePermission` |
| Tela       | unidade | `src/main/capture/privacy.test.ts`, `src/main/capture/region.test.ts` | Modos, blocklist, região e teclas      |
| Pesquisa   | unidade | `src/shared/search.test.ts`                                           | Allowlist http/https                   |
| Tema       | unidade | `src/shared/theme.test.ts`                                            | Normalização, presets, cores           |
| Presets    | unidade | `src/shared/theme-presets.test.ts`                                    | Presets válidos                        |
| Overlay    | unidade | `src/shared/overlay.test.ts`                                          | Layout, faixas, atalho                 |
| Avatar     | unidade | `src/shared/avatar.test.ts`                                           | Estados e nível                        |
| Voz        | unidade | `src/shared/voice.test.ts`                                            | Razões e normalização                  |
| Contraste  | unidade | `src/shared/contrast.test.ts`                                         | WCAG AA dos tokens                     |
| Versão     | unidade | `src/shared/version.test.ts`                                          | Fonte única e sem versão hardcoded     |

### 2.11 Renderer (unitário/jsdom)

| Módulo                   | Tipo     | Arquivo                                                            | Critério                           |
| ------------------------ | -------- | ------------------------------------------------------------------ | ---------------------------------- |
| Áudio (PCM)              | unidade  | `src/renderer/src/audio/pcm.test.ts`                               | Conversão 16 kHz e base64          |
| Áudio (dispositivos)     | unidade  | `src/renderer/src/audio/devices.test.ts`                           | Lista e fallback                   |
| Áudio (playback)         | unidade  | `src/renderer/src/audio/playback.test.ts`                          | Fila e volume                      |
| VAD                      | unidade  | `src/renderer/src/audio/vad.test.ts`                               | Fala/silêncio e barge-in           |
| Captura no renderer      | unidade  | `src/renderer/src/capture/grab.test.ts`                            | Frame, tamanho e erro              |
| Avatar (geometria)       | unidade  | `src/renderer/src/overlay/avatar/caterpillar.test.ts`              | Corpo, expressão, escala           |
| Avatar (material)        | unidade  | `src/renderer/src/overlay/avatar/holoMaterial.test.ts`             | Fresnel, scanline, tema            |
| Avatar (expressões)      | unidade  | `src/renderer/src/overlay/avatar/expressions.test.ts`              | Estados                            |
| Avatar (lip-sync)        | unidade  | `src/renderer/src/overlay/avatar/lipSync.test.ts`                  | Amplitude e boca                   |
| Avatar (fallback)        | unidade  | `src/renderer/src/overlay/avatar/fallback.test.ts`                 | WebGL indisponível                 |
| Avatar (perf)            | unidade  | `src/renderer/src/overlay/avatar/perf.test.ts`                     | Orçamento de partículas            |
| Avatar (render loop)     | unidade  | `src/renderer/src/overlay/avatar/renderLoop.test.ts`               | Pausa e retomada                   |
| Avatar (tema)            | unidade  | `src/renderer/src/overlay/avatar/themeAdapter.test.ts`             | Tema para material                 |
| Fronteira de tema        | unidade  | `src/renderer/src/overlay/avatar/theme-boundary.test.ts`           | Lógica não conhece tema            |
| Conversa                 | UI/jsdom | `src/renderer/src/overlay/conversation/ConversationLayer.test.tsx` | Balão, status, transcrição         |
| Campo de texto           | UI/jsdom | `src/renderer/src/overlay/conversation/TextInput.test.tsx`         | Foco temporário e Esc              |
| Configurações: navegação | UI/jsdom | `src/renderer/src/settings/Nav.test.tsx`                           | Sete abas e hash                   |
| Configurações: a11y      | UI/jsdom | `src/renderer/src/settings/a11y.test.tsx`                          | Rótulos, foco, sem chave           |
| Aparência                | UI/jsdom | `src/renderer/src/settings/debounce.test.ts`                       | Debounce/throttle                  |
| Chave                    | UI/jsdom | `src/renderer/src/settings/KeyTab.test.tsx`                        | Write-only, teto, remoção          |
| Permissões               | UI/jsdom | `src/renderer/src/settings/PermissionsTab.test.tsx`                | Categorias, confirmação, blocklist |
| Histórico                | UI/jsdom | `src/renderer/src/settings/history/HistoryPanel.test.tsx`          | Vazio, pausado, turnos             |
| Diagnóstico              | UI/jsdom | `src/renderer/src/settings/DiagnosticsTab.test.tsx`                | Copiar/exportar sem chave          |

## 3. Caminhos de erro obrigatórios

| Classe             | Onde é testada                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`             | `src/main/gemini/engine.test.ts`, `src/main/gemini/client.test.ts`                                                                           |
| `quota`            | `src/main/gemini/client.test.ts`, `src/main/gemini/usage.test.ts`, `src/main/security/cost-limits.test.ts`, `src/main/search/limits.test.ts` |
| `timeout`          | `src/main/gemini/client.test.ts`, `src/main/search/fetchPage.test.ts`, `src/main/actions/search.test.ts`                                     |
| `network`          | `src/main/gemini/live.test.ts`, `src/main/gemini/client.test.ts`                                                                             |
| `blocked`          | `src/main/actions/processes.test.ts`, `src/main/capture/privacy.test.ts`, `src/main/capture/ask.test.ts`                                     |
| `cancelled`        | `src/main/gemini/stream.test.ts`, `src/main/gemini/client.test.ts`                                                                           |
| `server`/`invalid` | `src/main/gemini/client.test.ts`, `src/main/gemini/engine-tools.test.ts`                                                                     |
| Banco inválido     | `src/main/memory/db.test.ts`, `src/main/memory/privacy.test.ts`                                                                              |
| Store inválido     | `src/main/store.test.ts`, `src/main/ipc/store.test.ts`                                                                                       |
| IPC inválido       | `src/main/security/ipc.test.ts` e os `ipc/*.test.ts`                                                                                         |

## 4. E2E e manual

| Fluxo                                       | Tipo   | Arquivo/checklist            | Critério                                                                       |
| ------------------------------------------- | ------ | ---------------------------- | ------------------------------------------------------------------------------ |
| Configurações, tema, dispositivo, overlay   | e2e    | `tests/e2e/settings.spec.ts` | App buildado, userData temporário, transporte fake, janela oculta sem encerrar |
| Acessibilidade automática                   | e2e    | `tests/e2e/a11y.spec.ts`     | Axe nas abas e overlay expandido sem violação crítica/séria                    |
| Primeira execução com chave real            | manual | `README.md`                  | Chave salva, testada, voz e barge-in                                           |
| Modos degradados (rede, dispositivo, banco) | manual | `docs/data-lifecycle.md`     | Recuperação sem tela branca                                                    |
| Ciclo de vida (apagar tudo e reiniciar)     | manual | `docs/data-lifecycle.md`     | Tela vazia após reinício                                                       |
| Desempenho idle/fps/memória                 | manual | `docs/perf-budget.md`        | Medição na máquina de referência                                               |
| Narrador do Windows e teclado               | manual | `docs/a11y-audit.md`         | Navegação completa sem armadilha                                               |
| Atualização com a Hub                       | manual | (Kolnd Hub)                  | Reinstalar/atualizar a Hub traz o Absolem novo; `%APPDATA%\absolem` preservado |

## 5. Como manter

1. Novo módulo puro de `src/main`/`src/shared` entra na cobertura pelo
   `include`; se ficar abaixo da meta, adicione teste de lógica pura em vez de
   baixar o limite.
2. Nova tela de UI entra na matriz como `UI/jsdom` ou `e2e`; não entra na meta
   de linha.
3. Todo caminho de erro novo (classificação, limite, quota ou bloqueio) precisa
   de um caso neste documento.
4. Rode `npm test`, `npm run test:coverage` e `npm run test:e2e` antes de
   atualizar a matriz; registre a data e o tempo no topo.
