# ⚡ Kolnd Hub — Task Desinstalar (T1–T7): desinstalação segura do Kloud Games e do Kolnd Hub

> **Task Desinstalar · Novembro/2026** — tarefa auto-contida no mesmo formato do `plano_de_tarefas_e_prompts.md` (v2) e do `task-big-picture.md`, dedicada à **desinstalação**.
> Adiciona dois botões nas Configurações do Hub: **"Desinstalar Kloud Games"** (remove o Kloud Games de forma simples e segura, direto pelo Hub) e **"Desinstalar Kolnd Hub"** (remove o Kolnd Hub **e** desinstala o Kloud Games automaticamente durante o processo). Inclui confirmações anti-acidente, progresso ao vivo, mensagens de sucesso/erro, laudo de limpeza (arquivos, atalhos, serviço, firewall, PATH, registro e `%APPDATA%`) e validação de cenários de erro e dependências.
> Antes de começar, leia **Decisões registradas (premissas)** e **Riscos e armadilhas conhecidas**.

---

## Como usar este documento

1. **Uma tarefa por sessão de agente** (uma por vez, em ordem ou respeitando as dependências). Não envie o documento inteiro.
2. Coloque o agente na raiz do repositório (`C:\Users\TiffoDi\desenv\Kolnd Hub`) e envie: *"Leia a tarefa Tn neste arquivo e implemente exatamente o escopo descrito."*
3. O agente deve **seguir os padrões existentes do projeto** (ver "Mapa rápido do código"), não inventar arquitetura nova.
4. Depois da implementação, o agente executa a seção **Validação** da tarefa e você revisa o diff contra os **Critérios de aceitação**. Reprovou algum? Mande corrigir antes de marcar a tarefa como concluída.
5. **Branch de trabalho** (`Dev` ou similar) — nunca direto em `main` (ver README, seção de branches).

### Regras globais (definition of done de toda tarefa)
- [ ] `npx tsc --noEmit -p tsconfig.node.json` **e** `npx tsc --noEmit -p tsconfig.web.json` sem novos erros
- [ ] `npm run build` concluído com sucesso
- [ ] `npm run dev` abre o app e a feature nova funciona no fluxo manual
- [ ] Escopo respeitado (nada fora do descrito; se precisar algo fora, pergunte antes)
- [ ] Interface em **pt-BR**, linguagem amigável, sem jargão técnico para o usuário final (nome técnico só quando indispensável, sempre acompanhado de explicação simples)
- [ ] Sem adicionar dependências novas sem justificativa explícita no PR/commit
- [ ] **Nada é apagado sem confirmação explícita do usuário** — desinstalação é destrutiva por natureza; qualquer atalho nesse requisito é bug, não otimização

---

## Mapa rápido do código (âncoras reais)

| Arquivo | Papel |
|---|---|
| `kolnd-hub/src/renderer/src/components/Settings.tsx` | Configurações: cabeçalho de seções uppercase (`text-xs font-bold text-slate-600 uppercase tracking-widest mx-2`) + card `.glass rounded-2xl p-6 border-l-4 …`; seção "Ao abrir o Hub" (~linha 137), `<BigPictureSettings />` (~linha 191), "Gerenciador de títulos" (~linha 193) e nota informativa no fim (~linha 318). **A nova seção "Zona de perigo" entra no final, antes da nota** — modelar o card no padrão do toggle `launchKloudOnStart` (linhas ~26–72) e do `BigPictureSettings.tsx` |
| `kolnd-hub/src/renderer/src/components/BigPictureSettings.tsx` | Card de referência com status persistente + feedback "Salvo"/"Erro" + botões destrutivos com confirmação — **modelo visual da nova seção** |
| `kolnd-hub/src/renderer/src/App.tsx` | Estado global, roteamento **por estado** (sem router): `const [currentPage, setCurrentPage] = useState<Page>('dashboard')` (~linha 41); `handleExit` (~linha 443) já chama `window.api.shutdownHub()` e usa `setNotice(...)` com toasts — **o mesmo mecanismo de toast serve para o fim da desinstalação**; `handleLaunch` (~linha 385) |
| `kolnd-hub/src/renderer/src/components/Sidebar.tsx` | Rodapé com botão "Sair" (~75–93) e "Big Picture" (~107–117). Os botões de desinstalar **não** vão aqui — ficam nas Configurações |
| `kolnd-hub/src/main/kloudGames.ts` | Núcleo do Kloud Games: `findKloudGamesExe()` (estado salvo → pasta do Hub → Program Files), `getKloudGamesStatus()` (installed/exePath/msiPath/dir/running), `isKloudGamesRunning()` (via `tasklist`, ~linha 235), `launchInstallerElevated()` (~297, **padrão de elevação via PowerShell `Start-Process -Verb RunAs -Wait -PassThru` a reutilizar no desinstalador**), `looksLikeUacDenied()` (~281), códigos msiexec (~288: `MSIEXEC_USER_CANCEL = 1602`, `1500/1618` = outra instalação em andamento, `1704/1705` = suspensa), `appendKloudGamesLog()` (~32, loga em `%APPDATA%\kolnd-hub\logs\kloud-games-install.log`), `readKloudGamesState()`/`writeKloudGamesState()` (~82/110, `kloud-games.paths.json`) |
| `kolnd-hub/src/main/silentInstaller.ts` | `isKloudGamesInstalled()` (via `findKloudGamesExe()`) — reusável na detecção de estado |
| `kolnd-hub/src/main/index.ts` | Registro de IPCs dentro de `app.whenReady()` (~138–155); `kloud-games:launch` (~173) e `kloud-games:status` (~192) **inline**; `shutdownHub()` (~343) — `processManager.killAll()` + `mainWindow.destroy()` + `app.quit()`; `app:shutdown` (~355); `window:close`/`confirmAndQuit` (~365/383) — diálogo `dialog.showMessageBox` já usado para encerrar; padrão de elevação/saída já existente para copiar |
| `kolnd-hub/src/main/firstRunInstaller.ts` | **Modelo do fluxo assíncrono com progresso**: classe `FirstRunInstaller` (EventEmitter) emite `firstRun:progress` (`{ stepId, status: 'running'|'done'|'error', progress, message }`), `firstRun:log` e `firstRun:complete`, reenviados ao renderer via `webContents.send`; `registerFirstRunIpc()` (~300) — **copiar esse formato para `uninstall:progress`/`uninstall:log`/`uninstall:complete`** |
| `kolnd-hub/src/main/store.ts` | Persistência canônica (electron-store, `%APPDATA%/kolnd-hub/config.json`), migrações até `'1.4.0'` (package.json em 1.4.0). **Esta task não precisa de chave nova nem de migração** — o estado de desinstalação não é persistente (vive nos logs e no laudo) |
| `kolnd-hub/src/preload/index.ts` + `index.d.ts` | Objeto `api` único (~316); cada método embrulha `ipcRenderer.invoke(...)`; `index.d.ts` espelha **manualmente** — sempre atualizar os **dois** arquivos |
| `kolnd-hub/src/renderer/src/index.css` | `.glass`, `.glass-card`, `.glass-panel`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, **`.btn-danger`** (~linha 92), `.toggle-console`, `.label-panel`, `.scanlines` |
| `kolnd-hub/src/renderer/src/components/Layout.tsx` | Shell frameless; botão X no title bar (~linha 65) chama `window.api.closeWindow()` (confirmação de encerramento) — referência de como o app se protege de fechar sem querer |
| `kolnd-hub/electron-builder.yml` | `win.target: nsis`, `perMachine: false`, `allowToChangeInstallationDirectory: false`, `deleteAppDataOnUninstall: false` (**não alterar** — o NSIS nunca apaga `%APPDATA%\kolnd-hub`; quem apaga é o Hub, só por escolha explícita do usuário, ver P7) |
| `kolnd-hub/resources/programs/kloud-games/KLOUD_GAMES.msi` | MSI embutido que o **próprio Hub instala** na 1ª execução (`ensureKloudGamesInstalled()`) |
| **MSI do Kloud Games** (fonte em `kloud-games/`) | Fork do Sunshine (C++/CMake, projeto `KLOUD_GAMES`, `kloud-games/CMakeLists.txt:8`). Publicado per-machine por **WiX/cpack** com `CPACK_WIX_UPGRADE_GUID "512A3D1B-BE16-401B-A0D1-59BBA3942FB8"` (`cmake/packaging/windows_wix.cmake:40`). Instala em `C:\Program Files\KLOUD_GAMES\`; `KLOUD_GAMES.exe` + `config\` (dados do jogo ficam **ao lado do exe** — `GetModuleFileNameW` → `windows/misc.cpp:168`, usados por `config.cpp` e `apps.json`); atalhos em Menu Iniciar → **LizardByte → KLOUD_GAMES** (root + `LizardByte\KLOUD_GAMES`, ver `wix_resources/KLOUD_GAMES-installer.wxs`); registra serviço **`KLOUD_GAMESsvc`**, regras de **firewall**, **PATH**, e entradas em `HKCU\Software\LizardByte\KLOUD_GAMES`; instalação e desinstalação passam por `scripts\KLOUD_GAMES-setup.ps1 -Action uninstall` (remove firewall, desinstala o serviço, restaura prefs NVIDIA, limpa PATH) — **por isso `msiexec /x` é o único caminho correto** |
| **Desinstalador do Hub** | Gerado pelo electron-builder NSIS ao empacotar (`npm run package`): `%LOCALAPPDATA%\Programs\Kolnd Hub\Uninstall Kolnd Hub.exe`. NSIS per-user: **não exige admin**, remove atalhos (Menu Iniciar/área de trabalho) e o diretório inteiro da instalação (inclusive `resources/programs/MarkLVI` e `resources/programs/kloud-games`); **não** remove `%APPDATA%\kolnd-hub` (`deleteAppDataOnUninstall: false`) |
| `%APPDATA%\kolnd-hub\` | Dados do Hub: `config.json` (electron-store), `first-run-complete.flag` (`firstRun.ts`), `logs\` (logs de instalação Kloud Games; esta task adiciona os de desinstalação), `mark-lvi\` (dados do assistente, via `MARK_LVI_HOME`, `programsDeployer.ts`), `game-icons\` (cache de ícones da Biblioteca, `games.ts:156`) |
| Testes | `*.test.ts` **ao lado do fonte** (ex.: `src/main/wingetUpdater.test.ts`, `src/main/steamScanner.test.ts`) — Vitest |

**Estado atual (verificado):** o Hub **não tem nenhuma funcionalidade de desinstalação** — não existe botão, IPC, nem módulo. O Kloud Games só sabe ser instalado (`ensureKloudGamesInstalled()`); o desinstalador NSIS do Hub existe após empacotar mas nunca é invocado; `%APPDATA%\kolnd-hub` nunca é apagado por ninguém automaticamente; o MSI do Kloud Games faz a própria limpeza (serviço/firewall/PATH/atalhos) somente quando removido via `msiexec /x`.

**Padrão IPC ponta a ponta (obrigatório seguir):**

```
main (novo módulo, ex.: uninstaller.ts)
  └─ registerUninstallIpc() → ipcMain.handle('uninstall:kloud-games', …)   ← exportado, chamado em main/index.ts
