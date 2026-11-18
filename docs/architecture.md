# Arquitetura do Kolnd Hub

> Visão técnica do app em `kolnd-hub/` — documenta o que **existe** no código, não o ideal.
> Para comandos de desenvolvimento e release, veja [`kolnd-hub/README.md`](../kolnd-hub/README.md);
> para regras operacionais de agentes, [`kolnd-hub/AGENTS.md`](../kolnd-hub/AGENTS.md);
> para o processo de release, [`RELEASE.md`](RELEASE.md) (nesta pasta).
>
> **Status: preliminar — pendente de revisão do usuário (tarefa 11-11.1, etapa T5).**

## 1. Visão geral

O Kolnd Hub é a central de controle do ecossistema Kolnd: inicia/para/monitora os
programas (Mark LVI, Kloud Games), gerencia a inicialização do PC, a biblioteca de
jogos (inclusive importados da Steam), o modo Big Picture (gamepad/TV) e a própria
desinstalação. É um app Electron empacotado como instalador NSIS único.

Stack (ver [`kolnd-hub/package.json`](../kolnd-hub/package.json)):

- **Electron 28** + **electron-vite 2** (build/dev HMR) + **electron-builder** (NSIS)
- **React 18** + **TypeScript 5** (modo `strict`, projetos `tsconfig.node.json` e `tsconfig.web.json`)
- **Tailwind CSS 3** + **Framer Motion** + **lucide-react**
- **electron-store 8** (config persistente) + **Vitest** (testes) + **ESLint 10** (flat config) + **Prettier**

Entry do main: `./out/main/index.js` (campo `main` do `package.json`; gerado pelo electron-vite).
O appId é `com.kolnd.hub` (`electron-builder.yml`; `app.setAppUserModelId` em `index.ts`).

## 2. Processos

