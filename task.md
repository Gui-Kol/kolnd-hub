# task.md — Kolnd Hub: .exe único com instalação automática na primeira execução

**Objetivo:** Gerar um único instalador `.exe` do Kolnd Hub que, na primeira vez que o usuário abre o app, rode automaticamente um script que instala/configura **os programas** do ecossistema sem intervenção manual.

**Programas gerenciados pelo Hub (estado atual):**

| Programa | Comando padrão | Dependências |
|----------|---------------|--------------|
| Mark LVI / JARVIS | `MarkLVI.exe` (PyInstaller) | Embutido no instalador em `resources/programs/MarkLVI` |
| Kloud Games | `KLOUD_GAMES.exe` | **Não embutido por ora** — o snapshot local não compila neste toolchain (GCC 16/Clang 23 × código que exige C++23) |

> **Nota:** Playnite foi removido do projeto por decisão do usuário. A pasta `Playnite/` foi apagada do disco e do git, e todas as referências ao Playnite (installer, verificador, UI de primeira execução, README, apps.ts) foram removidas. `steamgriddb-manager/` também foi apagada.

> **Nota de 11/11/2026 (Kloud Games — MSI embutido):** O fork foi compilado do zero e agora é incluído como MSI no instalador:
> - Snapshot estava um fork não-buildável: arquivos renomeados inconsistentemente (`kloud-games-*` no disco vs referências `KLOUD_GAMES-*`/`KLOUD_GAMES*` no código), sem pasta `third-party/` (submódulos ausentes) e sem metadados git. Correções aplicadas: renomeados ~15 arquivos (assets, .ps1, .wxs, .cpp), submódulos clonados dos repos LizardByte/moonlight-stream (branch conforme `.gitmodules`, com submódulos aninhados), `cmake/dependencies/Boost_kloud-games.cmake` → `Boost_KLOUD_GAMES.cmake`, fix de `extern "C"` sobre `<stdatomic.h>` do GCC 16 (headers `PlatformThreads.h`, `LinkedBlockingQueue.h`, `Limelight-internal.h` + guards `extern "C"` em todos os headers de moonlight-common-c; wrappers externos em `rtsp.cpp`/`stream.cpp` removidos), build com **gcc/g++** (clang liga errado com libstdc++ 16 — seções duplicadas).
> - `.NET SDK 8` instalado via winget (necessário para WiX/cpack gerar o MSI). WiX 4.0.4 instalado pelo próprio cmake.
> - **MSI gerado:** `kloud-games/cmake-build-windows/cpack_artifacts/KLOUD_GAMES.msi` (~53 MB, instala em `C:\Program Files\KLOUD_GAMES`, instala o serviço KLOUD_GAMESsvc + firewall + autostart via `scripts/KLOUD_GAMES-setup.ps1`).
> - MSI copiado para `kolnd-hub/resources/programs/kloud-games/KLOUD_GAMES.msi`; `extraResources` já embutia `programs/**`. O Hub instala o MSI na primeira execução via `silentInstaller.ts → installKloudGames()` (elevado via `Start-Process -Verb RunAs`, `msiexec /i ... /quiet /norestart`; falha não bloqueia a 1ª execução). O card Kloud Games aponta para `"%ProgramFiles%\KLOUD_GAMES\KLOUD_GAMES.exe"`; `deployKloudGames()` verifica Program Files.
> - **Novo instalador gerado:** `kolnd-hub/dist/Kolnd Hub Setup 1.0.0.exe` (~357 MB).
> - Tela de 1ª execução ganhou a etapa `kloud-games` (entre Python e Programas).
> - **Automação (11/11/2026):** `build-installer.bat` (raiz) agora faz TUDO em um comando: (1) `kolnd-hub/scripts/build-kloud-games.ps1` — pré-requisitos (winget para MSYS2/.NET SDK), correções de renomeação do snapshot (idempotentes), submódulos + submódulos aninhados + patch `scripts/patches/moonlight-stdatomic-guards.patch`, deps ucrt64 via pacman, cmake+ninja (gcc), `cpack -G WIX`, cópia do MSI para `resources/programs/kloud-games/`; (2) `npm run package`. Nenhum passo manual necessário.
> - Limpeza pendente (decisão do usuário): diretório `third-party/` do kloud-games são repositórios git aninhados (untracked); `kloud-games/cmake-build-windows/` pode ser apagado/regenerado.

> **Nota adicional:** O Mark LVI está embutido no instalador via `extraResources`. O Kloud Games seria embutido da mesma forma, mas o build falha neste ambiente (erros de headers C++ sob linkage C / incompatibilidades de toolchain). O Kloud Games ficou fora do instalador conforme decisão do usuário; se quiser embuti-lo depois, será necessário corrigir o código para compilar com GCC/Clang atuais ou compilar em outra máquina.