preload/index.ts   → uninstallKloudGames: () => ipcRenderer.invoke('uninstall:kloud-games')  ← + tipos em preload/index.d.ts
renderer           → window.api.uninstallKloudGames()                       ← nunca usar Node/fs no renderer
```

Eventos (progresso) seguem o modelo do `firstRunInstaller.ts`: `webContents.send('uninstall:progress', …)` no main; no preload, `onUninstallProgress(callback)` devolve a função de remoção do listener.

**Componentes e visual:** Tailwind 3 + `framer-motion` + `lucide-react`. Sem shadcn/Radix — crie componentes próprios seguindo os existentes.

---

## Decisões registradas (premissas deste plano)

- **P1 — Local dos botões: nova seção "Zona de perigo" no final de `Settings.tsx`**, componente novo `UninstallDangerZone.tsx`, com dois cards: **Kloud Games** e **Kolnd Hub**. Nada na Sidebar, nada de página nova (`Page` não muda). Estrutura e cabeçalho no mesmo padrão das outras seções (uppercase `text-slate-600` + card `.glass … border-l-4 border-red-500/60`). Textos em pt-BR amigáveis.
- **P2 — O Kloud Games SEMPRE é desinstalado pelo MSI oficial** (`msiexec /x {ProductCode}`), nunca "na mão" (apagar `C:\Program Files\KLOUD_GAMES` não roda as custom actions → serviço, firewall, PATH e atalhos ficariam órfãos). O `{ProductCode}` é localizado por **varredura do registro** (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*`, `HKLM\SOFTWARE\WOW6432Node\…\Uninstall\*` e `HKCU\…\Uninstall\*`), casa entradas com `DisplayName` ~ `/KLOUD[\s_-]?GAMES/i` e devolve `{ productCode, displayName, displayVersion, installLocation, uninstallString, publisher }`. **Nunca usar `Win32_Product`** (reconfigura todas as apps MSI do sistema — efeito colateral grave). Sem match no registro → considerar o Kloud Games "não instalado (ou detectado só pelo exe)" e tratar como caso órfão (T6).
- **P3 — MSI é per-machine: desinstalar exige admin.** Reutilizar o padrão de `launchInstallerElevated()` do `kloudGames.ts`: PowerShell `Start-Process msiexec.exe -Verb RunAs -Wait -PassThru` com argumentos `/x "{GUID}" /qn /norestart`, saída capturada para o log, `looksLikeUacDenied()` para o caso de UAC recusado. `/qn` porque o Hub mostra a própria UI de progresso — e porque, com `UILevel <= 3`, o MSI executa só a ação silenciosa (`CA_KLOUD_GAMESUninstallSilent`, que já roda `KLOUD_GAMES-setup.ps1 -Action uninstall` escondendo firewall/serviço/PATH/NVIDIA). Em `/qn` o msiexec **não** exibe UI.
- **P4 — Antes de desinstalar, o Kloud Games não pode estar rodando.** `isKloudGamesRunning()` (`tasklist`) decide; se estiver rodando, a confirmação oferece **"Encerrar o Kloud Games e continuar"** (`taskkill /F /IM KLOUD_GAMES.exe`, com fallback elevado se acesso negado) + **"Cancelar"**. Aviso explícito: **streams Moonlight em andamento serão interrompidas**. O serviço `KLOUD_GAMESsvc` não precisa ser parado à mão — o MSI e as custom actions cuidam dele.
- **P5 — Progresso ao vivo por eventos IPC**, copiando o `FirstRunInstaller`: canais `uninstall:kloud-games`, `uninstall:hub`, `uninstall:backup-data`, `uninstall:open-logs`, `uninstall:kloud-status` (revalida estado antes de habilitar/desabilitar o botão), `uninstall:hub-status` (caminho do desinstalador/disponível). Eventos `uninstall:progress` (`{ stepId, status: 'running' | 'done' | 'error', progress: 0–100, message? }`), `uninstall:log` (linha), `uninstall:complete` (`{ success: boolean, error?, report? }`). Etapas do Kloud Games: `check` → `kill` (só quando rodando) → `msiexec` → `verify` → `cleanup` → `done`. Sem loop de polling por frames; sem `setState` por chunk.
- **P6 — "Desinstalar Kolnd Hub" é uma sequência orquestrada, com uma decisão humana por etapa que pode falhar:** (1) confirmação forte (digitar `Kolnd Hub`); (2) se o Kloud Games estiver instalado, rodar o fluxo Kloud Games **primeiro, dentro do Hub** (progresso visível); se ele falhar — ou o UAC for negado — **perguntar**: *"Não foi possível desinstalar o Kloud Games (motivo: …). Deseja desinstalar apenas o Kolnd Hub mesmo assim?"* com botões **"Desinstalar só o Hub"** / **"Cancelar tudo"** — nunca continuar em silêncio; (3) backup opcional de `%APPDATA%\kolnd-hub` (botão sempre disponível na confirmação); (4) spawn **desanexado** do desinstalador NSIS (`%LOCALAPPDATA%\Programs\Kolnd Hub\Uninstall Kolnd Hub.exe`, ou `UninstallString` do registro se o caminho padrão não existir) + `processManager.killAll()` + destroy da janela + `app.quit()` (mesmo encerramento do `shutdownHub()`). O NSIS é per-user: **não pede admin**.
- **P7 — `%APPDATA%\kolnd-hub` NUNCA é apagado por padrão.** Nem o Hub, nem o NSIS (`deleteAppDataOnUninstall: false`, que **não deve mudar**). Só é apagado se o usuário marcar explicitamente **"Apagar também meus dados e configurações (irreversível)"** na confirmação — e, antes disso, a UI **sempre** oferece **"Fazer backup dos meus dados"** (copia `%APPDATA%\kolnd-hub` → `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss` via `fs.cpSync`, mostrando o caminho do backup ao concluir). O que o wipe remove: `config.json`, `first-run-complete.flag`, `logs\`, `mark-lvi\`, `game-icons\`. A ordem é **backup primeiro, wipe depois, desinstalador por último** — o wipe acontece *antes* de gerar o spawn do desinstalador, com a lista do que será apagado registrada no log.
- **P8 — Mark LVI não é desinstalado nesta task.** Ele não tem instalador; vai embora junto com a pasta da instalação (NSIS). **Comunicar no diálogo**: *"O Mark LVI (assistente) será removido junto com a pasta do Kolnd Hub. Se você usa Mark LVI antigo com dados ao lado do executável, faça backup — eles são apagados com a pasta."* (dados atuais ficam em `%APPDATA%\kolnd-hub\mark-lvi` e seguem P7).
- **P9 — Laudo pós-desinstalação do Kloud Games, sempre visível.** Após o `msiexec`, verificar: (a) `findKloudGamesExe()` === null (revalidando depois de zerar o estado salvo); (b) serviço `KLOUD_GAMESsvc` ausente (`sc query KLOUD_GAMESsvc` → erro 1060); (c) entrada de registro ausente; (d) atalho `LizardByte\KLOUD_GAMES` ausente no Menu Iniciar; (e) `%TEMP%\KLOUD_GAMES\logs` limpo (opcional, é TEMP). O laudo é exibido no sucesso e no erro parcial ("o que foi removido / o que ainda precisa de atenção" + botão "Abrir pasta de logs"). **Sucesso parcial é resultado legítimo e deve ser dito com todas as letras**, nunca reportado como "pronto".
- **P10 — Idempotência e códigos de retorno.** `msiexec /x` retornando **1605** (produto inexistente) é tratado como sucesso ("o Kloud Games já não constava como instalado"); **1602** = cancelado pelo usuário (não é erro de sistema); **3010/1641** = sucesso com **reinício necessário** (aviso, não erro); **1618/1500** = outra instalação em andamento (orientar); **1603** = falha fatal (log + orientação); **1625** = bloqueado por política de grupo (mensagem própria); **1638** = já existe versão mais nova instalada (avisar e tratar como sucesso parcial); **1223** (via PowerShell) = UAC negado. Tabela de mapeamento **pura e testada** (`mapMsiexecExitCode(code)`), reutilizada por T2 e T6.
- **P11 — Dev ≠ instalado.** Em `!app.isPackaged`, o botão **"Desinstalar Kolnd Hub"** fica desabilitado (tooltip: "Disponível apenas no app instalado — em desenvolvimento use o gerenciador de aplicativos do Windows"). O fluxo do Kloud Games **funciona em dev** (útil para QA), com um aviso discreto na confirmação.
- **P12 — Logs próprios.** `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log` (fluxo do Kloud Games) e `%APPDATA%\kolnd-hub\logs\kolnd-hub-uninstall.log` (sequência completa do Hub, incluindo o resultado do Kloud Games e o que foi feito no wipe). Botão "Abrir pasta de logs" disponível nos estados final e de erro. Nunca apagar os logs desta task no wipe por padrão (eles são minúsculos e ajudam suporte); documentar isso.
- **P13 — O Hub não "conserta" o MSI à mão.** Nunca apagar/mover arquivos da instalação do Kloud Games diretamente; nunca `sc delete`, nunca remover regras de firewall na mão — tudo isso é trabalho das custom actions do MSI. A única sujeira tolerada e limpa pelo Hub é: `kloud-games.paths.json` regravado com `exePath: null, installedAt: null` (estado), e `%TEMP%\KLOUD_GAMES` (TEMP). Registro residual `HKCU\Software\LizardByte\KLOUD_GAMES` ou atalhos órfãos → **listar no laudo, nunca apagar às cegas**.
- **P14 — `first-run` e Big Picture não interagem.** A seção Zona de perigo pode aparecer mesmo na 1ª execução (é só Configurações); o fluxo completo roda idêntico. Não alterar `?first-run=1`, o gate do Big Picture nem `launchKloudOnStart` (a preferência "Iniciar com o Hub" permanece salva no store após desinstalar — documentar; quem decide apagá-la é o wipe de `%APPDATA%`).

---

## Dependências e ordem de execução

```
T1 (detecção pura no registro/serviços + testes)
  └─→ T2 (módulo uninstaller: elevação, msiexec, progresso por eventos + IPC + preload)
        ├─→ T3 (verificação pós-desinstalação: laudo + limpeza de estado/%TEMP%)
        └─→ T4 (UI: seção "Zona de perigo" + modais de confirmação/progresso/resultado)
              └─→ T5 (orquestração "Desinstalar Kolnd Hub": Kloud Games → backup → wipe opcional → NSIS)