```
┌─────────────────────────────── Máquina do usuário ───────────────────────────────┐
│                                                                                  │
│  ┌──────────────┐   contextBridge    ┌──────────────┐    ipcRenderer.invoke      │
│  │   RENDERER   │ ◄───────────────►  │   PRELOAD    │ ◄────── sandbox ──────┐    │
│  │  React (TSX) │   window.api.*     │  index.ts    │                       │    │
│  └──────┬───────┘                    └──────────────┘                       │    │
│         │                                                                    ▼    │
│         │ webPreferences: sandbox + contextIsolation + nodeIntegration: false     │
│         │                                                                       │
│  ┌──────▼────────────────────────────────────────────────────────────────────┐  │
│  │                            MAIN (Node/Electron)                            │  │
│  │  index.ts — janela, tray, single-instance, IPC, first-run, desinstalação   │  │
│  │  store.ts — config persistente (electron-store + migrações)                │  │
│  │  processManager.ts — launch/stop/status, eventos status-change/output      │  │
│  │  firstRun*.ts — fluxo de primeira execução                                 │  │
│  │  logger.ts — logs com rotação e redação                                    │  │
│  │  crashReporting.ts — crashReporter local (uploadToServer: false)           │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  Disco (%APPDATA%\kolnd-hub): config.json · first-run-complete.flag · logs\      │
│                               Crashpad\ (minidumps) · game-icons\ · mark-lvi\    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Main (`src/main/`)

Processo Node completo. Responsabilidades principais:

- **Janela** (`index.ts`): `frame: false` + `titleBarStyle: 'hidden'` (title bar customizada
  no renderer), 1280×800 (mín. 900×600), `show: false` → mostra em `ready-to-show`.
- **Single instance**: `app.requestSingleInstanceLock()` é pedido **antes** de qualquer
  bootstrap; sem o lock, `app.quit()` roda imediatamente e nada é tocado. Uma segunda
  instância restaura/focaliza a janela existente (ou cria uma, se ela inexistir).
- **Segurança de navegação**: `setWindowOpenHandler` nega tudo e só abre externamente
  URLs `https:`/`http:`/`mailto:` (allowlist `isAllowedExternalUrl`); `will-navigate`
  é bloqueado sempre — em dev permite apenas a origem do dev server (HMR).
- **Tray**: ícone 32×32 em `resources/tray-icon.png` (`extraResources`; sem o arquivo,
  cai numa imagem vazia + aviso no log) e menu "Abrir Kolnd Hub" / "Sair". "Abrir"
  mostra/focaliza a janela (recria se ela não existir); "Sair" marca a saída
  (`markQuitting`), chama `processManager.killAll()` + `app.quit()` e fica **inerte
  durante uma desinstalação**. O evento `window-all-closed` não encerra o app (fica na
  bandeja).
- **Fechar a janela (X/Alt+F4/close do SO)**: o handler `close` é anexado **dentro de
  `createWindow`** (em `whenReady`, antes da criação, `mainWindow` ainda é `null`). Sem
  `isQuitting()`, ele chama `event.preventDefault()` e `hide()` — vai para a bandeja, sem
  diálogo e sem encerrar. O IPC `window:close` (X da title bar customizada) faz o mesmo.
  Encerrar de verdade só pelo **Sair explícito**: Mais → Encerrar Hub (modal → IPC
  `app:shutdown` → `shutdownHub`) ou Sair da bandeja. Durante desinstalação, o close fica
  inerte (não oculta). `query-session-end`/`session-end` marcam a saída para não bloquear
  logoff/shutdown do Windows. O antigo diálogo nativo `confirmAndQuit` foi removido.
- **Instância única + `activate`** (macOS): reexibe a janela oculta na bandeja ou cria
  uma nova, se não houver nenhuma.
- **Pré-requisito de caminho**: `setBaseDir(is.dev ? process.cwd() : dirname(app.getPath('exe')))`
  — caminhos relativos da config resolvem a partir do diretório do Hub, nunca do cwd herdado.
- **Atualização do app** (`appUpdates.ts`): a cada abertura o renderer chama
  `updates:check`, que faz **um** GET na API pública do GitHub
  (`/repos/Gui-Kol/kolnd-hub/releases/latest`). O banner "Nova atualização disponível"
  compara a tag `vX.Y.Z` da release com `app.getVersion()` por **SemVer** (prerelease
  ordena antes da release correspondente; tag fora do formato não vira banner). O
  banner some só para a sessão em "Depois".
  `updates:install` reconsulta a release pelo ID, exige `.exe` de instalação **e**
  `digest` SHA-256 publicado (release sem hash só oferece a página), baixa o `.exe` para
  `%TEMP%\kolnd-hub-updates` com allowlist de host + SHA-256 do download, verifica a
  assinatura Authenticode (aceita `NotSigned` porque o projeto não assina; recusa
  `HashMismatch`, `NotTrusted` e saída ilegível) e revalida o hash do arquivo em disco
  imediatamente antes de abrir o NSIS, encerrando o Hub para liberar os arquivos.
  `updates:cancel` interrompe o download. Falha de rede é silenciosa; nenhum dado sai
  da máquina além do GET.
- **Kloud Games sempre elevado** (`kloudGames.ts`): `kloud-games:launch` usa
  `launchKloudGamesElevated()` (PowerShell `Start-Process -Verb RunAs`) em vez do
  `processManager`, em qualquer conta do Windows. O estado do app vive em
  `C:\Program Files\KLOUD_GAMES\config` (log, `apps.json`, certificados em
  `config\credentials`), que usuários comuns não conseguem escrever nem ler; sem UAC o
  app morre com `use_certificate_chain_file: Acesso negado`. Como o processo elevado não
  é filho do Hub, o status vem do `tasklist` e o `app:stop` também eleva (`taskkill`).

### Preload (`src/preload/`)

`index.ts` expõe uma única superfície — `window.api` — via `contextBridge`, com um método
por canal IPC (invocações) e helpers de assinatura/remoção para eventos
(`onStatusChanged`, `onAppOutput`, `onFirstRunProgress`…). O renderer **nunca** vê
`ipcRenderer`, `require` ou Node. `index.d.ts` tipifica `window.api` para o renderer.
O preload consome os tipos de gamepad de `src/shared/gamepad.ts` (ver §6) —
não há espelho manual; qualquer mudança nos 12 controles/índices acontece lá
e quebra os três processos em compilação, se esquecida.

### Renderer (`src/renderer/`)

React puro (sem acesso a Node/DOM do main). Estrutura:

- `components/` — Dashboard, Settings, Inicializacao (startup do PC), Biblioteca,
  Big Picture (`BigPicture*.tsx`), FirstRunInstall, Uninstall* (zona de perigo), etc.
- `hooks/` — `useGamepad.ts`, `useGamesRunning.ts`
- `lib/` — lógica pura e testável (`appsConfig.ts`, `hubConfig.ts`, `spatialNav.ts`,
  `gamepad/`, `sfx.ts`, `startup.ts`, `uninstall.ts`…). Testes Vitest co-localizados
  (`*.test.ts`).
- `config/apps.ts` — definição estática dos apps padrão do Hub.

Fallback de config no renderer: `lib/hubConfig.ts` lê/grava via IPC (`config:*`); se o
store estiver indisponível/corrompido, cai no `localStorage` (e na primeira abertura
migra o legado `localStorage` → electron-store via `config:migrate`, renomeando as
chaves antigas para `.bak`).

## 3. IPC + validação

Todo canal é `ipcMain.handle` (request/response) ou `ipcMain.on` via eventos
`webContents.send` (progresso de first-run/desinstalação, saída de processos).
Os canais são registrados por funções `register*Ipc()` chamadas em `app.whenReady()`,
mais handlers inline em `index.ts`:

| Registro                                 | Arquivo                                                                 | Canais (exemplos)                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerConfigIpc` / `registerPrefsIpc` | `store.ts`                                                              | `config:get`, `config:setApps`, `config:migrate`, `prefs:get`/`prefs:set`                                                                                                                                                             |
| `registerGamepadIpc`                     | `gamepad.ts`                                                            | `gamepad:get`/`set`/`reset`, `bigpicture:get-prefs`/`set-prefs`                                                                                                                                                                       |
| `registerFirstRunIpc`                    | `firstRunInstaller.ts`                                                  | `firstRun:start`/`cancel`/`retry-kloud-games` + eventos `firstRun:*`                                                                                                                                                                  |
| `registerWingetIpc`                      | `wingetUpdater.ts`                                                      | `winget:list-upgrades`, `winget:upgrade-one`, `winget:kill-upgrade`                                                                                                                                                                   |
| `registerTempCleanerIpc`                 | `tempCleaner.ts`                                                        | `system:clean-temp`                                                                                                                                                                                                                   |
| `registerDisplayIpc`                     | `displaySettings.ts`                                                    | `display:get`, `display:set-resolution`, `display:set-scale`, `display:confirm-change`, `display:revert-change` + evento `display:change-reverted`                                                                                    |
| `registerGamesIpc`                       | `games.ts`                                                              | `games:get`/`add`/`update`/`remove`/`launch`/`stop`/…                                                                                                                                                                                 |
| `registerSteamIpc`                       | `steamScanner.ts`                                                       | `steam:import`                                                                                                                                                                                                                        |
| `registerRemoteAccessIpc`                | `ipc/remoteAccess.ts`                                                   | `remote:status`/`public-ip`/`install-tailscale`/`open-tailscale`/`open-kloud-web`/`copy`                                                                                                                                              |
| `registerUpdatesIpc`                     | `ipc/updates.ts`                                                        | `updates:check`, `updates:install`, `updates:cancel` + evento `update:progress`                                                                                                                                                       |
| `registerUninstallIpc`                   | `uninstaller.ts` (barrel; domínio em `uninstall/{shared,kloud,hub}.ts`) | `uninstall:kloud-status`/`kloud-games`/`kloud-orphan`/`remove-kloud-service`, `uninstall:hub-status`, `uninstall:backup-data`, `uninstall:open-logs` + eventos `uninstall:progress/log/complete`                                      |
| inline em `index.ts`                     | —                                                                       | `app:launch`/`stop`/`status`/`all-status`/`logs`/`shutdown`, `kloud-games:launch`/`status`, `window:*`, `shell:*`, `system:*`, `startup:*`, `dialog:pick-path`, `diagnostic:export`, `firstRun:check`/`markComplete`, `uninstall:hub` |