---

## Estrutura das tarefas

Cada tarefa abaixo tem um ID, título, descrição, status e entregável esperado. Use isso como checklist de implementação.

---

### Fase 1 — Análise e preparação do ambiente

#### T-01: Auditar o projeto atual
- **Status:** Pendente
- **Descrição:** Revisar `kolnd-hub/package.json`, `electron-builder.yml`, `electron.vite.config.ts` e o código-fonte em `src/main/` para entender como os processos são lançados e como o build é gerado. Confirmar que o renderer salva configurações em `localStorage`.
- **Entregável:** Lista de arquivos que precisam ser modificados e confirmação de que `electron-builder` está funcionando (`npm run package` gera `dist/Kolnd Hub Setup 1.0.0.exe`).

#### T-02: Decidir estratégia de empacotamento dos 3 programas (CONCLUÍDA)
- **Status:** Concluído
- **Descrição:** Analisado o tamanho dos programas locais:
  - Mark LVI: ~728 MB de fonte, .exe já built em `resources/programs/MarkLVI/` (~611 MB)
  - kloud-games: ~10,5 MB de fonte C++ (requer MSYS2/UCRT64+CMake), sem .exe pronto
  - Playnite: ~20,9 MB de fonte .NET, sem .exe pronto
- **Decisão final (atualizada em relação ao plano original):**
  - Mark LVI **embutido** no instalador via `extraResources` (~600 MB).
  - Kloud Games **não embutido** (o snapshot não compila neste ambiente: GCC 16 + Clang 23 incompatíveis com o código que exige C++23 e headers C em `extern "C"`).
  - Playnite e SteamGridDB Manager **removidos do projeto** por decisão do usuário.
- **Entregável:** Decisão documentada. O instalador embute apenas Mark LVI + Kolnd Hub.

---

### Fase 2 — Detecção de primeira execução

#### T-03: Criar mecanismo de flag de primeira execução — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Criado `src/main/firstRun.ts` com `isFirstRun()`, `markFirstRunComplete()`, `resetFirstRun()` e `getFlagPath()`. Integrado no `src/main/index.ts`:
  - Import de `isFirstRun` e `markFirstRunComplete`
  - `createWindow(isFirstRunMode)` aceita parâmetro e passa `?first-run=1` na URL/query
  - IPC handlers `firstRun:check` e `firstRun:markComplete` expostos
  - `app.whenReady()` verifica `isFirstRun()` antes de criar a janela
- Preload atualizado: `src/preload/index.ts` e `src/preload/index.d.ts` expõem `firstRunCheck()` e `firstRunMarkComplete()` via `window.api`
- Flag salva em `app.getPath('userData')/first-run-complete.flag`
- **Entregável:** Mecanismo de detecção de primeira execução funcionando. TypeScript compila sem novos erros (erros pré-existentes do OpenCode IA não contam).

#### T-04: Criar tela de instalação (First Run UI) — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Criado `src/renderer/src/components/FirstRunInstall.tsx` com:
  - Barra de progresso global (baseada em etapas concluídas)
  - Lista de 5 etapas com ícones e status (pending/running/done/error)
  - Log em tempo real (área monoespaçada com scroll automático)
  - Botão de cancelar/tentar novamente mais tarde quando há erro
  - Chama `window.api.firstRunMarkComplete()` ao finalizar
  - `App.tsx` modificado para detectar `?first-run=1` na URL e renderizar `<FirstRunInstall>` no lugar do dashboard
  - `index.d.ts` atualizado para expor todos os métodos do preload (corrigido desatualização pré-existente)
  - Erro pré-existente em `stopApp` (2 argumentos) corrigido para 1 argumento
- **Entregável:** Componente de UI funcional exibindo etapas de instalação (atualmente simuladas; instalação real será na T-08).

#### T-05: Conectar main process com a tela de instalação via IPC — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Criada a ponte IPC completa entre o processo principal e a tela de instalação:
  - `src/main/firstRunInstaller.ts` criado — `FirstRunInstaller` emite eventos `progress`, `log`, `complete`; `registerFirstRunIpc(getWindow)` registra `firstRun:start` e `firstRun:cancel`
  - `src/main/index.ts` — importa `registerFirstRunIpc` e chama após `setBaseDir`, passando `() => mainWindow`
  - `src/preload/index.ts` — expõe `firstRunStart()`, `firstRunCancel()`, `onFirstRunProgress()`, `onFirstRunLog()`, `onFirstRunComplete()`
  - `src/preload/index.d.ts` — tipos adicionados para os novos canais
  - `src/renderer/src/components/FirstRunInstall.tsx` — reescrito para usar IPC em vez de simulação local; ao montar chama `firstRunStart()` e ouve os eventos para atualizar etapas/logs; botão Cancelar chama `firstRunCancel()`