T6 (matriz de erros e casos de borda) ← depende de T2–T5
T7 (README + smoke final) ← por último (depende de tudo)
```

**Ordem sugerida (T1 → T7):** T1, T2, T3, T4, T5, T6, T7.
T3 e T4 podem ser feitas em paralelo a T2 desde que a interface de `uninstaller.ts` (T2) seja fixada antes.

---

## Fase 1: Infraestrutura de desinstalação (main process)

### [ ] T1 — Detecção pura: registro, serviço e estado (Kloud Games e Hub)
**Objetivo:** criar a base **pura e testável** para descobrir o que está instalado e onde (sem Electron/UI): entradas de desinstalação no registro, estado do serviço do Kloud Games e disponibilidade do desinstalador do Hub.

**Dependências:** nenhuma.
**Arquivos-alvo:** novo `src/main/uninstallDetection.ts`; novo `src/main/uninstallDetection.test.ts`.

**Prompt para o Agente:**
> Sua tarefa (T1) é criar, em `src/main/`, a camada **pura** de detecção de instalações para os fluxos de desinstalação. **Nada de UI, IPC ou remoção aqui** — só leitura + testes (remoção é a T2).
> 1. `uninstallDetection.ts`, exportando:
>    - `export interface UninstallEntry { productCode: string | null; uninstallString: string; displayName: string; displayVersion?: string; installLocation?: string; publisher?: string; scope: 'machine' | 'user' | 'both' | 'unknown' }`
>    - `export interface KloudGamesDetection { status: 'installed' | 'partial' | 'missing'; exePath: string | null; service: 'running' | 'stopped' | 'missing'; entry: UninstallEntry | null }` — `installed` = exe e/ou registro com serviço; `partial` = exe órfão sem registro **ou** registro sem exe (instalação quebrada); `missing` = nada encontrado.
>    - `export interface HubUninstallDetection { available: boolean; uninstallerPath: string | null; source: 'default-path' | 'registry' | null; entry: UninstallEntry | null }`
>    - `export function parseUninstallEntries(json: string): UninstallEntry[]` — parse **tolerante** de `ConvertTo-Json` (array, objeto único ou vazio); filtra `DisplayName` batendo `/KLOUD[\s_-]?GAMES/i` **ou** `/^Kolnd Hub$/i` (chamar de `matchKind` interno); desembrulha `UninstallString` (remove aspas externas; se começar com `msiexec`, extrair o `{GUID}` com regex `/\{[0-9A-Fa-f-]{36}\}/`).
>    - `export function findKloudGamesUninstallEntry(): UninstallEntry | null` — consulta **HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall**, **HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall** e **HKCU\…\Uninstall** via PowerShell (`Get-ItemProperty … | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,UninstallString | ConvertTo-Json -Compress`); escolhe a melhor entrada: preferir `InstallLocation` contendo `KLOUD_GAMES`, senão `UninstallString` com `{GUID}`, senão a primeira. Falha/acesso negado/JSON inválido → `null` (**nunca** lança).
>    - `export function findHubUninstallEntry(): UninstallEntry | null` — idem, casa `DisplayName` ~ `/^Kolnd Hub$/i`, **priorizando HKCU** (NSIS per-user); `UninstallString` do NSIS já é o caminho do `.exe` — remover aspas externas.
>    - `export function findHubUninstaller(): HubUninstallDetection` — 1) caminho padrão `join(dirname(app.getPath('exe')), 'Uninstall Kolnd Hub.exe')` (via `existsSync`); 2) fallback registro (`findHubUninstallEntry` → `uninstallString` se existir no disco); 3) senão `{ available: false }`. Detalhe: o nome exato do desinstalador vem do `productName` do `package.json`/electron-builder — **não** hardcode além do fallback documentado; em dev (`!app.isPackaged`) retorna `{ available: false }`.
>    - `export function getKloudGamesServiceStatus(): 'running' | 'stopped' | 'missing'` — `sc query KLOUD_GAMESsvc` via `execFileSync` (stdout texto, `windowsHide: true`); 1060 na saída/erro → `missing`; contém `RUNNING` → `running`; senão `stopped`. Falha total → `missing`.
>    - `export function detectKloudGames(): KloudGamesDetection` — combina `findKloudGamesExe()` (importado de `./kloudGames`), `findKloudGamesUninstallEntry()` e `getKloudGamesServiceStatus()` conforme o tipo acima.
>    - `export function mapMsiexecExitCode(code: number | null): { kind: 'success' | 'cancelled' | 'already-absent' | 'needs-reboot' | 'other-install' | 'policy-blocked' | 'fatal' | 'uac-denied' | 'newer-version' | 'unknown'; message: string }` — tabela: `0` → success; `3010`, `1641` → needs-reboot; `1602` → cancelled; `1605`, `1612` → already-absent; `1618`, `1500` → other-install; `1625` → policy-blocked; `1603`, `1604`, `1609`, `1619` → fatal; `1638` → newer-version; `1223` (quando vier do wrapper PowerShell) → uac-denied; resto/null → unknown. Mensagens amigáveis pt-BR prontas para toast (ex.: `1605` → "O Kloud Games já não constava como instalado — nada foi removido.").
> 2. Testes (Vitest, ao lado do fonte): fixtures com **JSON real** de `Get-ItemProperty | ConvertTo-Json` (1 entrada, várias entradas, objeto único não-array, string vazia, JSON truncado); fixtures de `sc query` (serviço rodando, parado, 1060, saída vazia); tabela completa dos códigos msiexec (função pura → casos parametrizados); `detectKloudGames()` com `findKloudGamesExe`/registro mocados (installed/partial/missing nas três combinações possíveis).
> 3. **Não** implemente remoção/elevação/UI. Não toque em `store.ts`, `kloudGames.ts` (exceto import), `preload`.

**Critérios de aceitação:**
- [ ] `parseUninstallEntries` sobrevive às fixtures reais sem lançar (array única, objeto único, vazio, lixo)
- [ ] `findKloudGamesUninstallEntry()` devolve `{ productCode }` consistente numa máquina com o MSI instalado (rodar em dev ou via teste manual documentado — se a máquina de teste não tiver o Kloud Games instalado, o resultado esperado é `null` e isso deve ficar registrado na PR)
- [ ] `mapMsiexecExitCode` cobre 0, 1602, 1605, 1618, 1638, 3010, 1223 e código desconhecido
- [ ] `npm test` verde; `tsc` (node) sem novos erros
- [ ] Zero dependências novas; nada de `Win32_Product` em lugar nenhum do código

**Validação:** `npx vitest run src/main/uninstallDetection`; na máquina com Kloud Games instalado, logar em dev (`console.log` temporário ou script de teste manual) o resultado de `detectKloudGames()` e confirmar `status: 'installed'`, `service` correto e `productCode` presente; numa VM/máquina sem o MSI, confirmar `status: 'missing'`.

---

### [ ] T2 — Módulo `uninstaller.ts`: desinstalação do Kloud Games com elevação, progresso e IPC
**Objetivo:** implementar o fluxo real de desinstalação do Kloud Games (kill opcional → `msiexec /x` elevado → progresso ao vivo), exposto por IPC no padrão do projeto.

**Dependências:** T1 concluída.
**Arquivos-alvo:** novo `src/main/uninstaller.ts`; `src/main/kloudGames.ts` (novo `resetKloudGamesState()` + reuso de `appendKloudGamesLog`); `src/main/index.ts`; `src/preload/index.ts`; `src/preload/index.d.ts`; novo `src/main/uninstaller.test.ts` (só para `mapMsiexecExitCode` reexportado ou funções puras).

**Prompt para o Agente:**
> Sua tarefa (T2) é o fluxo **completo de desinstalação do Kloud Games** de ponta a ponta, seguindo o padrão IPC do projeto. A UI chega na T4 — aqui os eventos já devem ser emitidos corretamente.
> 1. Em `kloudGames.ts`: adicione `export function resetKloudGamesState(): boolean` — regrava `kloud-games.paths.json` com `{ exePath: null, msiPath: findKloudGamesMsi(), installedAt: null, updatedAt: <agora> }` e retorna true/false (mesmo estilo tolerante de `writeKloudGamesState`). **Não** apague o arquivo; apenas zere os campos. **Não** mexa no `ensureKloudGamesInstalled` (reiniciar fluxo de instalação continua idêntico).
> 2. `uninstaller.ts` — classe/função `uninstallKloudGames(emit: (evt) => void): Promise<UninstallReport>`:
>    - **Guarda de reentrância**: se `isUninstalling`, rejeita imediatamente (`{ success: false, error: 'Desinstalação já em andamento' }`). Flag é resetada no `finally`.
>    - **Etapa `check`** (progress 5): `detectKloudGames()` (T1). Se `status === 'missing'` → emite `done` e retorna `{ success: false, report, error: 'O Kloud Games não está instalado.' }` (**idempotente, sem erro de sistema**). Se `entry?.productCode == null && exePath == null` → erro "Desinstalação pelo registro não encontrada — use Configurações do Windows → Aplicativos".
>    - **Etapa `kill`** (progress 15, só se `isKloudGamesRunning()`): tenta `taskkill /IM KLOUD_GAMES.exe /F` (execFileSync, `windowsHide: true`); erro de acesso (precisa elevar) → tenta via PowerShell `Start-Process taskkill -Verb RunAs -ArgumentList '/IM','KLOUD_GAMES.exe','/F' -Wait`; se ainda falhar → `error` claro ("Feche o Kloud Games manualmente e tente de novo") e **aborta** (não chama msiexec com o exe em uso).
>    - **Etapa `msiexec`** (progress 25 → 80): monta comando elevado no estilo `launchInstallerElevated`: `Start-Process msiexec.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '/x','"{GUID}"','/qn','/norestart'`; captura stdout/stderr + `$LASTEXITCODE` no mesmo padrão de PowerShell wrapper do `kloudGames.ts`; loga tudo em `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log` (nova função `appendKloudGamesUninstallLog()`, mesmo estilo de `appendKloudGamesLog`, com `LOG_FILE = join('logs', 'kloud-games-uninstall.log')`).
>    - **Etapa `verify`** (progress 85): delega à T3 (`verifyKloudGamesRemoval()`) — se a T3 ainda não existir, faça inline o mínimo: `findKloudGamesExe()` === null após `resetKloudGamesState()`. **Não bloqueie a T3 por esta linha.**
>    - **Etapa `cleanup`** (progress 95): `resetKloudGamesState()`; remove `%TEMP%\KLOUD_GAMES` (recursivo, tolerante — é TEMP); **não** apagar `%APPDATA%\kolnd-hub\logs\kloud-games-install.log`.
>    - Emite `uninstall:progress` a cada mudança de etapa (`message` amigável: "Verificando instalação…", "Encerrando Kloud Games…", "Desinstalando o Kloud Games…", "Verificando a remoção…", "Limpando dados temporários…", "Concluído") e `uninstall:log` com as linhas brutas relevantes.
>    - Retorna `UninstallReport { success, cancelled, needsReboot, remaining: string[], logPath }`. Mapeamento de códigos via `mapMsiexecExitCode()` (T1): `needs-reboot` → sucesso **com aviso**; `cancelled`/`uac-denied` → `{ success: false, cancelled: true }`; `already-absent` → sucesso; `newer-version` → sucesso parcial; outros → erro.
> 3. `registerUninstallIpc(getWindow: () => BrowserWindow | null)` em `uninstaller.ts`, registrando:
>    - `uninstall:kloud-status` → `{ ok: true, detection: KloudGamesDetection } | { ok: false, error }` (síncrono; usado pela UI para habilitar o botão)
>    - `uninstall:kloud-games` → inicia o fluxo; retorna `{ success: true }` imediatamente (progresso via eventos), ou `{ success: false, error }` se já houver desinstalação em andamento. Reenvia `uninstall:progress`/`uninstall:log` para `getWindow()?.webContents.send(...)` e, ao terminar, `uninstall:complete` com `{ success, error?, report? }`.
>    - `uninstall:hub-status` → `{ available: boolean, uninstallerPath: string | null, isPackaged: boolean }` (T1 `findHubUninstaller` + `app.isPackaged`)
>    - `uninstall:backup-data` → copia `%APPDATA%\kolnd-hub` recursivamente para `Documentos\KolndHub-Backup-<YYYYMMDD-HHmmss>` (`fs.cpSync(..., { recursive: true })`); retorna `{ success: true, path } | { success: false, error }`. Se a pasta de destino já existir, sufixo `-2`, `-3`… (nunca sobrescreve backup).
>    - `uninstall:open-logs` → abre `%APPDATA%\kolnd-hub\logs` via `shell.openPath` (estilo dos handlers `shell:openPath` do `index.ts`)
>    - **NÃO** registre `uninstall:hub` ainda (é a T5).
> 4. Em `main/index.ts`: `import { registerUninstallIpc } from './uninstaller'` + `registerUninstallIpc(() => mainWindow)` junto aos demais `register*Ipc()` (dentro de `app.whenReady()`, ao lado de `registerGamepadIpc()`).
> 5. Preload + `index.d.ts` (**espelhar os dois**): `getKloudGamesUninstallStatus()`, `uninstallKloudGames()`, `getHubUninstallStatus()`, `backupHubData()`, `openHubLogsFolder()`, `onUninstallProgress(cb)` (retorna unsubscribe), `onUninstallLog(cb)`, `onUninstallComplete(cb)`.
> 6. Nenhum ajuste de UI nesta tarefa (chega na T4). Toast/erros tratados na T4.

**Critérios de aceitação:**
- [ ] Em máquina com Kloud Games instalado: `uninstallKloudGames()` elevado remove o MSI (exe some, serviço `KLOUD_GAMESsvc` para de existir, atalhos em Menu Iniciar somem); eventos `uninstall:progress` chegam em ordem `check → (kill) → msiexec → verify → cleanup → done`
- [ ] UAC negado (`1223`) → `success: false, cancelled: true`, **nada** foi apagado; `kloud-games.paths.json` intacto
- [ ] Kloud Games ausente → sucesso idempotente ("já não constava como instalado"), sem erro de sistema
- [ ] `uninstall:kloud-games` chamado 2× em sequência → segundo retorna erro de reentrância sem disparar segundo `msiexec`
- [ ] `kloud-games.paths.json` regravado com `exePath: null` após sucesso; log gravado em `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log`
- [ ] Build + `tsc` (node e web) ok

**Validação:** numa máquina/VM **com snapshot** (o teste é destrutivo): instalar o Kloud Games pelo Hub, rodar `npm run dev`, chamar `window.api.uninstallKloudGames()` via devtools e acompanhar os eventos no console (`window.api.onUninstallProgress(console.log)`); conferir no final: `sc query KLOUD_GAMESsvc` → 1060; exe ausente; Menu Iniciar sem `LizardByte\KLOUD_GAMES`; `Get-ItemProperty HKLM:\...\Uninstall\* | ? DisplayName -match KLOUD` → vazio; `kloud-games.paths.json` com `exePath: null`. **Restaurar o snapshot ao final** (ou reinstalar pelo Hub).

---

### [ ] T3 — Verificação pós-desinstalação (laudo) e limpeza de estado
**Objetivo:** fechar o ciclo com um **laudo objetivo** ("o que foi removido de verdade") e a limpeza dos únicos resíduos que o MSI não cuida.

**Dependências:** T2 concluída (a interface `UninstallReport` já existe).
**Arquivos-alvo:** novo `src/main/uninstallVerify.ts`; `src/main/uninstaller.ts` (etapa `verify`/`cleanup` passa a usar o laudo); test-side fixtures `src/main/uninstallVerify.test.ts`.

**Prompt para o Agente:**
> Sua tarefa (T3) é o **laudo pós-desinstalação** do Kloud Games: uma função pura por verificação + orquestração tolerante. Nenhum item do laudo falha o processo inteiro — apenas preenche `remaining[]`.
> 1. `uninstallVerify.ts`, exportando `verifyKloudGamesRemoval(): KloudGamesUninstallReport`:
>    ```ts
>    interface KloudGamesUninstallReport {
>      exeGone: boolean        // findKloudGamesExe() === null (após resetKloudGamesState)
>      serviceGone: boolean    // sc query KLOUD_GAMESsvc → 1060/missing
>      registryGone: boolean   // findKloudGamesUninstallEntry() === null
>      shortcutsGone: boolean  // Menu Iniciar\Programs\LizardByte\KLOUD_GAMES ausente (e KLOUD_GAMES.lnk na raiz, se existir)
>      tempCleaned: boolean    // %TEMP%\KLOUD_GAMES removido/inexistente
>      remaining: string[]     // descrições amigáveis do que sobrou, ex.: "Serviço KLOUD_GAMESsvc ainda presente"
>      logPath: string         // %APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log
>    }
>    ```
> 2. Cada verificação é uma função exportada com nome próprio (`checkExeGone()`, `checkServiceGone()`, …) para ser testável e chamada isoladamente na UI ("Verificar novamente" na tela de resultado — ver T4).
> 3. `shortcutsGone` checa: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\LizardByte\KLOUD_GAMES` (pasta) **e** `…\Programs\KLOUD_GAMES*.lnk` na raiz (tolerante a variações de nome); falha de leitura (sem permissão) → considera ausente + anota no relatório (`remaining` não inclui, vira `notes` opcional — mantenha o shape simples: string[]).
> 4. `uninstaller.ts`: a etapa `cleanup` passa a chamar `verifyKloudGamesRemoval()` e embutir o laudo em `uninstall:complete` (`report`) — o **sucesso real** = `exeGone && serviceGone && registryGone`; `shortcutsGone`/`tempCleaned` afetam apenas avisos. `remaining` vazio + needs-reboot=false → `success: true`.
> 5. **Nunca** apagar `HKCU\Software\LizardByte\KLOUD_GAMES`, logs antigos ou `%APPDATA%` nesta tarefa. Se o laudo encontrar registro residual, apenas descreve em `remaining`.
> 6. Testes: fixtures para `sc query` (1060 → serviceGone true), diretórios temporários para atalhos (criar/buscar/apagar num `%TEMP%` de teste), laudo com tudo limpo (sucesso), laudo com 1–3 itens remanescentes (sucesso parcial + `remaining` correto).

