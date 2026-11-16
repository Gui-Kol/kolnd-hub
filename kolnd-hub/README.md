# ⚡ Kolnd Hub

Hub centralizado para iniciar, parar e monitorar os programas do ecossistema Kolnd, com interface desktop moderna (glassmorphism), bandeja do sistema e logs ao vivo.

> Contribuidores e agentes: regras operacionais em [AGENTS.md](AGENTS.md) e arquitetura técnica (processos, IPC, store, first-run, Big Picture, segurança) em [../docs/architecture.md](../docs/architecture.md). O histórico de mudanças fica em [../CHANGELOG.md](../CHANGELOG.md) (atualizado a cada release — ver "Como manter" lá).

## Stack

- Electron 28 + electron-vite
- React 18 + TypeScript
- Tailwind CSS 3 + Framer Motion
- lucide-react (ícones)

## Pré-requisitos

- **Node.js 22 LTS** (ou superior) e npm
- Windows (o gerenciamento de processos usa `tree-kill`/`taskkill`)

## Comandos

```bash
npm install       # instala as dependências
npm run dev       # abre o app em modo desenvolvimento (HMR)
npm run build     # gera os bundles em out/
npm run package   # gera os bundles + instalador NSIS em dist/

npm run typecheck # tsc --noEmit nos projetos main e renderer
npm test          # testes unitários (Vitest) de renderer/lib e main
npm run test:coverage # testes + relatório de cobertura (V8) em ./coverage
npm run test:e2e   # smoke E2E do Hub: build + Playwright no Electron real
npm run lint      # ESLint (flat config, typescript-eslint + react-hooks)
npm run format    # Prettier --write

npm run verify    # typecheck → lint → format:check → testes (gate único pré-commit)
npm run verify:build # verify + build (gate completo antes de empacotar)
```

## Qualidade e CI

- **Vitest** cobre a lógica pura (`lib/startup.ts`, `lib/appsConfig.ts`, `lib/spatialNav.ts`, `lib/gamepad/*` (perfis e detecção), `main/commandLine.ts`, `main/steamScanner.ts`, `main/wingetUpdater.ts`) — sem Electron, sem DOM.
- **ESLint 10** (flat config) + **Prettier** mantêm o estilo consistente.
- **GitHub Actions** (`.github/workflows/ci.yml`, `windows-latest`): `npm ci` → **Audit (informativo)** → typecheck → lint → format:check → testes → **Coverage (informativo)** → build → `npm run package` (com placeholders de `resources/programs/MarkLVI`, que não vai para o git). Artefatos: `dist/Kolnd Hub Setup *.exe` e `coverage/` (ambos 7 dias).

### Cobertura de testes (V8)

- `npm run test:coverage` roda `vitest run --coverage` (provider **V8**, reporters `text`/`html`/`lcov`, saída em `kolnd-hub/coverage/`, gitignored).
- **Medição atual (13/11/2026):** `src/main` ≈ **44,36%** linhas/statements, **79,36%** branches, **72,8%** functions; `renderer/src/lib` ≈ **98,87%** linhas; `renderer/src/lib/gamepad` ≈ **98,56%**; renderer de componentes e `preload` ≈ **0%** (não há testes de React/preload hoje). "All files" ≈ 17,9% porque a suíte só cobre lógica pura.
- **Limiares** (`vitest.config.ts`, escopados a `src/main/**`): lines/statements **39**, functions **67**, branches **74** — ~5 p.p. abaixo da medição, conservadores de propósito. Hoje eles são **informativos**: o CI tem o step **Coverage (informativo)** com `continue-on-error: true`, que imprime o resumo e sobe o artifact `coverage/` (7 dias). Falha de limiar no log = sinal de regressão, **não** de build quebrado; promover para bloqueante é decisão futura, com a base já verde e medida.
- `npm test` (sem coverage) permanece inalterado e é o gate de `npm run verify`.

### Smoke E2E (Playwright)