**Regra de ouro: o main nunca confia no que chega por IPC, e o renderer também não confia
no main sem checagem.** Os handlers recebem os argumentos como `unknown` (ou validam de
imediato) e aplicam, conforme o canal:

- **Tipo + tamanho**: ex. `app:launch` — `appId` string ≤ 100, `command` string ≤ 4096,
  `cwd` string ≤ 1024; `shell:openPath` — string ≤ 1024; `app:stop`/`app:status`/`app:logs`
  exigem string.
- **Whitelists/enums**: `isAllowedExternalUrl` (apenas `https:`/`http:`/`mailto:`);
  categorias de app (`APP_CATEGORIES`), níveis de importância, origens de jogo, perfis de
  gamepad e índices de botão 0–15 (`normalizeButtonIndex`, rejeita 16 = Guide/Home).
- **Validadores dedicados**: `isValidId` / `isValidExePath` (`games.ts`); caminhos de ícone
  resolvidos com `resolveIconInsideGameIcons` — só aceita absoluto **dentro** de
  `%APPDATA%\kolnd-hub\game-icons`; `store.ts` normaliza tudo que entra/sai do disco
  (`normalizeAppConfigs`, `normalizeGames`, `normalizeGamepadConfig`, …).
- **Booleanos e objetos estritos**: `window:set-fullscreen` exige `boolean`;
  `setBigPicturePrefs` exige `sounds: boolean`.