**Critérios de aceitação:**
- [ ] Numa desinstalação real: laudo retorna `success: true` na esmagadora maioria dos casos; simular falha (serviço deixado à mão antes do `sc delete` do MSI — via VM/fixture) produz `remaining: ['Serviço …']` sem derrubar o fluxo
- [ ] `uninstall:complete` carrega o laudo integral (a UI da T4 usa `remaining` para o texto de sucesso parcial)
- [ ] Pasta `%TEMP%\KLOUD_GAMES` some após o fluxo (se existia)
- [ ] `npm test` verde; `tsc` ok

**Validação:** repetir a bateria do T2 com snapshot/VM; conferir `Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\LizardByte"` vazio/ausente; apagar manualmente `%TEMP%\KLOUD_GAMES` antes, confirmar que some depois; rodar com a fixture de serviço residual (renomear a chave no laudo via teste, não à mão em produção).

---

## Fase 2: Interface (Configurações)

### [ ] T4 — Seção "Zona de perigo" nas Configurações: botões, confirmação, progresso e resultado
**Objetivo:** adicionar em **Configurações** a seção **"Zona de perigo"** com o botão **"Desinstalar Kloud Games"** e o botão **"Desinstalar Kolnd Hub"** (o fluxo do Hub é orquestrado na T5 — aqui ele aparece como UI pronta e chama o `uninstall:hub` da T5; enquanto a T5 não existe, renderiza desabilitado com tooltip "Disponível na próxima etapa").

