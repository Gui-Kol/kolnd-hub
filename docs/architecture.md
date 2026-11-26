# Arquitetura do Kolnd Hub

> Visão técnica do app em `kolnd-hub/` — documenta o que **existe** no código, não o ideal.
> Para comandos de desenvolvimento e release, veja [`kolnd-hub/README.md`](../kolnd-hub/README.md);
> para regras operacionais de agentes, [`kolnd-hub/AGENTS.md`](../kolnd-hub/AGENTS.md);
> para o processo de release, [`RELEASE.md`](RELEASE.md) (nesta pasta).
>
> **Status: preliminar — pendente de revisão do usuário (tarefa 11-11.1, etapa T5).**

## 1. Visão geral

O Kolnd Hub é a central de controle do ecossistema Kolnd: inicia/para/monitora os
programas (Mark LVII, Kloud Games), gerencia a inicialização do PC, a biblioteca de
jogos (Steam, Epic Games e Minecraft Launcher), o modo Big Picture (gamepad/TV) e a própria
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
│                               Crashpad\ (minidumps) · game-icons\                │
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
- `hooks/` — `useGamepad.ts`, `useGamesRunning.ts`, `useGuideButtonShortcut.ts`
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

| Registro                                 | Arquivo                                                                        | Canais (exemplos)                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerConfigIpc` / `registerPrefsIpc` | `store.ts`                                                                     | `config:get`, `config:setApps`, `config:migrate`, `prefs:get`/`prefs:set`                                                                                                                                                             |
| `registerGamepadIpc`                     | `gamepad.ts`                                                                   | `gamepad:get`/`set`/`reset`, `bigpicture:get-prefs`/`set-prefs`                                                                                                                                                                       |
| `registerFirstRunIpc`                    | `firstRunInstaller.ts`                                                         | `firstRun:start`/`cancel`/`retry-kloud-games` + eventos `firstRun:*`                                                                                                                                                                  |
| `registerWingetIpc`                      | `wingetUpdater.ts`                                                             | `winget:list-upgrades`, `winget:upgrade-one`, `winget:kill-upgrade`                                                                                                                                                                   |
| `registerTempCleanerIpc`                 | `tempCleaner.ts`                                                               | `system:clean-temp`                                                                                                                                                                                                                   |
| `registerRamMonitorIpc`                  | `ramMonitor.ts`                                                                | `ram:info`                                                                                                                                                                                                                            |
| `registerRamOptimizerIpc`                | `ramOptimizer.ts`                                                              | `ram:optimize`, `ram:purge-standby`                                                                                                                                                                                                   |
| `registerRamAutoIpc`                     | `ramAutoOptimizer.ts`                                                          | `ram:auto-get`, `ram:auto-set`                                                                                                                                                                                                        |
| `registerDisplayIpc`                     | `displaySettings.ts`                                                           | `display:get`, `display:set-resolution`, `display:set-scale`, `display:confirm-change`, `display:revert-change` + evento `display:change-reverted`                                                                                    |
| `registerGamesIpc`                       | `games.ts`                                                                     | `games:get`/`add`/`update`/`remove`/`launch`/`stop`/…                                                                                                                                                                                 |
| `registerGameImportIpc`                  | `gameImport.ts` (+ `steamScanner.ts`, `epicScanner.ts`, `minecraftScanner.ts`) | `games:import-all`                                                                                                                                                                                                                    |
| `registerRemoteAccessIpc`                | `ipc/remoteAccess.ts`                                                          | `remote:status`/`get-mode`/`set-mode`/`public-ip`/`install-zerotier`/`open-zerotier`/`set-zerotier-open`/`open-kloud-web`/`copy`                                                                                                      |
| `registerUpdatesIpc`                     | `ipc/updates.ts`                                                               | `updates:check`, `updates:install`, `updates:cancel` + evento `update:progress`                                                                                                                                                       |
| `registerUninstallIpc`                   | `uninstaller.ts` (barrel; domínio em `uninstall/{shared,kloud,hub}.ts`)        | `uninstall:kloud-status`/`kloud-games`/`kloud-orphan`/`remove-kloud-service`, `uninstall:hub-status`, `uninstall:backup-data`, `uninstall:open-logs` + eventos `uninstall:progress/log/complete`                                      |
| inline em `index.ts`                     | —                                                                              | `app:launch`/`stop`/`status`/`all-status`/`logs`/`shutdown`, `kloud-games:launch`/`status`, `window:*`, `shell:*`, `system:*`, `startup:*`, `dialog:pick-path`, `diagnostic:export`, `firstRun:check`/`markComplete`, `uninstall:hub` |

### Acesso remoto (ZeroTier)

`remoteAccess.ts` lê `zerotier-cli -j info|listnetworks`, `sc.exe query ZeroTierOneService` e
`tasklist` da GUI **em paralelo** (timeout curto, sempre `execFile` assíncrono — nada de
`execFileSync`). O selo do card combina serviço + janela: **Aberto**, **Aberto em segundo
plano**, **Fechado**, **Não instalado**; o estado de rede existente (Conectado/Sem rede/Acesso
negado…) continua separado. `remote:set-zerotier-open` recebe `unknown`, valida boolean e
abre/fecha pelo `setZeroTierOpen`: abrir liga o serviço (se parado) e a GUI oficial; fechar
encerra a GUI (best-effort, sem elevação) e para o serviço. A elevação vai por
`Start-Process powershell -Verb RunAs -Wait -PassThru` com `-EncodedCommand`; UAC recusado vira
`cancelled: true` e a ação sempre devolve `info` relida. A instalação continua sendo winget **no
clique** (o card instala e re-tenta quando o main responde `zerotier-missing`); o tutorial
PC/celular só mostra IPs e ID da rede vindos de `remote:status`.
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

| Chave                | Conteúdo                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `apps`               | lista de `StoredAppConfig` (id, command, cwd, category, …)               |
| `startupImportance`  | `Record<string, 'critico' \| 'recomendado' \| 'opcional' \| 'inutil'>`   |
| `games`              | lista de `StoredGame` (Biblioteca; `origin` steam/epic/minecraft/custom) |
| `launchKloudOnStart` | boolean, default `false`                                                 |
| `gamepad`            | `GamepadConfig \| null` (null = não configurado)                         |
| `bigPicture`         | `{ sounds: boolean }`, default `{ sounds: true }`                        |

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

## 4.1 Registro de uso local

O Hub grava eventos reais de uso em **JSONL local**, um arquivo por dia:
`%APPDATA%\kolnd-hub\logs\usage-AAAA-MM-DD.jsonl` (data local). A lista de
eventos é fechada: `session-start`/`session-end` (com a duração da sessão),
`page-view`, `app-launch`/`app-stop`, `game-launch` e `action`
(exportar/importar configuração).

- **Privacidade:** só ids, nomes exibidos, página e duração. Nunca linha de
  comando, caminho de executável, IP, URL, token ou título de janela. Nada sai
  da máquina — o registro não entra no `diagnostic:export`.
- **Preferências:** chave `usageLog` (`{ enabled, retentionDays }`, retenção
  ∈ `{7, 30, 90}`, padrão 30) no electron-store, migração `1.11.0`. Desligado =
  nenhum evento novo é gravado.
- **Retenção:** a poda roda na troca de dia e apaga somente arquivos
  `usage-YYYY-MM-DD.jsonl`; `kolnd-hub.log*` nunca é tocado. Acima de 2 MB no
  arquivo do dia, o dia para de anexar (um aviso no log).
- **Escrita best-effort** (`src/main/usageLog.ts`): falha de disco nunca lança
  nem derruba o app.
- **IPC** `usage:read|summary|export|clear|page-view` valida tudo; exportar
  JSON/CSV usa o diálogo nativo e limpar apaga só os arquivos do registro.
- **UI:** Configurações → Registro de uso (ver/filtrar/exportar/limpar).

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
verificar   winget      MSI embutido   Mark LVII        marca o
python/pip  --silent    via UAC        e Kloud Games   flag e pronto
```