- **Entregável:** Comunicação bidirecional funcionando entre main process e renderer. A instalação real (downloads/comandos) será implementada na T-08; por enquanto o orquestrador emite eventos simulados.

---

### Fase 3 — Script de instalação automática (bootstrap)

#### T-06: Criar verificador de dependências do sistema — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Criado `src/main/dependencyChecker.ts` com:
  - `checkDependencies()` — verifica Python (py/python/python3) e pip
  - `formatDependencyReport()` — gera relatório em texto
  - `DependencyCheckResult` — relatório booleano estruturado
  - Integrado no `src/main/firstRunInstaller.ts`: etapa `check` agora usa verificação real em vez de simulação; emite logs reais com o resultado
  - **Atualização:** Playnite removido do verificador por decisão do usuário.
- **Entregável:** Relatório booleano de dependências funcionando. A etapa `check` da primeira execução agora verifica de verdade o sistema.

#### T-07: Criar instalador silencioso de pré-requisitos — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Criado `src/main/silentInstaller.ts` com:
  - `isWingetAvailable()` — detecta se o `winget` está disponível
  - `installPython()` — instala Python 3.12 via winget silenciosamente (`--silent --accept-package-agreements`)
  - ~~`installPlaynite()`~~ — REMOVIDO: Playnite não faz mais parte do projeto
  - ~~`installMissingPrerequisites()`~~ — REMOVIDO por completo
  - `firstRunInstaller.ts` atualizado: etapa `python` usa instalação real; etapa `playnite` removida
- **Entregável:** Instalação silenciosa de Python implementada. Playnite removido do projeto por decisão do usuário.

#### T-08: Implementar implantação dos 3 programas — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Criado `src/main/programsDeployer.ts` com:
  - `deployMarkLvi()` — verifica `resources/programs/MarkLVI/MarkLVI.exe`; se faltar, tenta copiar de `../Mark-LVI/dist/MarkLVI`; se não existir em nenhum lugar, reporta erro
  - ~~`deployPlaynite()`~~ — REMOVIDO: Playnite não faz mais parte do projeto
  - `deployKloudGames()` — verifica `resources/programs/kloud-games/KLOUD_GAMES.exe`; se faltar, reporta que é necessário compilar o Kloud Games (via `scripts/build-kloud-games.ps1`)
  - `deployPrograms()` — orquestra a verificação dos 2 programas
  - Integrado no `src/main/firstRunInstaller.ts`: etapa `programs` usa implantação real; se nenhum programa for disponível, falha; se algum estiver indisponível, avisa no log mas não bloqueia
  - **Atualização:** Kloud Games agora está sendo compilado do fonte para ser EMBUTIDO no instalador via `extraResources` (não mais "build manual pelo usuário").
- **Entregável:** Todos os programas verificados/configurados pela primeira execução. Mark LVI embutido; Kloud Games embutido após o build (`scripts/build-kloud-games.ps1` ou `scripts/build-all.ps1`).

#### T-09: Configurar automaticamente os comandos no Hub — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Modificado `src/renderer/src/App.tsx` para salvar automaticamente os comandos e diretórios padrão no `localStorage` ao concluir a primeira execução:
  - Nova função `saveDefaultAppConfigs()` — salva `defaultApps` no `localStorage` com a chave `'kolnd-hub-apps'` (a mesma chave usada pela tela de Configurações)
  - a `onComplete` do `FirstRunInstall` agora chama `saveDefaultAppConfigs()` antes de finalizar a UI
- **Entregável:** `localStorage` populado com comandos e diretórios corretos para os 3 programas após a primeira execução. O usuário poderá ver e ajustar esses valores na tela de Configurações.

#### T-10: Criar marcador de instalação concluída — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** O marcador de primeira execução já estava implementado parcialmente; agora está robusto e redundante:
  - `src/main/firstRunInstaller.ts` — ao finalizar a instalação com sucesso, chama `markFirstRunComplete()` **antes** de emitir `complete` para o renderer
  - `src/main/index.ts` — IPC `firstRun:markComplete` também chama `markFirstRunComplete()` (idempotente)
  - `kolnd-hub/src/renderer/src/components/FirstRunInstall.tsx` — chama `window.api.firstRunMarkComplete()` ao receber sucesso
  - Flag salva em `app.getPath('userData')/first-run-complete.flag`
  - Na próxima abertura, `isFirstRun()` retorna `false` e o app carrega direto o dashboard