**Dependências:** T2 concluída (T3 idealmente). A T5 completa o botão do Hub.
**Arquivos-alvo:** novo `src/renderer/src/components/UninstallDangerZone.tsx`; novo `src/renderer/src/components/UninstallKloudGamesModal.tsx` (confirmação + progresso + resultado); `src/renderer/src/components/Settings.tsx` (montagem + prop `onToast` opcional para reaproveitar o toast do App); `src/renderer/src/index.css` (apenas se faltar classe utilitária).

**Prompt para o Agente:**
> Sua tarefa (T4) é a UI completa da desinstalação — com foco em **não deixar desinstalar sem querer** e em **nunca** deixar o usuário sem entender o que aconteceu.
> 1. **Novo componente `UninstallDangerZone.tsx`** (montado no fim de `Settings.tsx`, antes da nota informativa; recebe `onToast: (msg: string, kind: 'success' | 'error' | 'info') => void` via prop nova e opcional — o `App.tsx` repassa o mesmo `setNotice` já usado; fallback interno: toast inline próprio se a prop não for passada):
>    - Cabeçalho uppercase **"Zona de perigo"** no estilo das demais seções + subtítulo amigável ("Desinstalações são definitivas — leia com atenção antes de confirmar").
>    - **Card Kloud Games** (`.glass rounded-2xl p-6 border-l-4 border-red-500/60`):
>      - Ícone (`Gamepad2`, fundo `bg-red-500/10 text-red-400`) + título **"Desinstalar Kloud Games"** + descrição: *"Remove o Kloud Games (programa, serviço, regras de firewall, PATH e atalhos). Suas preferências do Hub continuam salvas."*
>      - **Status** via `window.api.getKloudGamesUninstallStatus()` ao montar e ao clicar "Atualizar": "Instalado em `C:\Program Files\KLOUD_GAMES` (versão X) · serviço KLOUD_GAMESsvc: rodando/parado" | "Instalação parcial detectada (exe sem registro) — a desinstalação tentará limpar o que for possível" | "Não instalado". Enquanto carrega: skeleton discreto.
>      - Botão **"Desinstalar Kloud Games"** (classe `.btn-danger`, `Trash2`) — habilitado apenas se `status !== 'missing'`; enquanto `running`: badge "Em execução"; tooltip quando desabilitado: "O Kloud Games não está instalado".
>    - **Card Kolnd Hub** (análogo): ícone (`Zap`/`Trash2`), título **"Desinstalar Kolnd Hub"**, descrição: *"Remove o Kolnd Hub **e também desinstala o Kloud Games** durante o processo (perguntaremos a cada passo). O Mark LVI é removido junto com a pasta do Hub."* + status "Disponível no app instalado" / desabilitado em dev. Botão **"Desinstalar Kolnd Hub"** (`.btn-danger`) — fluxo real na T5.
> 2. **Modal de confirmação do Kloud Games** (`UninstallKloudGamesModal`, fase `'confirm' | 'running' | 'done' | 'error'`):
>    - *confirm*: título **"Desinstalar o Kloud Games?"**; lista clara do que será removido (programa e dados em `C:\Program Files\KLOUD_GAMES` — incluindo `config\`; serviço; firewall; PATH; atalhos); aviso quando `running` (*"O Kloud Games está em execução. Streams Moonlight em andamento serão interrompidas."*) com botão "Encerrar o Kloud Games e continuar" (passa `killFirst: true` implícito — a T2 já mata sozinho; aqui é só o texto da confirmação); aviso quando `partial` (*"Instalação quebrada detectada: tentaremos limpar mesmo assim"*); botão destrutivo **habilitado só após digitar `KLOUD_GAMES`** num input (comparação case-insensitive, `Trim`) + botão **Cancelar** (foco inicial, padrão `Escape`).
>    - *running*: modal não-fechável (backdrop sem clique, botão X escondido, Esc ignorado) com: etapa atual amigável, barra de progresso determinate (`progress` do evento; 0–100; altura 8px, `bg-red-500`), **log ao vivo** colapsável (`<details>`-like, mono, as últimas ~200 linhas), aviso "Não feche a janela".
>    - *done*: sucesso — ícone `CheckCircle2` verde, **"Kloud Games desinstalado"**, laudo resumido (exe/serviço/registro/atalhos/temp — cada um com ✓ ou ⚠), `needsReboot` → aviso amarelo "Reinicie o PC para concluir a remoção de alguns arquivos"; botão **"Concluir"** e **"Abrir pasta de logs"**. Se `remaining.length > 0`: estado **sucesso parcial** obrigatório — título honesto (**"Desinstalação concluída parcialmente"**), lista do que sobrou + orientação (Apps → Kloud Games → Desinstalar; ou reiniciar e tentar de novo).
>    - *error*: `AlertCircle` vermelho, mensagem (do `error`/`mapMsiexecExitCode`), botões **"Tentar novamente"** (volta a `confirm`), **"Abrir pasta de logs"** e **"Fechar"**.
> 3. **Toast final** para o Hub: `onToast('Kloud Games desinstalado.', 'success')` etc. **Não** limpar o card até um refresh manual ou ao fechar o modal (chamar `getKloudGamesUninstallStatus()` de novo no fechamento — o botão deve refletir "Não instalado" imediatamente).
> 4. **Mouse/teclado/a11y**: foco preso no modal (cycle Tab), Esc cancela na confirmação, `role="alertdialog"` + `aria-labelledby`, clique no backdrop **não** fecha nas fases `running`, foco devolvido ao botão de origem ao fechar.
> 5. Enquanto `running`, a seção inteira fica com `pointer-events-none opacity-70` (impede segunda desinstalação pela UI; a T2 também bloqueia no main).
> 6. **Não** duplique a lógica de chamada ao MSI nem de leitura de registro — tudo via `window.api.*`.

**Critérios de aceitação:**
- [ ] Com Kloud Games instalado: botão habilitado, status correto; digitar `kloud_games` (qualquer caixa) habilita o botão vermelho; cancelar/Esc/backdrop fecha sem efeito colateral
- [ ] Fluxo completo: confirmação → progresso (barra anda e log rola) → "Kloud Games desinstalado" com laudo todo ✓; **sem fechar o app**
- [ ] UAC negado no meio → estado *error* com mensagem amigável + "Tentar novamente" funciona
- [ ] Status revalidado ao fechar o modal (vira "Não instalado"; botão desabilita)
- [ ] Toast aparece no padrão dos outros toasts (canto/posição que o App já usa)
- [ ] Teclado: Tab cicla, Esc cancela, foco retorna ao botão; `role="alertdialog"` presente
- [ ] Build + `tsc` ok; zero dependências novas

**Validação:** `npm run dev` → Configurações → fim da página → Zona de perigo; rodar o fluxo real numa VM com snapshot; negar o UAC propositalmente e conferir o estado de erro; deixar o Kloud Games aberto e conferir o aviso de "em execução"; fechar a janela no meio do processo (deve ser impossível) e via teclado (deve ser impossível); reinstalar o Kloud Games pelo fluxo normal do Hub e conferir que tudo funciona de novo.

---

### [ ] T5 — Fluxo "Desinstalar Kolnd Hub": Kloud Games → backup → wipe opcional → desinstalador NSIS
**Objetivo:** orquestrar a desinstalação completa do Kolnd Hub: remove o Kloud Games automaticamente (quando instalado e autorizado), oferece backup/wipe de `%APPDATA%\kolnd-hub` e dispara o desinstalador NSIS — tudo com confirmação e mensagens claras.

**Dependências:** T2, T3 e T4 concluídas.
**Arquivos-alvo:** `src/main/uninstaller.ts` (novo `uninstallHub()` + canal `uninstall:hub`); `src/main/index.ts` (nada — `registerUninstallIpc` já existe); preload ambos (`uninstallHub` em `preload/index.ts` + `index.d.ts`); novo `src/renderer/src/components/UninstallHubModal.tsx`; `UninstallDangerZone.tsx` (monta o modal do Hub no card).

**Prompt para o Agente:**
> Sua tarefa (T5) é a orquestração **"Desinstalar Kolnd Hub"** — o fluxo mais sensível do app. Siga a ordem exata abaixo; cada passo tem saída definida.
> 1. **Canal `uninstall:hub`** (main): `uninstallHub({ wipeUserData: boolean }): Promise<{ started: boolean; error? }>` — apenas **valida e devolve o controle**; a sequência pesada roda em etapas emitidas por eventos (`uninstall:progress`, stepIds `kloud`, `backup`, `wipe`, `spawn`, `done`) para a UI exibir o mesmo modal de progresso. `wipeUserData: false` (default) **nunca** apaga nada.
> 2. **Passo `kloud`**: `detectKloudGames()` (T1). Se `status !== 'missing'`: executa **o mesmo fluxo da T2** (chamar a função interna `uninstallKloudGames()` — sem duplicar código — reemitindo eventos com prefixo/stepId `kloud`).
>    - Sucesso (inclui `needs-reboot`/`already-absent`/`newer-version`) → passo concluído, segue adiante.
>    - Falha/cancelamento (UAC negado, MSI em uso, parcial com erro) → emite `uninstall:complete` com `{ success: false, paused: true, kloudError, stage: 'kloud' }`; **a UI mostra pergunta**: *"Não foi possível desinstalar o Kloud Games (motivo: …). Deseja desinstalar apenas o Kolnd Hub mesmo assim?"* → botões **"Desinstalar só o Hub"** (reenvia `uninstall:hub` com `skipKloud: true`) e **"Cancelar"** (aborta tudo; nada mudou). Sem essa resposta, a sequência **não** prossegue.
>    - `status === 'missing'` → passo pulado com log ("Kloud Games não instalado — pulando").
> 3. **Passo `backup`** (só se o usuário clicou em "Fazer backup dos meus dados" na confirmação do Hub — o backup é uma **ação separada e voluntária**, via `uninstall:backup-data`, executada antes de confirmar; a sequência apenas loga "backup já feito em `<caminho>`" se o renderer informou `backupPath`).
> 4. **Passo `wipe`** (só se `wipeUserData === true`): monta o inventário ANTES de apagar (lista de entradas top-level de `%APPDATA%\kolnd-hub`) e registra no log; apaga recursivamente `config.json`, `first-run-complete.flag`, `logs\`, `mark-lvi\`, `game-icons\` (ou a pasta inteira — escolha a que deixar menos resíduo); emite progresso item a item; **nunca** toca em nada fora de `%APPDATA%\kolnd-hub`; falha de um item não impede os demais (coleta `errors[]`, reporta no fim).
> 5. **Passo `spawn`**: resolve o caminho do desinstalador (T1 `findHubUninstaller()`; em dev/`!app.isPackaged` ou `available === false` → erro amigável *"Desinstalador não encontrado — desinstale pelo aplicativo Configurações do Windows → Aplicativos → Kolnd Hub"*, **aborta sem apagar nada do wipe**? — **decisão:** o wipe já terá acontecido se o usuário pediu; por isso a resolução do caminho é feita **antes** do wipe (etapa 0 do main, antes de qualquer destruição) e só depois do backup. Documente essa ordem.). Spawn desanexado: `spawn(uninstallerPath, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()`; then `processManager.killAll()` → destroy da janela → `app.quit()` (**reaproveitar `shutdownHub()`**, não copiar).
> 6. **NSIS não é elevado** (per-user). Se o `.exe` exigir (nunca deveria) e falhar no spawn → `uninstall:complete` com erro claro; o Hub permanece funcional.
> 7. **UI (`UninstallHubModal.tsx`)** — `phase: 'confirm' | 'running' | 'choice' | 'spawned'`:
>    - *confirm*: título **"Desinstalar o Kolnd Hub?"**; texto explicando a sequência (1º o Kloud Games se instalado — *"Streams ativas serão interrompidas"*; 2º o que o Hub apaga; 3º o que o Windows apaga); **checkbox** `Não apagar meus dados (recomendado)` — na verdade duas opções exclusivas em radio: **"Manter meus dados e configurações (recomendado)"** (default) e **"Apagar também meus dados e configurações (irreversível)"** seguido da lista do que será apagado (config, biblioteca, logs, Mark LVI). Botão **"Fazer backup dos meus dados"** (sempre visível; após clicar, mostra "Backup salvo em `…`" + caminho + botão "Abrir pasta"). Botão destrutivo habilitado após digitar **`Kolnd Hub`**. Em dev: modal inteiro desabilitado com aviso.
>    - *running*: mesmo padrão do modal do Kloud Games (etapa, barra indeterminada-cuidadosa já que o NSIS assume a tela no final, log).
>    - *choice*: pergunta de "Kloud Games falhou — só o Hub?" com os dois botões.
>    - *spawned*: não existe — assim que o spawn acontece o app fecha; o NSIS mostra a própria UI de desinstalação. Sem telas pendentes.
> 8. `App.tsx`/`Settings.tsx`: o card do Hub chama o modal; nada de `setNotice` pós-fechamento (o app foi desinstalado — não há UI para toast).
> 9. **Nunca** registrar ordem inversa (wipe antes da resolução do desinstalador; spawn antes do Kloud Games ter terminado ou do usuário decidir "só o Hub").

**Critérios de aceitação:**
- [ ] Fluxo completo numa VM com snapshot: Kloud Games instalado → confirmar → Kloud Games desinstalado → NSIS abre → Kolnd Hub some (Menu Iniciar, área de trabalho, `%LOCALAPPDATA%\Programs\Kolnd Hub`)
- [ ] `%APPDATA%\kolnd-hub` **preservado** no fluxo default; **apagado** apenas com a opção irreversível marcada — e o conteúdo bate exatamente com o log de inventário
- [ ] Backup: pasta `Documentos\KolndHub-Backup-*` criada com `config.json` etc.; clicar de novo cria `-2` (nunca sobrescreve)
- [ ] Kloud Games com UAC negado → pergunta "desinstalar só o Hub?"; "Cancelar" deixa tudo intacto; "Desinstalar só o Hub" prossegue sem o Kloud Games
- [ ] Desinstalador não encontrado (renomear o `.exe` em VM) → erro amigável antes de qualquer destruição; nada apagado
- [ ] Em dev (`npm run dev`): botão "Desinstalar Kolnd Hub" desabilitado com explicação
- [ ] App fecha por completo ao final (tray some, nenhum processo Kolnd Hub/Mark LVI fica preso)
- [ ] Build + `tsc` ok

**Validação:** VM Windows limpa com snapshot, instalador `npm run package` (o único ambiente onde o fluxo do Hub é honesto): (1) instalar → instalar via 1ª execução → rodar → "Desinstalar Kolnd Hub" (default, sem wipe) → conferir no Explorer; (2) repetir com wipe + backup; (3) repetir negando o UAC do Kloud Games e escolhendo "só o Hub"; (4) repetir numa máquina sem Kloud Games (passo `kloud` pulado). Restaurar snapshot ao final de cada rodada. Conferir também que os atalhos do Menu Iniciar do Kloud Games sumiram (fluxo T2) e os do Hub sumiram (NSIS).

---

## Fase 3: Robustez e matriz de erros

### [ ] T6 — Matriz de erros, casos de borda e dependências
**Objetivo:** garantir que todo o processo seja confiável quando o mundo real atrapalha: UAC negado, MSI em uso, reinício pendente, órfãos, `%APPDATA%` travado, clique duplo, política de grupo.

**Dependências:** T2–T5 concluídas.
**Arquivos-alvo:** `src/main/uninstaller.ts`, `src/main/uninstallDetection.ts` (ajustes), `UninstallKloudGamesModal.tsx`, `UninstallHubModal.tsx`; testes correspondentes.

**Prompt para o Agente:**
> Sua tarefa (T6) é endurecer os fluxos contra a matriz abaixo. Para cada linha: (a) comportamento definido no main, (b) mensagem exibida na UI, (c) teste ou verificação manual documentada.
> 1. **Kloud Games / msiexec:** UAC negado (1223) → mensagem "Você recusou a permissão (UAC). Nada foi removido." + retry; `1618`/`1500` (outra instalação) → "Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC)." + retry; `1603` → "O Windows não conseguiu desinstalar (código 1603). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos." + abrir logs; `1625` → "Esta máquina bloqueia desinstalações por política de grupo. Fale com o administrador."; `3010`/`1641` → sucesso **com aviso** "Reinicie o PC para concluir a remoção."; `1605` → sucesso silencioso ("já não constava como instalado"); `1638` → sucesso parcial com aviso "Já existe uma versão mais nova do Kloud Games instalada; nada foi removido."; `1602` → "Cancelado por você." (não vermelho — neutro); `null`/desconhecido → erro genérico + abrir logs.
> 2. **Órfãos e parciais:** exe presente sem registro e sem serviço → fluxo normal via `msiexec` **não é possível**; o botão mostra "Instalação quebrada" e a confirmação oferece **"Remover somente os arquivos restantes"** (apaga só a pasta `InstallLocation` detectada + zera `paths.json` + laudo "remoção manual parcial; serviço/firewall não existiam") — **nunca** apagar pastas fora de `C:\Program Files\KLOUD_GAMES` sem confirmação textual; registro presente sem exe (desinstalação quebrada) → oferecer "Desinstalar pelo registro" (msiexec funciona — o produto consta); serviço `KLOUD_GAMESsvc` presente sem o resto → listar no laudo + orientação (`sc delete KLOUD_GAMESsvc` elevado, com botão que chama exatamente isso + loga).
> 3. **Kloud Games vivo:** em execução durante a confirmação → aviso + botão "Encerrar e continuar"; se o `taskkill` falhar duas vezes → bloquear com instrução manual (Gerenciador de Tarefas) e não chamar o MSI.
> 4. **Dependências entre etapas do Hub:** Kloud Games falhou no meio da sequência → pergunta "só o Hub?" (já existe); wipe com item travado (`mark-lvi` em uso — processos mortos pelo `killAll()`, mas arquivo aberto por AV) → item entra em `errors[]`, o resto segue, toast final lista falhas; spawn do NSIS falhou → app **não** fecha, erro visível, nada do wipe é desfeito (mas o usuário escolheu) — exibir instrução manual (Apps → Kolnd Hub → Desinstalar).
> 5. **Reentrância/estado:** clique duplo em qualquer botão destrutivo → uma única execução (busy flag no main **e** na UI); fechar a janela durante `uninstall:hub` no passo `kloud` → permitido (a janela pode ser fechada; o fluxo continua? — **decisão:** a janela fica travada (fechar/minimizar desabilitados) durante os passos destrutivos; só após o spawn do NSIS o fechamento acontece); tecla Esc durante fases destrutivas → ignorada.
> 6. **Reinício pendente:** após `3010`/`1641`, o estado "Reinício necessário" persiste na UI até o usuário fechar o modal; nenhum fluxo depende de reboot para prosseguir.
> 7. **Reinstalação coerente:** após desinstalado, o fluxo de 1ª execução/`ensureKloudGamesInstalled()` deve poder reinstalar normalmente (não pode haver estado residual impedindo) — documentar no teste manual; `kloud-games.paths.json` zerado é o que garante isso.
> 8. **Política/elevação:** PowerShell bloqueado por política de execução (raro, mas existe) → detectado pelo wrapper (saída vazia + exit code) → erro "O PowerShell está bloqueado nesta máquina (política de execução). Desinstale pelo aplicativo Configurações do Windows."
> 9. **`%TEMP%\KLOUD_GAMES` travado** → falha vira `tempCleaned: false` + `remaining` (não impede sucesso).
> 10. Atualize os testes: fixtures da matriz de códigos; `detectKloudGames` com exe-órfão/registro-órfão/serviço-órfão; `mapMsiexecExitCode` já coberto — estender com 1602/1638/1625.

**Critérios de aceitação:**
- [ ] Cada linha da matriz produz exatamente a mensagem definida (testar ao menos: 1223, 1618, 1603, 3010, 1605, órfão-exe, órfão-registro, taskkill falhando)
- [ ] Nenhum caminho de erro deixa o app numa "via crucis" sem saída: sempre há "Tentar novamente", "Fechar" ou instrução manual concreta
- [ ] Durante fases destrutivas a janela não fecha/minimiza (testado com Alt+F4 e pelo X do title bar)
- [ ] `npm test` verde; build + `tsc` + `npm run lint` ok

**Validação:** VM com snapshot; simular UAC negado (basta negar), MSI bloqueado por política (gpedit numa VM Enterprise ou `reg add` de política de restrição de software, removido depois), serviço criado à mão (`sc create`) e depois removido pelo fluxo, e a sequência completa do T5 com wipe. Conferir logs em `%APPDATA%\kolnd-hub\logs\*uninstall*.log` ao final de cada rodada.

---

## Fase 4: Documentação e entrega

### [ ] T7 — README + checklist final de entrega (smoke test)
**Objetivo:** documentar a desinstalação para o usuário final e fechar o conjunto com um smoke completo.

**Dependências:** T1–T6 concluídas.
**Arquivos-alvo:** `README.md` (raiz, seção "Desinstalação" nova e/ou dentro de "Instalação para o usuário final"); `kolnd-hub/README.md` (seção "Primeira execução, UAC e antivírus" ou equivalente, citando os bots novos e o comportamento do `%APPDATA%`).

**Prompt para o Agente:**
> Sua tarefa (T7) é a documentação final e a passagem de entrega. Nada de novo no código — só docs e verificação.
> 1. No `README.md` da raiz, nova seção **"Desinstalação"** com:
>    - **Pelo próprio Kolnd Hub** (recomendado): Configurações → Zona de perigo → botão desejado; o que cada um faz (Kloud Games via MSI oficial — serviço, firewall, PATH e atalhos removidos automaticamente; Kolnd Hub via desinstalador do Windows — o Kloud Games é removido junto automaticamente);
>    - **O que acontece com seus dados**: `%APPDATA%\kolnd-hub` é preservado por padrão; checkbox "Apagar também meus dados" na desinstalação do Hub; botão "Fazer backup dos meus dados" (pasta `Documentos\KolndHub-Backup-*`);
>    - **Mark LVI**: removido junto com a pasta do Hub (dados atuais em `%APPDATA%\kolnd-hub\mark-lvi` seguem a regra do `%APPDATA%`); dados antigos ao lado do executável são apagados com a pasta — faça backup;
>    - **Desinstalação manual pelo Windows** (alternativa): Apps → "Kloud Games" → Desinstalar e Apps → "Kolnd Hub" → Desinstalar — equivalentes ao que o Hub faz;
>    - **Reinício pendente** (códigos 3010/1641) e onde ficam os logs (`%APPDATA%\kolnd-hub\logs\*uninstall*.log`).
> 2. Em `kolnd-hub/README.md`, atualizar as seções que citam desinstalador/`deleteAppDataOnUninstall` explicando os dois botões novos (e que nada disso mudou no NSIS).
> 3. Rode o checklist **Validação final de entrega** abaixo; corrija tudo que falhar nesta tarefa (não deixar para "depois").

**Critérios de aceitação:**
- [ ] README(s) com as instruções acima, em pt-BR, sem contradizer `electron-builder.yml` nem o comportamento real (validado na T5/T6)
- [ ] Smoke completo assinado (itens abaixo marcados)

**Validação:** leitura crítica dos dois READMEs (alguém que nunca viu o projeto entende o processo?); conferir que o `README.md` não promete nada que a UI não faz (ex.: "backup automático" — não é automático, é um botão).

---

## Riscos e armadilhas conhecidas (leia antes de começar)

- **`msiexec /x` sem elevação falha em silêncio ou com código inútil:** o MSI é per-machine. Sempre via `Start-Process -Verb RunAs` com captura de saída (padrão `launchInstallerElevated`) — `spawn('msiexec', …)` direto do Hub **sempre** dá errado.
- **Nunca usar `Win32_Product`:** consultar `SELECT * FROM Win32_Product` dispara reconfiguração de **todas** as apps MSI instaladas (pode levar minutos e disparar prompts de reparo). Só registro + `sc query` + `tasklist`.
- **Nunca apagar `C:\Program Files\KLOUD_GAMES` na mão:** serviço, firewall, PATH e atalhos ficam órfãos. O MSI existe para isso — use-o.
- **Kloud Games em execução bloqueia a remoção:** o `KLOUD_GAMES.exe` preso (ou o serviço em streaming) impede `RemoveFiles`; sempre o passo `kill` + verificação; streams Moonlight morrem junto (avisar o usuário).
- **`HKCU\Software\LizardByte\KLOUD_GAMES` residual é sintoma, não lixo:** não apague; reporte no laudo (`remaining`).
- **Apagar `%APPDATA%\kolnd-hub` antes do backup/spawn destrói a chance de "desfazer":** se o wipe acontece e o NSIS não abre, o usuário perdeu a config com o app ainda instalado. Ordem obrigatória: resolver desinstalador → backup → wipe → spawn → quit.
- **Wipe antes de matar processos:** `mark-lvi` e o próprio Hub seguram arquivos no `%APPDATA%` → `killAll()` **antes** do wipe (e tratar falhas item a item).
- **`%LOCALAPPDATA%\Programs\Kolnd Hub` vs dev:** em dev o `app.getPath('exe')` aponta para o `node_modules/electron/dist/electron.exe` — o "desinstalar Kolnd Hub" em dev apagaria dados de desenvolvimento se não fosse bloqueado (por isso P11).
- **NSIS remove `resources/programs/MarkLVI` junto:** dados legados do Mark LVI (ao lado do exe, builds antigos) são perdidos de forma permanente — o diálogo precisa dizer isso com todas as letras (P8).
- **3010/1641 ≠ falha:** reinício pendente é sucesso com aviso; tratar como erro assusta o usuário à toa.
- **Idempotência é requisito de UX:** reexecutar "Desinstalar" após sucesso parcial tem que convergir — por isso `paths.json` zerado (T2) + `msiexec /x` seguro de repetir (1605 → sucesso).
- **Progresso falso:** não invente porcentagem contínua para o `msiexec` sem telemetria real — use as etapas fixas (check/msiexec/verify) com `progress` por etapa; quebrar isso gera barra "travada em 50%" sem informação.
- **Escopo:** não implemente desinstalação do Mark LVI/Python (winget), não altere `firstRun`, Big Picture, `launchKloudOnStart`, `electron-builder.yml` (`deleteAppDataOnUninstall`) nem o fluxo de instalação do Kloud Games.
- **`?first-run=1`:** a Zona de perigo pode aparecer; nada aqui a bloqueia nem depende dela.
- **PowerShell bloqueado por política:** a instalação do Kloud Games já depende de PowerShell (para elevar); se estiver bloqueado, a desinstalação também estará — mensagem própria, nunca exceção não tratada.

---

## Critérios de aceitação globais (o conjunto inteiro)

- [ ] Existe, em Configurações → "Zona de perigo", o botão **"Desinstalar Kloud Games"** que remove o Kloud Games **inteiro** (programa, serviço, firewall, PATH, atalhos, dados em `C:\Program Files\KLOUD_GAMES\config`) e **não** apaga nada fora disso sem confirmação
- [ ] Existe o botão **"Desinstalar Kolnd Hub"** que desinstala o Hub (desinstalador NSIS) **e** remove o Kloud Games automaticamente durante o processo, com decisão do usuário em cada ponto de falha
- [ ] **Nenhuma desinstalação acontece sem confirmação digitada** (`KLOUD_GAMES` / `Kolnd Hub`) e nenhuma fase destrutiva pode ser disparada por acidente ou reentrância
- [ ] **Mensagens de sucesso, erro e progresso** em todas as etapas (barra, log ao vivo, laudo final, toast)
- [ ] **`%APPDATA%\kolnd-hub` preservado por padrão** na desinstalação do Hub; apagado só com a opção irreversível marcada; **backup** sempre disponível e funcional (`Documentos\KolndHub-Backup-*`)
- [ ] **Atalhos removidos** (Menu Iniciar do Kloud Games via MSI; atalhos do Hub via NSIS) — verificado manualmente
- [ ] **Cenários de erro validados**: UAC negado, `1618`, `1603`, `1625`, `3010`, `1605`, órfãos de exe/registro/serviço, desinstalador ausente, dev mode
- [ ] Kloud Games **reinstalável** após a desinstalação pelo fluxo normal do Hub
- [ ] Build + `tsc` (node e web) + `npm test` + `npm run lint` ok
- [ ] Documentação (README) atualizada e fiel ao comportamento real

---

## Validação final de entrega (smoke test)

Antes de considerar o conjunto concluído (VM com snapshot recomendada):

- [ ] `npm run build` limpo e `npx tsc --noEmit` nos dois projetos ok; `npm test` verde; `npm run lint` ok
- [ ] Máquina/VM limpa → instalar `Kolnd Hub Setup.exe` → 1ª execução (instala MSI do Kloud Games) → rodar o Kloud Games → **Desinstalar Kloud Games pelo Hub**: confirmar com `KLOUD_GAMES`, negar o UAC uma vez (fluxo de erro), aceitar na sequência, conferir laudo, `sc query KLOUD_GAMESsvc` (1060), exe/atalhos/registro ausentes
- [ ] Reinstalar o Kloud Games pelo Hub (fluxo normal) para restaurar o estado
- [ ] **Desinstalar Kolnd Hub** (sem wipe): backup feito → confirmação com `Kolnd Hub` → Kloud Games removido junto (sem perguntas extras — ele funciona) → NSIS abre e remove o Hub → `%LOCALAPPDATA%\Programs\Kolnd Hub` não existe; `%APPDATA%\kolnd-hub\config.json` **existe**
- [ ] Wipe: marcado → `%APPDATA%\kolnd-hub` não existe; backup existe e contém `config.json`
- [ ] Caminho "só o Hub" (Kloud Games com UAC negado → "Desinstalar só o Hub"): Hub removido, Kloud Games **permanece** instalado e funcional
- [ ] Abertura do Hub após a desinstalação (via apps antigos/atalho residual, se houver) não corrompe nada — apenas não inicia (esperado)
- [ ] `git status` sem arquivos fora do escopo; READMEs atualizados

---

## Histórico

- **v1 (este arquivo)** — task criada a partir dos objetivos de desinstalação do ecossistema Kolnd: botão "Desinstalar Kloud Games" (MSI oficial via `msiexec /x`, elevação, progresso ao vivo, laudo pós-verificação), botão "Desinstalar Kolnd Hub" (orquestração Kloud Games → backup opcional → wipe opcional e explícito de `%APPDATA%\kolnd-hub` → desinstalador NSIS per-user), seção "Zona de perigo" nas Configurações com confirmação por digitação, matriz completa de erros (UAC, MSI, órfãos, reinício pendente) e pré-preservação de dados com backup em `Documentos\KolndHub-Backup-*`.