1. **check** — `dependencyChecker.ts` verifica Python e pip (spawnSync `--version`).
2. **python** — `silentInstaller.ts` instala via `winget` (`--silent
--accept-package-agreements`), apenas se faltar.
3. **kloud-games** — o MSI embutido (`resources/programs/kloud-games/KLOUD_GAMES.msi`)
   é instalado com `msiexec /i … /quiet /norestart`, elevado com
   `Start-Process -Verb RunAs`. **Falha aqui não bloqueia o Hub** — o MSI segue
   disponível para instalação manual.
4. **programs** — `programsDeployer.ts` verifica/implanta o Mark LVII (bundle em
   `resources/programs/MarkLVII`) e o Kloud Games.
5. **finalize** — grava o flag (`markFirstRunComplete`).

Em execuções seguintes, `isFirstRun()` retorna `false` e o app vai direto para o dashboard.

## 6. Big Picture

Modo TV/gamepad em tela cheia (estilo Steam Big Picture). Entrada: botão **Big Picture**
na topbar (ícone) ou no mega menu do "Mais" (`Topbar.tsx`/`MegaMenu.tsx`) e, com a janela
em foco, o botão **PS/Guide** (índice 16) do controle; sem controle configurado, o Hub abre
a configuração antes de liberar a home.