- **Invariantes de fluxo**: durante desinstalação destrutiva, `app:shutdown`,
  `window:close`, o X da janela e tray "Sair" são travados (`isAnyUninstallInProgress`);
  `uninstall:hub` recusa reentrância (`uninstaller.isBusy()`).

No renderer, o reverse também vale: dados do main (status, listas, config) são tratados
como não confiáveis quanto ao formato — os normalizadores do `store.ts` existem justamente
para o caso de `config.json` corrompido/editado à mão.

## 4. Store + migrações

Configuração persistente via **electron-store** (`name: 'config'` → arquivo
`%APPDATA%\kolnd-hub\config.json`), com **schema ajv** declarado em `store.ts` e
**migrações versionadas** executadas pelo próprio electron-store
(`__internal__.migrations`, baseadas na versão do app).

Chaves do schema (`HubStoreSchema`):

| Chave                | Conteúdo                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| `apps`               | lista de `StoredAppConfig` (id, command, cwd, category, …)             |
| `startupImportance`  | `Record<string, 'critico' \| 'recomendado' \| 'opcional' \| 'inutil'>` |
| `games`              | lista de `StoredGame` (Biblioteca; `origin` steam/custom)              |
| `launchKloudOnStart` | boolean, default `false`                                               |
| `gamepad`            | `GamepadConfig \| null` (null = não configurado)                       |
| `bigPicture`         | `{ sounds: boolean }`, default `{ sounds: true }`                      |

Migrações lançadas (`migrations` em `store.ts`) — a mais recente é **`'1.9.0'`**:

- `1.0.0` — baseline (nada a fazer; defaults vêm do schema)
- `1.1.0` — normaliza `apps` (campos faltantes/`useShell`) e `startupImportance`
- `1.2.0` — garante a chave `games`
- `1.3.0` — garante o default de `launchKloudOnStart`
- `1.4.0` — garante `gamepad` (null se ausente/inválido) e `bigPicture` (`{ sounds: true }`)
- `1.5.0`/`1.6.0`/`1.7.0` — `benchmarkHistory` e `hud` (atalho/tamanho)
- `1.8.0`/`1.9.0` — `remoteAccess` (IP público e "Modo remoto")

Regras para quem mexer no store:

1. **Nunca editar uma migração já lançada.** Adicione uma nova com chave maior que
   `'1.9.0'` — clientes antigos aplicam as migrações pendentes em ordem na primeira
   abertura da versão nova.
2. Toda chave nova entra no schema **e** na migração que a introduz (com default seguro).
3. Toda leitura passa pelos `normalize*` — entrada inválida nunca derruba a leitura;
   cai no default (`store.ts` inteira segue esse padrão).
4. Se o store falhar na construção (arquivo corrompido/sem permissão), `createStore()`
   retorna `null`: GETs devolvem "vazio", SETs reportam erro e o renderer cai no
   `localStorage` — o app nunca quebra por causa do store.
5. Migração do legado `localStorage` → store acontece via IPC `config:migrate`
   (renderer envia o que tinha; main normaliza e grava; chaves antigas viram `.bak`).

## 5. First-run