- `npm run test:e2e` encadeia `npm run build` + `playwright test --config=tests/e2e/playwright.config.ts`. O smoke (`tests/e2e/smoke.spec.ts`) abre o Hub no **Electron real**, espera o Dashboard, clica no 1º card e confere o modal de detalhe (abre; `Esc` fecha); ao final exige zero invocações de `winget`/`msiexec` (via `stubs.log`).
- **Pré-requisitos:** Windows com display disponível (o Electron abre janela real — não é headless-first) e o build em `out/` (o script já faz `npm run build` antes). `npx playwright install` **não** é necessário: o smoke usa o Electron do próprio projeto, não navegadores baixados.
- **Isolamento:** `userData` vai para um diretório temporário com `first-run-complete.flag` semeada (via env `KOLDND_HUB_TEST_USERDATA`, ver o hook documentado em `src/main/index.ts`) — nada em `%APPDATA%\kolnd-hub` real é lido/gravado; o teardown (`global-teardown.ts`) remove o diretório.
- **Stubs:** `winget.exe`/`msiexec.exe` são PEs compilados em runtime via Add-Type do .NET Framework (`tests/e2e/stubs.ts`) — `spawn('winget')` sem shell exige executável de verdade no Windows. Cada stub anexa `<nome> <args>` a `stubs.log` e sai com 0. O smoke não invoca nenhum dos dois; o stub existe como mecanismo para futuros fluxos E2E.
- `tests/e2e/` fica **fora** do Vitest (`vitest.config.ts` intacto) e dos testes unitários.
- **Job `e2e` no CI: NÃO habilitado** (decisão à parte do usuário — tarefa 04-4.1, T9). `windows-latest` tem sessão com display, mas o custo/runner é uma decisão separada; por padrão o smoke roda localmente.

### Auditoria de dependências e segurança (CI)

- **Audit (informativo)** — o step `npm audit --audit-level=high` roda em todo push/PR, mas tem `continue-on-error: true`: **não reprova o build**. Ele existe para dar visibilidade a CVEs conhecidas em dependências (ex.: Electron 28 fora de suporte); cada vulnerabilidade high/critical encontrada vira item/issue próprio, não é corrigida no CI. **Bloqueante é uma promoção futura**: só tornar o step bloqueante depois de zerar os highs atuais — até lá, falha de audit no log = sinal de atenção, não de build quebrado.
- **Dependabot** (`.github/dependabot.yml`) — atualização semanal de dependências npm (`/kolnd-hub`) e de GitHub Actions (`/`), com limite de 5 PRs abertos e labels `dependencies`. Apenas minor/patch são propostos automaticamente; majors ficam para avaliação manual.
- **CodeQL** (`.github/workflows/codeql.yml`) — análise estática `javascript-typescript` em push (`main`/`Dev`), PRs e schedule semanal (`ubuntu-latest`, build-mode `none`). O repositório é **público**, então o CodeQL roda gratuitamente; resultados aparecem na aba **Security** → code scanning (primeiro run em 13/11/2026: verde, 0 alertas).

## Verificação pré-commit: `npm run verify`

Um único comando roda toda a porta de qualidade local, na ordem:

```bash
npm run verify        # typecheck && lint && format:check && test
npm run verify:build  # verify + build (gate completo antes de empacotar)
```

Falha no primeiro gate interrompe a sequência no lugar certo (typecheck antes de lint, lint antes de format, format antes dos testes). Exit code ≠ 0 se qualquer gate falhar.

Checklist antes de **todo commit/PR**:

- [ ] `npm run verify` verde (obrigatório)
- [ ] `npm run verify:build` verde se você mexeu em build/empacotamento/dependências
- [ ] README/docs atualizados quando o comportamento mudou

> **Sessões de agente (OpenCode e afins):** nunca commite — nem declare uma tarefa concluída — sem `npm run verify` ter passado. É o gate único que substitui rodar os quatro comandos à mão e deve preceder qualquer `git commit`/`git push`.
>
> Não há husky/lint-staged configurados (decisão: zero dependência nova); o hook local é a disciplina de quem commita. Se o projeto quiser hooks automáticos no futuro, é uma decisão à parte (nova devDependency).

## Primeira execução

Na primeira abertura, o app detecta a ausência do marcador `first-run-complete.flag` (salvo em `%APPDATA%\kolnd-hub`) e exibe uma tela de instalação com as etapas:

1. **Verificação de dependências** — Python e pip;
2. **Python** — instala silenciosamente via `winget` (`--silent --accept-package-agreements`), apenas se necessário;
3. **Kloud Games** — instala o MSI embutido em `resources/programs/kloud-games/KLOUD_GAMES.msi` via UAC (assistente visível: `msiexec /i … /norestart`, elevado com `Start-Process -Verb RunAs` — não usa `/quiet`). Falha aqui **não bloqueia** o uso do Hub;
4. **Programas** — verifica a implantação do Mark LVI e do Kloud Games;
5. **Finalização** — salva os comandos/diretórios padrão e grava o marcador de primeira execução.

Nas próximas aberturas o app vai direto para o dashboard. A flag fica em `%APPDATA%\kolnd-hub\first-run-complete.flag`.

O roteiro de validação desse fluxo em máquina/VM limpa — pré-requisitos, passos com checkbox, cenários de falha (winget ausente, UAC negado), logs a observar e limitações — está em [`../docs/FIRST-RUN-CHECKLIST.md`](../docs/FIRST-RUN-CHECKLIST.md). **Status real: checklist preparado (15/11/2026); execução em VM pendente — o fluxo ainda não foi validado em ambiente limpo.**

## Gerando o instalador com tudo embutido

> O processo completo de release — bump de versão, teste em máquina limpa, build, verificação da desinstalação e publicação com checksum — está em [`../docs/RELEASE.md`](../docs/RELEASE.md) (fonte única do processo; este README não o duplica).

O instalador único (`Kolnd Hub Setup <versão>.exe`) embute os programas que o Hub precisa, via `extraResources` no `electron-builder.yml` (eles ficam em `<instalação>/resources/programs/...`):

| Programa          | Origem                         | Status                                                                                                                                            |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mark LVI (JARVIS) | `Mark-LVI/` (PyInstaller)      | ✅ Embutido no instalador em `resources/programs/MarkLVI`                                                                                         |
| Kloud Games       | `kloud-games/` (CMake + MSYS2) | ✅ Embutido como MSI (`resources/programs/kloud-games/KLOUD_GAMES.msi`, ~53 MB), instalado na primeira execução em `C:\Program Files\KLOUD_GAMES` |

Na raiz do repositório, `build-installer.bat` faz tudo em um comando: compila o Kloud Games e gera o MSI (`scripts/build-kloud-games.ps1`) e depois empacota o Hub (`npm run package`). Para o passo a passo:

```bash
# 1) compilar o Kloud Games e gerar o MSI (heavy: MSYS2 + toolchain, ~30-60 min)
powershell -ExecutionPolicy Bypass -File scripts\build-kloud-games.ps1

# 2) reconstruir o Mark LVI (opcional, PyInstaller)
powershell -ExecutionPolicy Bypass -File scripts\build-mark-lvi.ps1

# 3) gerar o instalador
npm run package
```

Ou tudo de uma vez (Mark LVI + Kloud Games + instalador):

```bash
powershell -ExecutionPolicy Bypass -File scripts\build-all.ps1
# opções: -SkipMarkLvi, -SkipKloudGames, -SkipPackage
```

Depois de rodar a build de um programa, rode `npm run package` de novo para que o instalador pegue a versão nova.

**Segredos nunca vão para o instalador**: `config/api_keys.json`, `config/certs/`, `config/whatsapp_web/`
e `memory/` são excluídos do pacote (veja o `filter` em `extraResources` no `electron-builder.yml`).