- **Tela cheia**: IPC `window:set-fullscreen` usa `setFullScreen` (NÃO `maximize`, NÃO
  `kiosk`) — Alt+F4 oculta a janela para a bandeja (como o X), sem encerrar. Os bounds da janela são guardados antes de
  entrar e restaurados no `leave-full-screen` (janelas maximizadas ficam fora dessa
  restauração).
- **Gamepad**: `hooks/useGamepad.ts` (detecção/leitura via Gamepad API), `lib/gamepad/`
  (`profiles.ts` — xbox/playstation/switch/generic, `detect.ts`, `types.ts` — re-export
  dos tipos canônicos de `src/shared/gamepad.ts`, única fonte para main/preload/renderer).
- **Atalho PS/Guide**: `hooks/useGuideButtonShortcut.ts` faz poll de 150 ms em
  `navigator.getGamepads()` e chama o mesmo `enterBigPicture` do shell normal somente na
  borda de pressão do índice 16 e com `document.hasFocus()` verdadeiro — janela em segundo
  plano/minimizada nunca abre o modo. O primeiro poll após (re)armar é silencioso (prime),
  então segurar o PS ao sair do Big Picture não o reabre; o detector puro
  (`lib/gamepad/guideButton.ts`) ignora pads que não exponham o índice 16. Detecção apenas:
  o mapeamento das 12 ações continua proibindo o 16.
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
- **Limitações do atalho PS/Guide**: controles cujo driver não expõe o índice 16 ao
  Chromium (alguns modelos/bluetooth) não têm o atalho, e a **Barra de Jogos** do Windows
  pode interceptar o botão e roubar o foco — nesses casos o botão da topbar continua sendo
  a entrada.

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
(config, flag de first-run e logs sobrevivem por padrão), mas **sempre remove
o diretório de instalação inteiro** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), incluindo
`resources\programs\MarkLVII\` com os dados que o `MarkLVII.exe` grava ao lado de si
(chave de API e memória — não há espelho em `%APPDATA%`). Durante qualquer desinstalação destrutiva, o tray, o X da
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
  separa argv e executa sem interpretação. `execFileSync` no main (ex.: as mutações de
  inicialização em `startupManager.ts`) bloqueia o event loop — evite em código novo.
- **Listagem de processos do sistema** (`startupManager.ts`): um único `powershell.exe`
  persistente por sessão (stdin/stdout com prefixo `KOLND-RESULT`, 1 consulta em voo,
  timeout de 15 s com kill/respawn, morre quando o stdin fecha) roda
  `Get-CimInstance Win32_Process` — com anti-cheat ativo o antigo `Get-Process … Path`
  levava ~5 s abrindo handle em cada processo. `listRunningProcesses()` é assíncrona,
  tem cache de 5 s e o renderer consulta a cada 10 s (60 s com a janela na bandeja);
  **nenhum spawn periódico**. `listStartupItems()` é assíncrona (2 `execFile` em
  paralelo) e não segura a tela de loading.
- **Shell externo**: `shell:openExternal` com allowlist de esquemas; `shell:openPath`
  com caminho validado (≤1024, `resolvePath` para `%VAR%`/relativos).
- **Artefato elevado**: nunca em diretório gravável pelo usuário. O agente de sensores
  (`KolndHubSensorsAgent`) copia para `%ProgramData%\Kolnd Hub\sensors\agent` o helper do
  PawnIO e o script persistente (ACL: Usuários só `RX`, sem herança) e confere o **SHA-256**
  de cada cópia antes de rodar; a elevação vai por `-EncodedCommand` — nada de `.ps1` em
  `%APPDATA%` esperando o UAC.

## 9. Sensores elevados

- **Monitor sem privilégio (`src/main/hwmon/`)**: o polling compartilhado (aba Monitor e HUD)
  faz as consultas caras (CIM dinâmico/estático e NVML) em **um** `powershell.exe` persistente
  por sessão (`collector.ts`), criado na primeira coleta. A `CimSession` é aberta uma vez, o
  assembly C#/`nvml.dll` é carregado uma vez e os jobs `cim-dynamic`, `static` e `nvml` respondem
  por linha (`KOLND-HWM <id> <json>`), com 1 request em voo e timeout de 2 s (8 s nas primeiras
  respostas, que incluem sessão/`Add-Type`). O `nvidia-smi` continua sendo a fonte de
  uso/temperatura/energia da GPU. O corpo CIM é o mesmo nos dois caminhos (`cimScripts.ts`); após
  2 falhas seguidas o main desiste do helper e volta ao processo por tick até o fim da sessão.
  `stopHwCollector()` no `will-quit` fecha o stdin, agenda o kill de segurança (1 s) e não deixa
  órfãos. `nvml.ts` mantém `readNvmlFanDirect` como fallback e `nativeSensors.ts` mantém o caminho
  `runFile` quando o coletor está desativado.
- **Cadência por consumidor e pausa automática**: o polling é um só, com refcount separado por
  tipo (`monitor` via `hwmon:start`/`hwmon:stop`, `hud` via visibilidade da sobreposição). Com a
  aba Monitor montada vale o intervalo escolhido (100–2000 ms); com só o HUD ativo o timer usa
  `max(intervalo, HUD_PUSH_MIN_INTERVAL_MS = 1000)` e o push `hud:update` é limitado a 1 Hz
  (`src/shared/hwmon.ts`). `hwmon:update` só é enviado à janela principal quando há consumidor
  `monitor`. O timer para — sem zerar o refcount — quando a janela está na bandeja sem HUD, a tela
  bloqueia (`lock-screen`) ou o PC suspende (`suspend`), e volta em `show`/`unlock-screen`/`resume`
  com uma coleta imediata antes do reagendamento. `hwmon:snapshot` (leitura avulsa) continua
  funcionando independentemente da suspensão.
- **Agente único**: a tarefa `KolndHubSensorsAgent` (logon, `HIGHEST`) roda um PowerShell
  persistente que abre o PawnIO uma vez e publica `%ProgramData%\Kolnd Hub\sensors\latest.json`
  a 1 Hz. O main só lê o arquivo (sem privilégio); amostra com mais de 3 s é stale. O script
  e a DLL vivem em `...\sensors\agent` com ACL explícita e só são copiados após o SHA-256.
- **Vcore**: os SMN do SVI2 entram no mesmo lote (`0x59800`, `0x5A008`, `0x5A00C`,
  `0x5A010`). `cpuVoltage.ts` escolhe o plano 0 pelo modelo (`+0xC` legado, `+0x10` em
  Zen 2–5) e decodifica `1,550 − 0,00625 × VID`; no Intel usa `IA32_PERF_STATUS`. Leitura
  fora de 0,3–1,8 V vira `null` (nunca estimativa). O HUD publica em `hud-cpu-voltage` e o
  Monitor em `hw-cpu-voltage`.
- **FPS removido**: a medição de FPS/frametime por ETW saiu do app (HUD, card do Monitor,
  IPCs, preload e módulo `src/main/fps/`). As sobras de máquinas antigas — tarefa
  `KolndHubFpsAgent`, processo `KolndFpsEtw.exe` e `%ProgramData%\Kolnd Hub\fps` — são limpas
  no re-estágio do agente de sensores (install e remove), e a presença delas marca o agente
  como desatualizado na UI.

## 10. Mapa de arquivos

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
| Jogos / Steam, Epic e Minecraft         | `kolnd-hub/src/main/games.ts`, `steamScanner.ts`, `epicScanner.ts`, `minecraftScanner.ts`, `gameImport.ts`                                                   |
| Kloud Games (estado + abertura elevada) | `kolnd-hub/src/main/kloudGames.ts`                                                                                                                           |
| Startup do PC                           | `kolnd-hub/src/main/startupManager.ts`                                                                                                                       |
| Desinstalação                           | `kolnd-hub/src/main/uninstaller.ts` (barrel), `uninstall/shared.ts`, `uninstall/kloud.ts`, `uninstall/hub.ts`, `uninstallDetection.ts`, `uninstallVerify.ts` |
| Diagnóstico                             | `kolnd-hub/src/main/diagnostic.ts`                                                                                                                           |
| Tela (escala/resolução/Hz)              | `kolnd-hub/src/main/displaySettings.ts`, `src/shared/display.ts`                                                                                             |
| Sensores avançados (PawnIO + agente)    | `kolnd-hub/src/main/hwmon/` (`agent.ts`, `driver.ts`, `cpuVoltage.ts`, `cpuPower.ts`)                                                                        |
| Monitor sem privilégio (CIM/NVML)       | `kolnd-hub/src/main/hwmon/` (`collector.ts`, `cimScripts.ts`, `nativeSensors.ts`, `nvml.ts`, `index.ts`)                                                     |
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
`../Mark-LVII/AGENTS.md` (outros componentes do monorepo).
