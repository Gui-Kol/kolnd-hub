# Regras para agentes trabalhando no Kolnd Hub

Este arquivo é lido por agentes (OpenCode e afins) e contribuidores antes de qualquer
mudança no app em `kolnd-hub/`. Cada regra existe porque quebrá-la produziu código que
parecia certo e falhou em silêncio. A visão técnica completa está em
[`../docs/architecture.md`](../docs/architecture.md) — leia-a antes de mexer em IPC,
store, first-run ou desinstalação.

## Stack (resumo)

Electron 28 + electron-vite 2 · React 18 + TypeScript strict · Tailwind 3 + Framer Motion ·
electron-store 8 (config) · Vitest + ESLint 10 (flat config) + Prettier. Entry:
`./out/main/index.js`. Processos: `src/main` (Node), `src/preload` (contextBridge,
sandbox), `src/renderer` (React puro, sem Node).

## Verificação obrigatória

Antes de commit/push, **sempre**:

```bash
npm run verify        # typecheck && lint && format:check && npm test — gate único
npm run verify:build  # verify + build (obrigatório se mexeu em build/empacotamento/deps)
```

Gates individuais: `npm run typecheck` (tsc nos dois projetos), `npm run lint`
(ESLint), `npm test` (Vitest), `npm run format:check` (Prettier; `npm run format`
corrige). Não há husky/lint-staged — a disciplina é de quem commita.

**"Pronto"** = `npm run verify` verde, diff só dentro do escopo da tarefa e nenhum
arquivo de código alterado quando a tarefa é docs-only.

## Nunca

- **Nunca gravar config fora do store.** Configuração persistente vive no electron-store
  (`src/main/store.ts`, `%APPDATA%\kolnd-hub\config.json`). Nada de arquivos soltos,
  `localStorage` como fonte primária ou constantes editadas à mão. Exceções existentes
  (não ampliar): a flag de first-run, o logger e o estado do Kloud Games.
- **IPC valida tudo.** Handlers recebem `unknown` e validam tipo, tamanho, formato e
  whitelists antes de usar qualquer argumento (exemplos: `isValidId`/`isValidExePath`
  em `games.ts`, `isAllowedExternalUrl` em `ipc/shell.ts`, normalizadores em `store.ts`).
  O renderer também valida o que recebe do main. Sem exceção — o renderer pode estar
  comprometido (XSS).
- **Nunca reintroduzir Playnite/SteamGridDB.** Decisão registrada no projeto; o Hub
  tem sua própria biblioteca de jogos.
- **Nunca editar uma migração de store já lançada.** Adicione uma nova com chave maior
  que `'1.4.0'` (a mais recente) — clientes antigos aplicam as pendentes em ordem.
  Chave nova entra no schema **e** na migração que a introduz.
- **Nunca usar `writeFileSync`/escrita direta fora do padrão do store sem justificativa**
  explícita no PR. O padrão de escrita do app é o electron-store; usos diretos existentes
  (flag de first-run, `kloudGames.ts`, ícones de jogos) passam por validação própria.
- **`execFileSync` no main bloqueia o event loop** (as consultas `reg query` do
  `startupManager.ts` pagam esse preço de propósito). Em código novo, prefira
  `execFile`/spawn assíncrono; só use `execFileSync` com justificativa.
- **`shell: true` não é default por acidente** — `app:launch` executa via cmd.exe para
  preservar aspas/argumentos. `useShell: false` separa argv sem interpretação. Não mude
  o default sem decisão explícita do usuário.
- **Nunca enviar nada para fora da máquina.** O crashReporter é local
  (`uploadToServer: false`) e o diagnóstico (`diagnostic:export`) é copiado para a
  área de transferência. Qualquer telemetria/envio remoto exige decisão explícita.
- **Nunca colocar um artefato elevado em diretório gravável pelo usuário.** O que roda
  como Administrador (ex.: o agente de sensores `KolndHubSensorsAgent`, tarefa `HIGHEST`)
  vive em `%ProgramData%` com ACL explícita (Usuários só `RX`) e tem o **SHA-256 conferido**
  na cópia; a elevação vai por `-EncodedCommand` — nunca um `.ps1` em `%APPDATA%` esperando o
  clique no UAC. O agente executa só a cópia protegida em `...\sensors\agent`; o script no
  perfil do usuário serve apenas de fonte para o instalador copiar.
- **Nunca `console.*` no main** — use `logger` de `src/main/logger.ts`.

## Armadilhas conhecidas do Hub

- **Logger**: `src/main/logger.ts` — `logger.info('escopo', 'mensagem', ...args)`.
  Redação automática de comandos/segredos em nível `info+`; arquivo em
  `%APPDATA%\kolnd-hub\logs\kolnd-hub.log` com rotação (5 MB × 2). Nível mínimo `info`;
  `debug` só com `KOLND_HUB_LOG_LEVEL=debug`. Falha de disco nunca derruba o app.
- **Crashpad**: minidumps em `%APPDATA%\kolnd-hub\Crashpad` (crashReporter local, ver
  `crashReporting.ts` — primeiro import do `index.ts`, antes de tudo). Exceção não
  capturada → loga `[CRASH]` e sai com código 1; rejeição não tratada → loga e continua.
- **Migrações de store**: versionadas em `store.ts` (`migrations`), aplicadas pelo
  electron-store na ordem, filtradas por `projectVersion`. Store corrompido → `createStore()`
  retorna `null` e o app cai no `localStorage` (`lib/hubConfig.ts`, fallback no renderer).
- **Single instance**: o lock é pedido antes do bootstrap; segunda instância restaura a
  janela e não toca no disco. Não remova o early-return.
- **Desinstalação trava o app**: durante o fluxo destrutivo (`isAnyUninstallInProgress`),
  tray "Sair", X da janela e `app:shutdown` ficam inertes. Respeite o travamento — nunca
  "contorne" para fechar no meio de um msiexec/wipe.
- **Primeira execução**: ausência do flag `%APPDATA%\kolnd-hub\first-run-complete.flag`
  define o modo first-run; as etapas vivem em `firstRunInstaller.ts` e uma falha do
  Kloud Games **não** bloqueia o Hub.
- **Fullscreen do Big Picture**: use `window:set-fullscreen` (`setFullScreen`), nunca
  `maximize` nem `kiosk`; bounds são restaurados no `leave-full-screen`.

## Testes

Padrão **Vitest co-localizado**: `src/**/*.test.ts(x)` ao lado do módulo testado, só
lógica pura — sem Electron, sem DOM (o `vitest.config.ts` usa `environment: 'node'` e
xclui `node_modules`/`out`/`dist`/`resources`). Ao alterar comportamento, adicione ou
atualize o teste correspondente. Limiares de cobertura em `vitest.config.ts` são
informativos (CI não reprova por eles). Componentes React e preload não têm testes hoje —
não assuma cobertura de UI.

## Estilo

Prettier manda: sem semicolons, aspas simples, `printWidth` 100, LF. ESLint flat config —
`catch {}` vazio é intencional (`allowEmptyCatch`) e `_`-prefix marca argumento não usado.
Comentários em pt-BR explicando o **porquê** (o código já diz o como). Ordem das seções
etc. seguem o arquivo vizinho — na dúvida, imite o padrão existente.

## Onde ler mais

- [`../docs/architecture.md`](../docs/architecture.md) — arquitetura (processos, IPC, store, first-run, Big Picture, segurança)
- [`README.md`](README.md) — comandos, qualidade/CI, desinstalação, solução de problemas
- [`../docs/RELEASE.md`](../docs/RELEASE.md) — release, máquina limpa, desinstalação verificada