> ⚠️ **Dados do Mark LVI e desinstalador**: o `MarkLVI.exe` empacotado grava a chave de API e a memória **na pasta do executável** (`<instalação>/resources/programs/MarkLVI/`). Ao desinstalar o Kolnd Hub (botão **"Desinstalar Kolnd Hub"** nas Configurações → zona de perigo, ou pelo aplicativo Configurações do Windows), o NSIS remove **o diretório da instalação inteiro** — inclusive esses dados. O botão **"Fazer backup dos meus dados"** copia apenas `%APPDATA%\kolnd-hub` para `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss`; ele **não** cobre os dados ao lado do `MarkLVI.exe`. Copie manualmente `<instalação>\resources\programs\MarkLVI\config` e `<instalação>\resources\programs\MarkLVI\memory` antes de desinstalar (ou confie na semente migrada para `%APPDATA%\kolnd-hub\mark-lvi` pelo `programsDeployer`). O backup não é automático.
>
> **Migração para a pasta de dados do usuário**: a partir da próxima reconstrução do Mark LVI (`scripts/build-mark-lvi.ps1`, com `core/paths.py` honrando `MARK_LVI_HOME`), o assistente passa a gravar em `%APPDATA%\kolnd-hub\mark-lvi`. O Hub define `MARK_LVI_HOME` automaticamente ao iniciar o `mark-lvi`, e **semeia** (copia, sem apagar) `config/` e `memory/` do bundle empacotado para essa pasta a cada boot — quem já usava a versão anterior não perde a chave de API nem a memória na troca. Dados já existentes ao lado do `.exe` continuam sendo uma cópia válida e só deixam de ser atualizados depois que o Mark LVI reconstruído assume.

## Como usar

1. Abra o app e clique em **Iniciar** no card do programa.
2. Clique no card para ver detalhes, abrir a pasta e acompanhar os **logs**.
3. O botão **X** fecha para a bandeja; use o ícone da bandeja para reabrir.
4. Em **Configurações**, ajuste comando e diretório de trabalho de cada programa.

Caminhos aceitam:

- caminhos relativos (resolvidos a partir do diretório do Hub), ex.: `../Mark-LVI`
- caminhos absolutos, ex.: `C:\Program Files\KLOUD_GAMES`
- variáveis de ambiente, ex.: `%USERPROFILE%\Documents\My Games\kloud-games`

As configurações são salvas no **electron-store** (`%APPDATA%\kolnd-hub\config.json`, com schema e migrações versionadas — a mais recente é a **'1.4.0'**, que adiciona as chaves do modo Big Picture), sem mais sumir ao limpar os dados do navegador. Na primeira execução de uma versão com o store novo, o Hub migra automaticamente o que estava no `localStorage` (as chaves antigas viram `.bak`). Se o store estiver indisponível/corrompido, o app cai de volta no `localStorage` e funciona normalmente.

Por padrão os comandos rodam via **shell (cmd.exe)** — preserva aspas e argumentos. Desative "Executar via shell" em Configurações apenas para comandos simples, sem aspas/argumentos complexos: nesse caso a linha é separada em argv e o processo é executado **sem** interpretação de shell.

> ⚠️ A instalação do MSI do Kloud Games na primeira execução **ainda não foi validada em máquina limpa** (sem Python/winget pré-instalados e com UAC aprovado). O checklist reutilizável para essa validação está em [`../docs/FIRST-RUN-CHECKLIST.md`](../docs/FIRST-RUN-CHECKLIST.md) — **preparado (15/11/2026); execução em VM pendente**. Até que ela seja executada e registrada, qualquer afirmação de que o fluxo foi validado seria falsa. O roteiro do processo de release está em [`../docs/RELEASE.md`](../docs/RELEASE.md) (seção "Passo 2 — Teste em máquina limpa").

## Modo Big Picture

Interface em tela cheia otimizada para gamepad e TV (estilo Steam Big Picture).

- **Entrar:** botão **Big Picture** no rodapé da barra lateral, acima da versão. Sem controle configurado, o Hub abre a configuração antes de liberar a home ("pressione qualquer botão" detecta Xbox, PlayStation, Switch Pro ou genérico e aplica o perfil certo).
- **Usar:** D-Pad ou stick esquerdo navega, A/Cross confirma, B/Circle volta, LB/RB alternam as seções (**Jogos · Controle**), Start abre as opções. Mouse e teclado funcionam por inteiro em paralelo; os jogos da Biblioteca abrem direto da grade.
- **Configurar:** em **Configurações → Big Picture** dá para remapear botão a botão (conflito entre ações pede confirmação) e ligar/desligar os efeitos sonoros. Se o controle desconectar no meio do uso, um aviso aparece na hora e some ao reconectar.
- **Sair:** item **Sair do Big Picture** no rail, **B** na raiz ou **Esc** — devolve ao Hub normal sem fechar nada.