Detecção (`firstRun.ts`): a ausência do flag `%APPDATA%\kolnd-hub\first-run-complete.flag`
define "primeira execução" (`isFirstRun()`). O flag é gravado com `writeFileSync(flag, '1')`
por `markFirstRunComplete()` — único uso aceito de escrita direta fora do store.

Com o flag ausente, a janela abre em modo first-run (`createWindow(true)`, query
`?first-run=1`) e o renderer mostra a tela de instalação (`FirstRunInstall.tsx`).
As etapas (`firstRunInstaller.ts`, em ordem, todas canceladas/logadas via eventos
`firstRun:progress` / `firstRun:log` / `firstRun:complete`):

```
check ─► python ─► kloud-games ─► programs ─► finalize
verificar   winget      MSI embutido   Mark LVI        marca o
python/pip  --silent    via UAC        e Kloud Games   flag e pronto
```

1. **check** — `dependencyChecker.ts` verifica Python e pip (spawnSync `--version`).
2. **python** — `silentInstaller.ts` instala via `winget` (`--silent
--accept-package-agreements`), apenas se faltar.
3. **kloud-games** — o MSI embutido (`resources/programs/kloud-games/KLOUD_GAMES.msi`)
   é instalado com `msiexec /i … /quiet /norestart`, elevado com
   `Start-Process -Verb RunAs`. **Falha aqui não bloqueia o Hub** — o MSI segue
   disponível para instalação manual.
4. **programs** — `programsDeployer.ts` verifica/implanta o Mark LVI e o Kloud Games
   (e semeia `%APPDATA%\kolnd-hub\mark-lvi` a partir do bundle, migração transparente).
5. **finalize** — grava o flag (`markFirstRunComplete`).

Em execuções seguintes, `isFirstRun()` retorna `false` e o app vai direto para o dashboard.

## 6. Big Picture

Modo TV/gamepad em tela cheia (estilo Steam Big Picture). Entrada: botão **Big Picture**
na topbar (ícone) ou no mega menu do "Mais" (`Topbar.tsx`/`MegaMenu.tsx`); sem controle
configurado, o Hub abre a configuração antes de liberar a home.

- **Tela cheia**: IPC `window:set-fullscreen` usa `setFullScreen` (NÃO `maximize`, NÃO
  `kiosk`) — Alt+F4 oculta a janela para a bandeja (como o X), sem encerrar. Os bounds da janela são guardados antes de
  entrar e restaurados no `leave-full-screen` (janelas maximizadas ficam fora dessa
  restauração).
- **Gamepad**: `hooks/useGamepad.ts` (detecção/leitura via Gamepad API), `lib/gamepad/`
  (`profiles.ts` — xbox/playstation/switch/generic, `detect.ts`, `types.ts` — re-export
  dos tipos canônicos de `src/shared/gamepad.ts`, única fonte para main/preload/renderer).
- **Navegação espacial**: `lib/spatialNav.ts` (`nearestInDirection`) — calcula o focável
  mais próximo por direção (semiplano + ângulo de desvio, desempate por eixo
  perpendicular). Função pura, coberta por testes.
- **Componentes**: `BigPicture.tsx` (shell), `BigPictureGames` (grade da biblioteca),
  `BigPictureRail`, `BigPictureSettings`, `BigPictureFocus`, `BigPictureControls`,
  `BigPictureTransition`.
- **Persistência**: chaves `gamepad` (mapeamento por perfil) e `bigPicture`
  (`{ sounds }`) no store — migração **`'1.4.0'`**. `null` em `gamepad` = "não
  configurado"; índice de botão 16 (Guide/Home) é rejeitado de propósito.
- **Saída**: "Sair do Big Picture" no rail, **B** na raiz ou **Esc**.

## 7. Tray e desinstalação

**Tray** (`createTray` em `index.ts`): ícone em `resources/tray-icon.png`, tooltip
"Kolnd Hub", menu **Abrir Kolnd Hub** (show/focus; recria a janela se ela não existir) e
**Sair** (`markQuitting` + `killAll` + `quit`; inerte durante desinstalação). Fechar a
janela pelo X/Alt+F4 **oculta para a bandeja** (sem diálogo, ver §2) — o
`window-all-closed` não encerra o processo.