- **Entregável:** Flag escrita de forma redundante (main process + renderer); segunda execução pula a tela de instalação.

---

### Fase 4 — Build e empacotamento (.exe)

#### T-11: Ajustar electron-builder.yml para incluir recursos extras — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** `electron-builder.yml` atualizado/verificado para embutir os programas no instalador:
  - `extraResources` copia `resources/programs/` para `<install-dir>/resources/programs/` (MarkLVI.exe + _internal/)
  - Filtros excluem dados sensíveis/pessoais do MarkLVI (`config/api_keys.json`, `config/certs/`, `config/whatsapp_web/`, `memory/`)
  - `files` exclui `resources/programs/**` do app.asar para evitar duplicação
  - NSIS configurado como instalação por usuário (`perMachine: false`) para manter a pasta gravável
  - `src/main/programsDeployer.ts` ajustado para encontrar programas em `process.resourcesPath/programs` em produção e `<project>/resources/programs` em dev
- **Entregável:** `electron-builder.yml` configurado para embutir os programas no `.exe`. Em produção, MarkLVI será encontrado em `<install-dir>/resources/programs/MarkLVI`.

#### T-12: Gerar o instalador .exe final — CONCLUÍDA
- **Status:** Concluído
- **Descrição:** Rodado `npm run package` (electron-vite build + electron-builder --win). Gerado `dist/Kolnd Hub Setup 1.0.0.exe` (~273 MB, 11/11/2026). Verificado que `dist/win-unpacked/resources/programs/MarkLVI/MarkLVI.exe` está embutido.
- **Entregável:** Arquivo `.exe` funcional em `dist/`: `dist/Kolnd Hub Setup 1.0.0.exe` ✅

---

### Fase 5 — Testes e validação