A configuração do controle fica no **electron-store** (chaves `gamepad` e `bigPicture`, migração **'1.4.0'**), então sobrevive a reinícios.

## Primeira execução, UAC e antivírus

Pontos de atenção para quem instala ou distribui o app:

### Prompts de UAC na primeira execução

A instalação do Hub em si (NSIS) é **por usuário** e não pede administrador. Mas a primeira execução dispara dois processos elevados:

1. **Python** — instalado via `winget` (`--silent --accept-package-agreements`), apenas se faltar no sistema;
2. **Kloud Games** — o MSI embutido é instalado com `msiexec /i … /norestart` elevado via `Start-Process -Verb RunAs` — assistente **visível**, sem `/quiet` (instala o serviço `KLOUD_GAMESsvc`, regras de firewall e o autostart).

Se você **negar o UAC do Kloud Games**, a etapa falha mas não bloqueia o uso do Hub — o MSI continua disponível em `<instalação>/resources/programs/kloud-games/KLOUD_GAMES.msi` para instalação manual posterior (`msiexec /i …` como administrador). Se negar o UAC do Python (quando ele faltar), o Mark LVI não funciona até o Python ser instalado.

### Antivírus / falso positivo

Um `.exe` único que dispara outros instaladores pode ser sinalizado como suspeito por heurísticas (comportamento típico de downloader/dropper):

- **Distribua por canal oficial** com o hash SHA-256 publicado junto — facilita a conferência manual.
- **Assine o código** (certificado de assinatura para executáveis). Sem assinatura, o SmartScreen provavelmente exibirá "aplicativo não reconhecido". Com assinatura, alertas heurísticos caem bastante.
- Máquinas corporativas com políticas rígidas (AppLocker, bloqueio de `powershell.exe` com `-Verb RunAs`) podem impedir a instalação silenciosa do MSI — nesse caso, instale o MSI manualmente como administrador.

Um `.exe` sinalizável também pode ser evitado compilando/assinando o instalador e o próprio `KLOUD_GAMES.msi` (WiX). Para distribuição pública, a assinatura de código é pré-requisito prático.

## Desinstalação

Em **Configurações**, no fim da página, a zona **"Zona de perigo"** tem dois botões. Nenhuma desinstalação acontece sem confirmação digitada (`KLOUD_GAMES` ou `Kolnd Hub`, sem diferenciar maiúsculas/minúsculas).

### Desinstalar Kloud Games

Fluxo elevado via UAC — o MSI é per-machine: `msiexec /x {ProductCode} /qn /norestart` através de PowerShell com `-Verb RunAs`. Remove:

- Programa e dados em `C:\Program Files\KLOUD_GAMES` (incluindo `config\`);
- Serviço `KLOUD_GAMESsvc`;
- Regras de firewall, `PATH` e atalhos do Menu Iniciar.

O Hub encerra o `KLOUD_GAMES.exe` antes de chamar o MSI — streams Moonlight em andamento são interrompidas; se não conseguir encerrá-lo (duas tentativas falharam), o MSI não é chamado e o erro aparece na tela com a instrução para fechar o Kloud Games manualmente. Se a desinstalação estiver em execução, a seção fica travada (sem clique duplo/segundo botão) e a janela não fecha até o fim.

Se a instalação estiver quebrada, a confirmação oferece saídas honestas em vez de fingir que funcionou: "Remover somente os arquivos restantes" (apaga somente a pasta de instalação detectada — `C:\Program Files\KLOUD_GAMES` — nunca fora dela, com trava de alvo e de nome da pasta), "Desinstalar pelo registro" (o MSI ainda consta), ou, se só restou o serviço, "Remover serviço agora" (elevado, com confirmação própria).

Este botão **nunca** apaga `%APPDATA%\kolnd-hub` — suas preferências do Hub continuam salvas. Erros/UAC negado aparecem na tela com a causa e a opção de tentar de novo; a desinstalação é idempotente (executar de novo após sucesso parcial converge).

### Desinstalar Kolnd Hub

Funciona **apenas no app empacotado** com desinstalador NSIS presente — em `npm run dev` o botão fica desabilitado de propósito. O desinstalador do Hub é **per-user e não exige administrador**.

Sequência, nesta ordem:

1. **Resolver o desinstalador** (antes de qualquer destruição); se ele não for encontrado, o erro aparece na hora e nada é apagado;
2. **Kloud Games** — o mesmo fluxo do botão acima (com UAC). Se falhar ou você negar o UAC, a sequência pausa e pergunta: **"Desinstalar só o Hub"** (segue sem o Kloud Games) ou **"Cancelar"** (nada é alterado);
3. **Backup** — se você clicou em "Fazer backup dos meus dados" antes de confirmar (opcional, manual), ele já aconteceu e o caminho é registrado no log do fluxo;
4. **Wipe** — somente se você escolheu "Apagar também meus dados e configurações (irreversível)": apaga o **conteúdo inteiro** de `%APPDATA%\kolnd-hub` item a item, tolerando falhas individuais (antivírus/arquivo travado) — os itens que falharem são listados no final;
5. **Spawn** — inicia o desinstalador NSIS desanexado e o Hub se encerra sozinho (killAll + destroy + `app.quit`). Se o spawn falhar, o Hub **não** fecha e nada do wipe é desfeito (você escolheu) — o erro aparece na tela com a instrução: desinstale pelo aplicativo **Configurações do Windows → Aplicativos → Kolnd Hub**.

O **NSIS não mudou**: `deleteAppDataOnUninstall: false` no `electron-builder.yml` permanece — o desinstalador do Windows **não** apaga `%APPDATA%\kolnd-hub` por conta própria, ou seja, `config.json` (electron-store), a flag de primeira execução, `logs\kolnd-hub.log` e o espelho `mark-lvi\` sobrevivem por padrão. A decisão de apagar ou manter os dados é sempre sua, na confirmação do Hub ("Apagar também meus dados e configurações" é a única coisa que os remove). Em compensação, **o NSIS sempre remove o diretório de instalação inteiro** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), **incluindo `resources\programs\MarkLVI\`** — os dados que a build atual do `MarkLVI.exe` grava ao lado do executável (config/api_keys.json, memory/) **são perdidos**, descontando o espelho parcial em `%APPDATA%\kolnd-hub\mark-lvi` mantido pelo Hub a cada boot (arquivos de nível superior de `config/`/`memory/`; subpastas como `certs/` e `whatsapp_web/` nunca são espelhadas). O texto completo está na seção "O que acontece com seus dados" do README raiz.

### Dados do usuário e logs

- `%APPDATA%\kolnd-hub` é **preservado por padrão** — inclusive `config.json`, `first-run-complete.flag`, `logs\kolnd-hub.log` e o espelho `mark-lvi\`. Apagado **somente** pela opção irreversível acima (ou manualmente por você). O que o NSIS **sempre** remove é o diretório de instalação (`%LOCALAPPDATA%\Programs\Kolnd Hub`), incluindo `resources\programs\MarkLVI\` com os dados ao lado do `MarkLVI.exe` (ver a seção "Desinstalar Kolnd Hub" acima e o README raiz).
- **"Fazer backup dos meus dados"** copia `%APPDATA%\kolnd-hub` para `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss`; execuções repetidas criam sufixos `-2`, `-3`, … — nunca sobrescreve um backup existente.
- **Logs**: `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log` registra o fluxo do Kloud Games (etapas, código de retorno do `msiexec`, laudo final) — inclusive a pausa da etapa do Kloud no fluxo do Hub (UAC negado etc.). O log completo do fluxo do Hub aparece **ao vivo** no modal de progresso; não há arquivo próprio para ele além desse. O botão **"Abrir pasta de logs"** (nas telas de resultado/erro) abre `%APPDATA%\kolnd-hub\logs` no Explorer.
- A preferência **"Iniciar Kloud Games junto com o Kolnd Hub"** (`launchKloudOnStart`) fica no `config.json` — sobrevive à desinstalação se os dados forem mantidos; quem decide apagá-la é a opção irreversível.
- Códigos de retorno **3010** e **1641** do `msiexec` significam "reinício necessário" — sucesso com aviso, não erro.

## Programas gerenciados

| Programa          | Comando padrão                                 | Observação                                                                                                           |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Mark LVI (JARVIS) | `MarkLVI.exe`                                  | Embutido no instalador em `resources/programs/MarkLVI` (PyInstaller)                                                 |
| Kloud Games       | `"%ProgramFiles%\KLOUD_GAMES\KLOUD_GAMES.exe"` | Embutido como MSI; instalado na primeira execução em `C:\Program Files\KLOUD_GAMES` (serviço + firewall + autostart) |

## Estrutura

```
src/
├── main/          # processo principal, janela, tray, IPC, primeira execução
│                  # (firstRun*, dependencyChecker, silentInstaller,
│                  #  programsDeployer, store), gerenciamento de processos
│                  # (processManager, commandLine) e seed dos dados do Mark LVI
├── preload/       # bridge segura (contextBridge; sandbox habilitado)
└── renderer/      # React (Dashboard, Settings, Inicialização, FirstRunInstall,
                   # Big Picture (modo gamepad/TV)…)
                   # config via electron-store com fallback localStorage (lib/hubConfig.ts)
```

## Solução de problemas

- **Desinstalação do Kloud Games (dev)**: os botões "Desinstalar Kloud Games" e "Desinstalar Kolnd Hub" ficam em Configurações → **Zona de perigo**. O Kloud Games pode ser desinstalado normalmente mesmo em `npm run dev`; o desinstalador do Hub (NSIS) **só funciona no app empacotado** (em dev o botão fica desabilitado de propósito). Após qualquer desinstalação do Kloud Games, na próxima abertura o Hub reinstala o MSI normalmente — o fluxo de 1ª execução não depende de nada além do estado zerado em `%APPDATA%\kolnd-hub\kloud-games.paths.json` (`exePath: null` é gravado pelo `resetKloudGamesState()`, inclusive nos caminhos de erro de remoção manual parcial).
- **Instalação quebrada do Kloud Games** (arquivos sem registro): o fluxo normal via MSI não funciona — a confirmação oferece **"Remover somente os arquivos restantes"** (apaga somente `C:\Program Files\KLOUD_GAMES` e zera o estado salvo; nunca altera o registro). Se o registro constar sem o executável, a desinstalação **pelo registro** funciona normalmente. Se só o serviço `KLOUD_GAMESsvc` restou, use o botão **"Remover serviço agora"** na tela de resultado (ação elevada, com confirmação própria).

- **"Diretório não encontrado"**: confira o campo _Diretório de trabalho_ em Configurações. Variáveis como `%LOCALAPPDATA%` são expandidas automaticamente.
- **Programa inicia e para com "Erro"**: abra o card e clique no ícone de logs para ver a saída do processo.
- **Comando não encontrado**: confirme que o executável está no `PATH` ou use o caminho completo no campo _Comando_.
- **Kloud Games não inicia**: confirme que o MSI foi instalado na primeira execução (`%ProgramFiles%\KLOUD_GAMES`). Se necessário, execute `msiexec /i resources\programs\kloud-games\KLOUD_GAMES.msi` manualmente como administrador.
- **Instalador sinalizado como falso positivo**: o `.exe` instala outros programas na primeira execução; veja a seção **Primeira execução, UAC e antivírus** acima antes de distribuir.
- **Configurações "sumiram"**: desde a versão com electron-store, elas ficam em `%APPDATA%\kolnd-hub\config.json`. Se o arquivo estiver corrompido, o app usa o fallback de `localStorage` — se você limpar `%APPDATA%\kolnd-hub`, perde a flag de primeira execução (o app roda o fluxo de instalação de novo) e as configurações. Mantenha backup do `config.json` a cada atualização manual.
- **"Não foi possível iniciar" / processo com aspas**: confira se "Executar via shell" está como desejado em Configurações (ver seção "Como usar").

> Branch de desenvolvimento: `Dev` (o `main` é mantido estável e não recebe commits diretos)