**Desinstalação** — dois fluxos, ambos em Configurações → "Zona de perigo", ambos exigem
confirmação digitada (`KLOUD_GAMES` / `Kolnd Hub`, case-insensitive):

1. **Kloud Games** — o MSI é per-machine: `msiexec /x {ProductCode} /qn /norestart` via
   PowerShell elevado (`-Verb RunAs`). O Hub encerra o `KLOUD_GAMES.exe` antes (duas
   tentativas); se não conseguir, o MSI não é chamado. Remove programa, serviço
   `KLOUD_GAMESsvc`, regras de firewall, PATH e atalhos.
2. **Kolnd Hub** (só no app empacotado, com desinstalador NSIS presente) — sequência em
   `runHubUninstallSteps` (`uninstall/hub.ts`; re-exportado pelo barrel `uninstaller.ts`):
   1. resolve o desinstalador NSIS (se não achar, nada é apagado e o erro aparece na hora);
   2. roda o fluxo do Kloud Games (UAC) — se falhar/UAC negado, pausa:
      "Desinstalar só o Hub?" ou "Cancelar";
   3. dispara o desinstalador NSIS **desanexado** e o Hub se encerra
      (`killAll` + `destroy` + `app.quit`). Se o spawn falhar, nada é apagado e o erro
      aparece com a instrução de desinstalar pelo Windows;
   4. **wipe opcional** (irreversível, só se escolhido), depois do spawn confirmado:
      apaga `%APPDATA%\kolnd-hub` item a item, tolerando falhas individuais (listadas
      no final).