#### T-13: Testar em Windows limpo (sem dependências pré-instaladas) — PARCIAL (best-effort nesta máquina)
- **Status:** Parcial (concluída em modo best-effort; máquina de teste NÃO é limpa)
- **Descrição:** Não há VM/Sandbox/Hyper-V disponível no ambiente. O usuário autorizou o teste nesta máquina (que tem Python e winget instalados). Procedimento executado em 11/11/2026:
  1. Backup completo de `%APPDATA%\kolnd-hub` para `kolnd-hub-userdata-backups\kolnd-hub-t13-20261111-165211`
  2. Incidente: pasta de dados foi movida com o app aberto → movimentação parcial; dados restaurados integralmente do backup após encerrar os processos (autorizado pelo usuário). App em execução foi encerrado e restaurado.
  3. Instalador `dist\Kolnd Hub Setup 1.0.0.exe` executado com `/S` → ExitCode 0; `%LOCALAPPDATA%\Programs\Kolnd Hub\` atualizado (exe de 11/11/2026 16:47); `resources\programs\MarkLVI\MarkLVI.exe` presente na instalação ✅
  4. `%APPDATA%\kolnd-hub` movida para simular primeira execução; app instalado aberto
  5. **Resultado:** `first-run-complete.flag` recriada automaticamente às 16:54:39 (segundos após o launch) — código só grava a flag no caminho de sucesso (`firstRunInstaller.ts` linhas 44-47), então o fluxo de primeira execução rodou até o fim ✅. App ficou com 4 processos ativos.
  6. Dados do usuário restaurados ao estado original (flag presente); app de teste encerrado.
- **Ressalvas / não verificado:**
  - Máquina NÃO limpa: Python e winget já instalados → a etapa de instalação silenciosa de Python (winget) NÃO foi exercitada de verdade.
  - Saída visual da tela de instalação não foi conferida (sem acesso à GUI); evidência = flag + processos + código.
  - Conteúdo do `localStorage` (`kolnd-hub-apps`) não pôde ser lido (leveldb travado pelo app em execução).
  - Para validação completa, rodar o `.exe` em VM limpa (Windows Sandbox/Hyper-V/outra máquina).
- **Entregável:** Relatório acima. Etapas: instalação do `.exe` ✅, detecção de primeira execução ✅, execução do fluxo até o fim ✅, instalação de Python em máquina limpa ⚠️ não testada.

#### T-14: Verificar se os programas iniciam pelo Hub — PARCIAL (Kloud Games indisponível por decisão de build)
- **Status:** Parcial
- **Descrição:** Teste em 11/11/2026 pelo instalador NSIS (`%LOCALAPPDATA%\Programs\Kolnd Hub`), app aberto pelo usuário:
  1. **Mark LVI (JARVIS)** — usuário clicou em "Iniciar" no card; processo `MarkLVI.exe` (PID 22940) confirmado em execução, com a cadeia Hub (PID 9888) → cmd.exe (PID 20520) → `MarkLVI.exe`, a partir de `resources\programs\MarkLVI\MarkLVI.exe` (caminho instalado correto). ✅
  2. **Kloud Games** — usuário NÃO clicou no card (ou sem efeito); verificação independente confirma que `KLOUD_GAMES.exe` **não existe** na instalação (`resources\programs\kloud-games\` contém apenas `README.txt`). Spawn manual retorna `'KLOUD_GAMES.exe' não é reconhecido como um comando interno ou externo` (ExitCode 1). ❌ esperado — Kloud Games não é embutido no instalador (ver T-02/T-08); requer compilação via `scripts/build-kloud-games.ps1` e novo build/instalação.
  3. Nota: a "lista de 3 programas" da tarefa está desatualizada — o projeto gerencia apenas 2 (Mark LVI e Kloud Games); Playnite foi removido por decisão do usuário.
- **Como verificar você mesmo:** no app aberto, clicar em "Iniciar" no card Kloud Games → o card deve exibir erro de comando não encontrado; instalar/compilar o Kloud Games e refazer o build (`build-installer.bat`) para incluí-lo.
- **Atualização 11/11/2026:** o Kloud Games agora é compilado do fonte (MSI próprio, `KLOUD_GAMES.msi` embutido no instalador, instalado na 1ª execução via UAC). A instalação do MSI ainda NÃO foi testada nesta máquina — pendente de validação (instala serviço + firewall).
- **Entregável:** Mark LVI inicia pelo Hub ✅; Kloud Games inicia ❌ verificado em execução real — MSI embutido, aguardando teste de instalação.

#### T-15: Testar comportamento na segunda execução
- **Status:** Pendente
- **Descrição:** Fechar e reabrir o Kolnd Hub; verificar que vai direto para o dashboard (não reinicia a instalação).
- **Entregável:** Flag de primeira execução respeitada.

#### T-16: Tratamento de erros e rollback parcial
- **Status:** Pendente
- **Descrição:** Se uma etapa falhar (ex: Playnite não instalou), o script deve logar o erro, continuar com as próximas se possível, e informar ao usuário quais programas ficaram indisponíveis.
- **Entregável:** Tela de instalação exibe erros por etapa; app não trava completamente por causa de um programa.

---

### Fase 6 — Documentação e entrega

#### T-17: Atualizar README.md com instruções de distribuição
- **Status:** Pendente
- **Descrição:** Documentar como gerar o `.exe`, como funciona a primeira execução, requisitos de internet (se houver download sob demanda) e notas sobre antivírus/UAC.
- **Entregável:** README atualizado.

#### T-18: Revisar riscos de antivírus e assinatura de código
- **Status:** Pendente
- **Descrição:** Avaliar se o `.exe` pode ser sinalizado como suspeito pelo Windows Defender (baixa e executa vários instaladores). Considerar code signing certificate se for distribuir publicamente.
- **Entregável:** Análise de risco e recomendação de assinatura.

---

## Ordem sugerida de execução

```
T-01 → T-02 → T-03 → T-04 → T-05 → T-06 → T-07 → T-08 → T-09 → T-10
   → T-11 → T-12 → T-13 → T-14 → T-15 → T-16 → T-17 → T-18
```

---

## Notas importantes

- **Tamanho do instalador:** Se optar por embutir todos os 3 programas + Python + Playnite dentro do `.exe`, o instalador ficará muito grande (provavelmente centenas de MB). A opção mais viável é baixar os instaladores oficiais na primeira execução (requer internet).
- **Privilégios de administrador:** Instalações de sistema (Python, Playnite) exigem UAC. O usuário verá prompts do Windows pedindo permissão.
- **Antivírus:** Um único `.exe` que baixa e executa vários instaladores pode ser detectado como falso positivo. Testar com Windows Defender antes de distribuir.
- **DeepSeek Harness e SteamGridDB Manager:** Se você reintroduzir esses programas no README e no código do Hub, adicione tarefas extras para instalar Node.js, pnpm e npm como dependências deles.

---

**Local do arquivo:** `C:\Users\TiffoDi\desenv\Kolnd Hub\task.md`
**Projeto:** Kolnd Hub (`kolnd-hub/`)
**Stack:** Electron 28 + electron-vite + React 18 + TypeScript + Tailwind CSS