O NSIS está configurado com `deleteAppDataOnUninstall: false`
(`electron-builder.yml`) — o desinstalador do Windows **não** apaga `%APPDATA%\kolnd-hub`
(config, flag de first-run, logs, `mark-lvi\` sobrevivem por padrão), mas **sempre remove
o diretório de instalação inteiro** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), incluindo
`resources\programs\MarkLVI\` com os dados que o `MarkLVI.exe` grava ao lado de si
(mitigado pelo espelho parcial em `%APPDATA%\kolnd-hub\mark-lvi`, mantido a cada boot
pelo `programsDeployer`). Durante qualquer desinstalação destrutiva, o tray, o X da
janela e o `app:shutdown` ficam travados (`lockMainWindowForUninstall` /
`isAnyUninstallInProgress`).

## 8. Segurança

- **Isolamento**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`;
  preload expõe só `window.api` tipado (`src/preload/index.d.ts`).
- **CSP** no `index.html`: `default-src 'self'; script-src 'self'; object-src 'none';
base-uri 'none'; form-action 'none'` (estilos/imagens permitem `'unsafe-inline'`/`data:`).
- **Navegação**: `will-navigate` bloqueado (dev: só origem do dev server);
  `window.open` sempre negado, abrindo no navegador só `https:`/`http:`/`mailto:`.
- **Single instance**: segunda instância nunca toca no disco nem no IPC.
- **Crash reporting local** (`crashReporting.ts`, primeiro import do main):
  `crashReporter.start({ uploadToServer: false, submitURL: '', compress: true })` — nada
  sai da máquina; minidumps ficam em **`%APPDATA%\kolnd-hub\Crashpad`**. Exceção não
  capturada no main: loga `[CRASH]` e encerra com código 1; rejeição não tratada: loga e
  continua; `render-process-gone`/`child-process-gone` são logados.
- **Logger** (`logger.ts`): arquivo `%APPDATA%\kolnd-hub\logs\kolnd-hub.log`, rotação por
  tamanho (5 MB, mantém 2 antigos), nível mínimo `info` (debug só com
  `KOLND_HUB_LOG_LEVEL=debug`), **redação** de comandos e segredos em `info+`
  (`command=`/`argv=`/`password=`/`token=`… → `[redigido]`). Falha de disco nunca derruba
  o app. Use `logger.*` no main — não `console.*`.
- **Diagnóstico** (`diagnostic.ts`, IPC `diagnostic:export`): relatório em texto pt-BR
  copiado para a área de transferência — versões, contagens do store, últimas 200 linhas
  de log; **nunca** comandos, cwd, URLs, nomes de jogos nem segredos (tudo passa por
  `redactSecrets`). Nada é enviado a lugar nenhum.
- **Processos filhos**: `app:launch` roda por padrão via **shell (cmd.exe)** —
  `shell: true` é o default intencional (preserva aspas/argumentos); `shell: false`
  separa argv e executa sem interpretação. `execFileSync` no main (ex.:
  `startupManager.ts` com `reg query`) bloqueia o event loop — evite em código novo.
- **Shell externo**: `shell:openExternal` com allowlist de esquemas; `shell:openPath`
  com caminho validado (≤1024, `resolvePath` para `%VAR%`/relativos).
- **Artefato elevado**: nunca em diretório gravável pelo usuário. O helper de FPS que
  roda `HIGHEST` no logon fica em `%ProgramData%\Kolnd Hub\fps\bin` (ACL: Usuários só
  `RX`, sem herança) e só é copiado após conferir o **SHA-256**; a elevação vai por
  `-EncodedCommand` — nada de `.ps1` em `%APPDATA%` esperando o UAC.

## 9. Mapa de arquivos

| Assunto                                 | Arquivo                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bootstrap / janela / tray / IPC inline  | `kolnd-hub/src/main/index.ts`                                                                                                                                |
| Crash reporting                         | `kolnd-hub/src/main/crashReporting.ts`                                                                                                                       |
| Store + migrações                       | `kolnd-hub/src/main/store.ts`                                                                                                                                |
| Logger                                  | `kolnd-hub/src/main/logger.ts`                                                                                                                               |
| First-run (flag/fluxo)                  | `kolnd-hub/src/main/firstRun.ts`, `firstRunInstaller.ts`                                                                                                     |
| Dependências (python/pip)               | `kolnd-hub/src/main/dependencyChecker.ts`                                                                                                                    |
| Instalação silenciosa                   | `kolnd-hub/src/main/silentInstaller.ts`                                                                                                                      |
| Implantação de programas                | `kolnd-hub/src/main/programsDeployer.ts`                                                                                                                     |
| Gerenciamento de processos              | `kolnd-hub/src/main/processManager.ts`, `processKiller.ts`, `commandLine.ts`                                                                                 |
| Jogos / Steam                           | `kolnd-hub/src/main/games.ts`, `steamScanner.ts`                                                                                                             |
| Kloud Games (estado + abertura elevada) | `kolnd-hub/src/main/kloudGames.ts`                                                                                                                           |
| Startup do PC                           | `kolnd-hub/src/main/startupManager.ts`                                                                                                                       |
| Desinstalação                           | `kolnd-hub/src/main/uninstaller.ts` (barrel), `uninstall/shared.ts`, `uninstall/kloud.ts`, `uninstall/hub.ts`, `uninstallDetection.ts`, `uninstallVerify.ts` |
| Diagnóstico                             | `kolnd-hub/src/main/diagnostic.ts`                                                                                                                           |
| Tela (escala/resolução/Hz)              | `kolnd-hub/src/main/displaySettings.ts`, `src/shared/display.ts`                                                                                             |
| Preload (`window.api`)                  | `kolnd-hub/src/preload/index.ts` (+ `index.d.ts`)                                                                                                            |
| Big Picture (nav. espacial)             | `kolnd-hub/src/renderer/src/lib/spatialNav.ts`                                                                                                               |
| Gamepad (perfis/detecção)               | `kolnd-hub/src/renderer/src/lib/gamepad/`                                                                                                                    |
| Tipos compartilhados (gamepad)          | `kolnd-hub/src/shared/gamepad.ts`                                                                                                                            |
| Fallback de config                      | `kolnd-hub/src/renderer/src/lib/hubConfig.ts`                                                                                                                |
| Build                                   | `kolnd-hub/electron.vite.config.ts`, `electron-builder.yml`                                                                                                  |
| Testes                                  | `kolnd-hub/vitest.config.ts` (co-localizados, `src/**/*.test.ts(x)`)                                                                                         |

Documentos relacionados: [`kolnd-hub/README.md`](../kolnd-hub/README.md) (comandos,
qualidade/CI, primeira execução, desinstalação), [`kolnd-hub/AGENTS.md`](../kolnd-hub/AGENTS.md)
(regras para agentes), [`RELEASE.md`](RELEASE.md) (release), `../kloud-games/AGENTS.md` e
`../Mark-LVI/AGENTS.md` (outros componentes do monorepo).
