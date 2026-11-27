# ⚡ Kolnd Hub

Central de controle do ecossistema Kolnd — um aplicativo desktop para **iniciar, parar e monitorar** os programas do ecossistema, com interface moderna, bandeja do sistema e logs ao vivo. Este repositório também contém os programas gerenciados pelo Hub e os scripts para gerar o instalador único (`.exe`) de tudo.

## Estrutura do repositório

| Pasta / arquivo            | O que é                                                                                                                                                                                                      | Stack                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `kolnd-hub/`               | O aplicativo Hub em si (dashboard, biblioteca de jogos, Meu PC, Big Picture, configurações, bandeja, primeira execução)                                                                                      | Electron 28 + electron-vite + React 18 + TypeScript + Tailwind CSS |
| `Absolem/`                 | **Absolem** — assistente de IA na área de trabalho, com avatar holográfico, voz em tempo real, memória local e Gemini                                                                                        | Electron 28 + electron-vite + React 18 + TypeScript                |
| `kloud-games/`             | **Kloud Games** — servidor self-hosted de streaming de jogos para Moonlight (fork do Sunshine, da LizardByte)                                                                                                | C++ / CMake / MSYS2 (UCRT64), gerado como MSI via WiX              |
| `build-installer.bat`      | Build completo em um único comando: compila o Kloud Games → MSI, depois empacota o Hub → `.exe`                                                                                                              | CMD + PowerShell                                                   |
| `.github/workflows/ci.yml` | CI: `npm ci` → typecheck → lint → format:check → testes (Vitest) → build → empacotamento NSIS em `windows-latest` + geração do `SHA256SUMS.txt` (informativo)                                                | GitHub Actions                                                     |

## O que tem no Hub

- **Dashboard** com o status de cada programa do ecossistema (rodando/parado, PID, logs ao vivo), iniciar/parar individual e ações em lote.
- **Biblioteca de jogos**: busca e adiciona automaticamente os jogos instalados na Steam, Epic Games e Minecraft Launcher (ou adiciona qualquer `.exe`), extrai o ícone do executável, permite escolher uma capa, renomeia/troca ícone, capa e `.exe`, inicia o jogo (ou foca a janela se já estiver aberto) e encerra a árvore de processos.
- **Chat**: o Go Live (grupos e salas de voz/texto) roda dentro do Hub em uma página própria, com microfone, câmera e compartilhamento de tela liberados apenas para a origem do site; links externos abrem no navegador padrão.
- **Meu PC**: programas que iniciam com o Windows (com classificação de importância e remoção), escala/resolução de tela, atualizações via `winget`, limpeza de temporários, **memória** (uso, cache/standby, commit, top processos, otimizações por clique e otimização automática opcional a cada 1–60 min, desligada por padrão — nada roda com o Hub fechado), benchmark de CPU e monitor de hardware (CPU/GPU, temperaturas, energia) com intervalo ajustável e **HUD** sobreposto ao jogo, com **FPS do app em primeiro plano**.
- **Big Picture**: interface em tela cheia navegável por controle (gamepad/TV).
- **Acesso remoto** (ZeroTier) e **atualização pelo próprio app**, descritos abaixo.
- **Bandeja do sistema** com abrir/ocultar, autostart opcional e encerramento; fechar a janela (X) mantém o Hub na bandeja.

## Programas gerenciados pelo Hub

| Programa                                                                | Como é distribuído                                                              | Instalação                                                                                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Absolem**                                                             | Embutido no instalador do Hub em `resources/programs/Absolem/` (build Electron) | Automática na primeira execução do Hub; roda direto da pasta e grava os dados em `%APPDATA%\absolem`                                                                 |
| **Kloud Games**                                                         | Embutido como MSI (`resources/programs/kloud-games/KLOUD_GAMES.msi`)            | Instalado na primeira execução via UAC (assistente visível do `msiexec /i … /norestart`, elevado com `Start-Process -Verb RunAs`), em `C:\Program Files\KLOUD_GAMES` |
| **IntelliJ, PyCharm, VS Code, Docker, Insomnia, OpenCode, Antigravity** | Atalhos configuráveis pelo usuário (não são instalados pelo Hub)                | Configurados em **Configurações** do app                                                                                                                             |

## Acesso remoto (jogar de qualquer lugar)

O Hub traz em **Configurações → Acesso remoto** o diagnóstico e o atalho para expor o Kloud Games fora de casa **sem abrir portas no roteador**. O caminho recomendado é o [ZeroTier](https://www.zerotier.com) (rede privada virtual):

- detecta se o ZeroTier está instalado e se o serviço está on-line, e mostra o endereço IPv4/IPv6 atribuído pela rede (com botão copiar) para digitar no Moonlight;
- instala via `winget` (UAC) e abre o app para entrar na sua rede — sempre por ação explícita, nunca em segundo plano; ingressar na rede é feito no app/painel do ZeroTier, o Hub não pede network ID;
- checa as portas TCP do Moonlight (`47984`, `47989`, `48010`) em localhost e no IP da VPN;
- consulta o IP público **apenas quando você clica**, para dizer se a rede é IPv4 direta, NAT ou CGNAT;
- explica o pareamento: o PIN que o Moonlight mostra é digitado no painel do Kloud Games (`http://localhost:47990`).

Por que não Cloudflare Tunnel/ngrok: eles carregam HTTP/TCP, não UDP — e vídeo, áudio e controle do Moonlight vão por UDP (`47998`–`48002`). Proxy HTTP serve para o painel, não para jogar. O Hub não guarda credenciais do ZeroTier; o `config.json` recebe apenas o último IP público consultado.

## Instalação para o usuário final

Baixe e execute `Kolnd Hub Setup <versao>.exe` (gerado em `kolnd-hub/dist/`; a versao atual esta em `kolnd-hub/package.json`). A instalação é **por usuário** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), sem exigir administrador — mas a primeira execução pode disparar elevação via UAC:

1. Instalação do **Python 3.x** via `winget`, apenas se ele não estiver presente (o Hub não eleva o winget explicitamente; se um UAC aparecer, é do próprio winget/instalador do pacote);
2. Instalação do **Kloud Games** a partir do MSI embutido (serviço + firewall + autostart) — sempre elevada via UAC, com assistente visível (sem `/quiet`).

Durante a primeira execução o app mostra uma tela de progresso com as etapas:

1. **Verificação de dependências** — Python e pip;
2. **Python** — instala via winget se faltar;
3. **Kloud Games** — instala o MSI embutido (falha não bloqueia o uso do Hub);
4. **Programas** — verifica a implantação do Kloud Games e do Absolem;
5. **Finalização** — salva os comandos/diretórios padrão e grava o marcador de primeira execução.

Na segunda abertura o app vai direto para o dashboard. O marcador fica em `%APPDATA%\kolnd-hub\first-run-complete.flag`.

### Atualização para uma versão nova

O Hub consulta **a cada abertura** a release estável mais recente do GitHub e, quando a tag `vX.Y.Z` é mais nova que a versão instalada, mostra o banner **"Nova atualização disponível"**:

- o download do Setup tem progresso e cancelamento;
- o instalador só é executado se a release publicar o **digest SHA-256** do `.exe` (o hash é conferido de novo imediatamente antes de abrir) e a assinatura Authenticode não estiver quebrada (`NotSigned` é aceito — o projeto ainda não assina código, então o SmartScreen pode alertar);
- release sem asset `.exe` anexado (ou sem digest) não habilita a atualização automática; nesse caso o banner só oferece abrir a página da release.

Atualizar **por cima** é o caminho suportado e preserva `%APPDATA%\kolnd-hub` (config, biblioteca, logs, ícones). Também é possível baixar o `Kolnd Hub Setup <versao>.exe` manualmente e executá-lo.

> Playnite e o SteamGridDB Manager foram removidos do projeto por decisão do usuário.

## Verificar integridade

Cada release publica `SHA256SUMS.txt` junto com os binários (`Kolnd Hub Setup <versao>.exe` e `KLOUD_GAMES.msi`). Para conferir o download:

```powershell
Get-FileHash -Algorithm SHA256 "Kolnd Hub Setup <versao>.exe"
```

Compare o `Hash` exibido com a linha do arquivo correspondente no `SHA256SUMS.txt` anexado à release. O arquivo é gerado automaticamente no build local e no CI (`kolnd-hub/dist/SHA256SUMS.txt`, via `kolnd-hub/scripts/gen-sha256sums.ps1`) e anexado à release junto com os binários (ver [`docs/RELEASE.md`](docs/RELEASE.md), Passo 7).

## Desinstalação

### Pelo próprio Kolnd Hub (recomendado)

Em **Configurações**, no fim da página, existe a zona **"Zona de perigo"** com dois botões. Nenhuma das duas desinstalações acontece sem confirmação digitada.

**"Desinstalar Kloud Games"** → remove o Kloud Games **inteiro** pelo instalador oficial do Windows (`msiexec /x {ProductCode}`, elevado via UAC):

- Programa e dados em `C:\Program Files\KLOUD_GAMES` (incluindo `config\`);
- Serviço `KLOUD_GAMESsvc`;
- Regras de firewall, `PATH` e atalhos do Menu Iniciar;
- Pede para digitar `KLOUD_GAMES` antes de confirmar. Se o Kloud Games estiver em execução, o Hub encerra o processo antes (streams Moonlight em andamento serão interrompidas); se não conseguir encerrá-lo, a desinstalação é bloqueada com instrução para fechá-lo manualmente;
- **Suas preferências do Hub (`%APPDATA%\kolnd-hub`) continuam salvas.** Nada fora disso é apagado (exceto pelos desinstaladores oficiais, que são quem remove o que é deles).
- Se a instalação estiver quebrada, a confirmação oferece saídas honestas em vez de fingir que funcionou: "Remover somente os arquivos restantes", "Desinstalar pelo registro" ou, se só restou o serviço, "Remover serviço agora".

**"Desinstalar Kolnd Hub"** → desinstala o Hub pelo desinstalador oficial do Windows (NSIS **per-user**, sem exigir administrador):

1. Primeiro o Hub desinstala o **Kloud Games** (se estiver instalado) — mesmo fluxo do botão acima, com UAC. Se algo falhar, você decide a cada passo: **"Desinstalar só o Hub"** (segue sem o Kloud Games) ou **"Cancelar"** (nada é alterado). Se o Kloud Games não estiver instalado, essa etapa é pulada. As configurações dele (`config\` da instalação, `%LOCALAPPDATA%\LizardByte\KLOUD_GAMES` e `%ProgramData%\KLOUD_GAMES`) são apagadas junto.
2. Se você escolheu apagar seus dados, apaga a pasta `%APPDATA%\kolnd-hub` e também `%APPDATA%\absolem` (ver abaixo).
3. Por fim, o desinstalador do Windows abre e o Hub se encerra sozinho para ele assumir. O Hub não abre mais depois disso.

- Pede para digitar `Kolnd Hub` antes de confirmar. Em `npm run dev` o botão fica desabilitado — só funciona no app instalado.
- O **Absolem** fica dentro da pasta do Hub em `resources/programs/Absolem` e sai com ela; as configurações dele em `%APPDATA%\absolem` seguem a sua escolha de dados (apagadas na opção irreversível, preservadas em "manter").

### O que acontece com seus dados

Em **qualquer** desinstalação (pelo botão do Hub ou pelo Windows), o padrão é:

- **Preservado — `%APPDATA%\kolnd-hub` inteiro**: `config.json` (electron-store), a flag de primeira execução (`first-run-complete.flag`), `logs\` (`kolnd-hub.log` e `kloud-games-uninstall.log`), `kloud-games.paths.json` e `game-icons\`. Nada disso é apagado pelo desinstalador NSIS (`deleteAppDataOnUninstall: false`), a menos que você escolha a opção irreversível no botão do Hub.
- **Removido — o diretório de instalação inteiro** (per-user: `%LOCALAPPDATA%\Programs\Kolnd Hub`), **incluindo `resources\programs\Absolem\`** (o programa em si; as configurações do Absolem ficam em `%APPDATA%\absolem` e seguem a escolha de dados).

Ao desinstalar o Hub pelo botão, você escolhe uma das duas opções:

- **"Manter meus dados e configurações (recomendado)"** — padrão; o que está em `%APPDATA%\kolnd-hub` e em `%APPDATA%\absolem` fica intacto (config, biblioteca, logs, ícones, flag de primeira execução, memória e chave do Absolem);
- **"Apagar também meus dados e configurações (irreversível)"** — apaga o **conteúdo inteiro** de `%APPDATA%\kolnd-hub` (config.json, `first-run-complete.flag`, `logs\`, `game-icons\` e qualquer outra coisa que estiver lá) **e** a pasta `%APPDATA%\absolem` (configurações, chave cifrada, memória, logs e Crashpad do Absolem). Não há como desfazer.

Resumindo em uma linha: **`%APPDATA%\kolnd-hub` e `%APPDATA%\absolem` são preservados por padrão; o diretório de instalação é removido**. A opção irreversível apaga também os dois diretórios de dados.

Duas regras importantes:

- O botão **"Fazer backup dos meus dados"** copia `%APPDATA%\kolnd-hub` para `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss` (se já existir, cria `KolndHub-Backup-AAAAMMDD-HHmmss-2`, `-3`, …). O backup é **opcional e manual** — não é automático; clique nele **antes** de confirmar a desinstalação se quiser guardar seus dados. **Atenção: o backup cobre apenas `%APPDATA%\kolnd-hub`.** As configurações do Absolem em `%APPDATA%\absolem` não entram nesse backup — copie essa pasta antes se quiser guardá-las.
- Fora de `%APPDATA%\kolnd-hub` e `%APPDATA%\absolem`, o Hub apaga as configurações do Kloud Games quando o desinstala (`config\` da instalação, `%LOCALAPPDATA%\LizardByte\KLOUD_GAMES` e `%ProgramData%\KLOUD_GAMES`). O resto da instalação do Kloud Games e a pasta do Hub saem pelos desinstaladores oficiais (MSI e NSIS).

Note que a preferência **"Iniciar Kloud Games junto com o Kolnd Hub"** (`launchKloudOnStart`, em `config.json`) também fica em `%APPDATA%\kolnd-hub` — ela sobrevive à desinstalação se você mantiver os dados; quem decide apagá-la é a opção de apagar tudo.

### Mark LVII (removido)

- O Mark LVII foi removido do ecossistema e não é mais distribuído pelo Hub.
- Instalações antigas podem manter a pasta `resources\programs\MarkLVII\` até serem desinstaladas/reinstaladas; ela sai junto com o diretório de instalação.

### Desinstalação manual pelo Windows (alternativa)

Você também pode desinstalar pelo sistema, sem abrir o Hub: **Configurações → Aplicativos**:

- "Kloud Games" → Desinstalar (executa o MSI; pede UAC); e
- "Kolnd Hub" → Desinstalar (executa o desinstalador NSIS; sem UAC).

É equivalente ao que os botões do Hub fazem. Códigos de retorno **3010** e **1641** do `msiexec` significam "reinício necessário para concluir a remoção" — é sucesso com aviso, não erro.

O desinstalador do Hub **não** guarda cópia dos seus dados e **não** apaga `%APPDATA%\kolnd-hub` — a decisão de apagar ou manter seus dados é sempre sua, dentro da "Zona de perigo" do Hub. Por outro lado, ele **remove o diretório de instalação inteiro** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), incluindo `resources\programs\Absolem\`. Não existe opção de "manter a pasta do programa" — o NSIS sempre a remove.

### Checklist de release: verificação da desinstalação

A verificação da desinstalação em máquina/VM limpa faz parte do processo de release e **não é duplicada aqui**. A fonte única é o [`docs/RELEASE.md`](docs/RELEASE.md) — seção "Passo 5 — Verificar desinstalação". Em resumo: instale o release → desinstale (botão do Hub ou Windows) → confirme que `%APPDATA%\kolnd-hub` foi preservado (`config.json`, `first-run-complete.flag`, `logs\`) e que o diretório de instalação foi removido.

### Logs de desinstalação

- `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log` — log da desinstalação do Kloud Games (etapas, códigos de retorno do `msiexec`, laudo final). Se o fluxo do Hub for pausado na etapa do Kloud Games (falha/UAC negado), a causa também fica registrada aqui.
- O fluxo completo do Hub é exibido **ao vivo** no modal de progresso (etapa, barra e log). Essas linhas não são gravadas em um arquivo próprio além do log acima.
- O botão **"Abrir pasta de logs"** (nas telas de resultado do Kloud Games e nos erros) abre `%APPDATA%\kolnd-hub\logs` no Explorer.
- Os logs ficam dentro de `%APPDATA%\kolnd-hub\logs\`, ou seja: só deixam de existir se você escolher "Apagar também meus dados e configurações".

## Build do instalador

> O processo completo de release — do bump de versão à publicação com checksum — está em [`docs/RELEASE.md`](docs/RELEASE.md) (fonte única do processo).

### Um comando (recomendado)

Na raiz do repositório:

```bat
build-installer.bat
```

O script:

1. Garante o Node.js no PATH e instala pré-requisitos via `winget` (Git, MSYS2 em `C:\msys64` e .NET SDK 8, necessários para o WiX/cpack);
2. Roda `kolnd-hub/scripts/build-kloud-games.ps1` — correções idempotentes de renomeação do snapshot, submódulos (incluindo aninhados e o fix aplicado via `scripts/patches/moonlight-stdatomic-guards.patch`), dependências ucrt64, `cmake + ninja` com gcc, `cpack -G WIX` e cópia do MSI para `kolnd-hub/resources/programs/kloud-games/`;
3. Roda `npm run package` em `kolnd-hub/` — compila o app e gera `kolnd-hub/dist/Kolnd Hub Setup <versao>.exe` (`<versao>` = `version` de `kolnd-hub/package.json`);
4. Gera `kolnd-hub/dist/SHA256SUMS.txt` com o SHA-256 dos artefatos finais (`KLOUD_GAMES.msi` e o `Setup.exe`) — passo best-effort: falha do hash não quebra o build.

Se o Kloud Games já estiver compilado, apenas o passo 3 é necessário:

```powershell
cd kolnd-hub
npm install
npm run package
```

### Requisitos de build

- Windows 10/11
- [Node.js](https://nodejs.org) 22 LTS e npm
- Git
- MSYS2 (`C:\msys64`) com o toolchain UCRT64 — instalado automaticamente pelo script
- .NET SDK 8 — instalado automaticamente pelo script (necessário para o WiX)

## Build do Kloud Games no CI (manual/semanal)

O `KLOUD_GAMES.msi` também pode ser gerado pelo GitHub Actions, sem a máquina do
desenvolvedor, via o workflow
[`.github/workflows/build-kloud-games.yml`](.github/workflows/build-kloud-games.yml):

- **Quando roda:** apenas manualmente (`workflow_dispatch`) e semanalmente (domingo 04:00 UTC). **Não** roda por push/PR — o build leva ~30–60 min e é propositalmente fora do CI principal.
- **Disparar manualmente** (com o workflow presente no branch default do repositório):

  ```powershell
  gh workflow run build-kloud-games.yml
  ```

- **Onde baixar o MSI:** Actions → run do workflow → seção **Artifacts** → `kloud-games-msi` (retenção de 30 dias). O artefato inclui `KLOUD_GAMES.msi` e `SHA256SUMS.txt` (hash SHA-256 gerado por `kolnd-hub/scripts/gen-sha256sums.ps1`).
- **Duração esperada:** ~30–60 min na primeira execução (build C++ completo via MSYS2/UCRT64 + WiX). Um cache de `kloud-games/cmake-build-windows` (chaveado pelo SHA do HEAD) tende a reduzir as execuções seguintes.
- **Primeira execução depende do usuário:** push e dispatch exigem permissão de escrita no repositório; a primeira validação real do workflow (e eventual ajuste do cache/checkout) é feita por quem disparar o `workflow_dispatch`. O passo **não** executa em `ci.yml`.
- **Não assinado:** o MSI gerado pelo CI não é assinado (assinatura de código: tarefa 02-2.4).
- Em caso de falha por tamanho/tempo do checkout recursivo (o fork é grande), a alternativa documentada no próprio workflow é reduzir `submodules` para `true` e deixar o `build-kloud-games.ps1` clonar apenas os aninhados necessários.

## Desenvolvimento do Hub

```powershell
cd kolnd-hub
npm install
npm run dev        # modo desenvolvimento com HMR
npm run build      # gera os bundles em out/
npm run package    # gera o instalador NSIS em dist/
npm run typecheck  # tsc --noEmit (main + renderer)
npm test           # testes unitários (Vitest)
npm run test:e2e   # build + Playwright/Electron
npm run verify     # typecheck + lint + format:check + testes (gate antes de commit)
npm run lint       # ESLint (flat config)
npm run format     # Prettier
```

### Testes automatizados (atalho na Área de Trabalho)

O atalho **"Testes - Kolnd Hub"** na Área de Trabalho roda `scripts/run-all-tests.ps1`, que executa em sequência:

1. **Kloud Hub — unitários** (`kolnd-hub`: `npm test`, Vitest);
2. **Kloud Hub — e2e** (`kolnd-hub`: `npm run test:e2e` — build + Playwright/Electron; a suíte mais lenta);
3. **Kloud Games — web** (`kloud-games`: `npm test`, Vitest + cobertura);
4. **Kloud Games — scripts** (Pester, executado só se houver Pester 5+ instalado — o Windows traz o 3.4 por padrão);
5. **Kloud Games — C++** (`kloud-games\cmake-build-windows\tests\test_KLOUD_GAMES.exe`, usando o build existente — o script **não** recompila).

A janela mostra o andamento e um resumo (OK/FALHOU/PULADO por suíte) e permanece aberta no fim. Logs em `%TEMP%\kolnd-hub-testes`: `testes-*.log` (transcript da execução) e `testes-*.saida.log` (saída completa das suítes).

Rodar sem o atalho:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-all-tests.ps1

# variações
#   -SkipE2e          não roda Playwright
#   -SkipKloudGames   não roda nenhuma suíte do Kloud Games
#   -SkipKloudNative  não roda o binário C++ (mantém web e Pester)
```

Requisitos: `node_modules` em `kolnd-hub/` e `kloud-games/` (o script avisa e pula/falha se faltar) e MSYS2 em `C:\msys64` para as DLLs do binário C++ (o `ucrt64\bin` é adicionado ao `PATH` automaticamente).

Estrutura do código do Hub:

```
kolnd-hub/src/
├── main/       # processo principal: janela, tray, gerenciamento de processos,
│               # inicialização (registro/pasta de startup), primeira execução,
│               # instaladores silenciosos, implantação dos programas e
│               # config persistente (electron-store com schema + migração IPC)
├── preload/    # bridge segura (contextBridge, sandbox habilitado)
└── renderer/   # React: Dashboard, Biblioteca, Meu PC (inicialização, tela,
                # atualizações, limpeza, memória, benchmark, monitor + HUD),
                # Configurações, FirstRunInstall e Big Picture (gamepad/TV)…
```

Os comandos e diretórios de cada programa ficam configuráveis no app (**Configurações**) e são salvos no **electron-store** (`%APPDATA%\kolnd-hub\config.json`, com schema e migrações versionadas; o Hub migra automaticamente o que estava no `localStorage` na primeira execução, mantendo-o como fallback; a migração mais recente é a **'1.10.0'**). Caminhos aceitam variáveis de ambiente (`%ProgramFiles%`, `%LOCALAPPDATA%`…), caminhos absolutos e relativos. Comandos rodam via shell por padrão; em Configurações dá para desativar "Executar via shell" por comando.

O Hub também tem um **Modo Big Picture** (estilo Steam Big Picture): clique em **Big Picture** no rodapé da barra lateral e a janela entra em tela cheia com uma transição cinematográfica. A interface é navegável 100% por controle (D-Pad/stick + botões; LB/RB alternam Jogos · Ferramentas · Controle; B/Esc sai de volta ao Hub) — sem controle configurado, o primeiro acesso abre a configuração (detecção automática do modelo via "pressione qualquer botão", ajuste manual em **Configurações → Big Picture**). Mouse e teclado funcionam em paralelo, e a configuração do controle sobrevive a reinícios (`electron-store`, chaves `gamepad`/`bigPicture`).

## Segurança e distribuição

- **Segredos nunca vão para o instalador**: o filtro de `extraResources` no `electron-builder.yml` exclui dados de usuário dos programas embutidos.
- Instalação **por usuário** mantém a pasta gravável e não exige administrador; o instalador não permite trocar o diretório de propósito. O desinstalador remove o diretório da instalação inteiro; o que estiver em `%APPDATA%\kolnd-hub` é preservado (veja **Desinstalação**).
- O instalador dispara UAC para instalar Python (se necessário) e o MSI do Kloud Games (serviço + firewall).
- Por ser um `.exe` único que baixa/executa instaladores, pode ser sinalizado como falso positivo pelo Defender — para distribuição pública, assine o código (ver detalhes em `kolnd-hub/README.md`, seção "Primeira execução, UAC e antivírus").
- **Validação em máquina limpa (VM/Sandbox) — status real: checklist preparado, execução PENDENTE.** O checklist reutilizável a cada release está em [`docs/FIRST-RUN-CHECKLIST.md`](docs/FIRST-RUN-CHECKLIST.md) (pré-requisitos da VM, passos com checkbox, cenários de falha/UAC negado, logs a observar, limitações — o MSI real do Kloud Games não está no git; CI só empacota). A instalação de Python via winget e a instalação do MSI do Kloud Games **não foram exercitadas em ambiente limpo**; esta afirmação só pode ser removida/atualizada após uma execução registrada na VM. Os fluxos de desinstalação (botões da "Zona de perigo") também ainda não foram executados de ponta a ponta em VM — o que está documentado na seção **Desinstalação** descreve o comportamento implementado e coberto por testes, mas a desinstalação real (instalar, usar, desinstalar) aguarda validação em VM com snapshot. O roteiro dessa validação está em [`docs/RELEASE.md`](docs/RELEASE.md) (seção "Passo 2 — Teste em máquina limpa") e o checklist operacional em [`docs/FIRST-RUN-CHECKLIST.md`](docs/FIRST-RUN-CHECKLIST.md).

## Credenciais e dados pessoais

- **Absolem**: a chave do Gemini é cifrada no próprio PC com `safeStorage` (DPAPI) e gravada em `%APPDATA%\absolem\secrets.bin`, fora do repositório. Ela nunca vai para `config.json` nem para os logs. Não altere esse fluxo.
- **Nunca commitar segredos**: `.env*` (exceto `.env.example`), chaves de API, certificados (`*.pem`, `*.pfx`, `*.p12`), tokens, client secrets e bancos de dados de usuário (`memory.sqlite`) estão no `.gitignore` e são barrados pelo guard.
- **Guard automatizado**: `scripts/check-secrets.mjs` (sem dependências) varre os arquivos **rastreados** pelo git — caminhos proibidos e conteúdo (chave Google `AIza…` e chave privada PEM) — e roda no CI (`.github/workflows/ci.yml`). Localmente: `node scripts/check-secrets.mjs`.
- **Se uma chave vazar**: revogue e rotacione a chave no [Google AI Studio](https://aistudio.google.com/apikey) imediatamente. O guard impede novas inclusões, mas **não** reescreve histórico — um segredo já publicado continua acessível no passado do repositório até uma limpeza de histórico ser feita de propósito.

## Licenças

| Componente     | Licença                                |
| -------------- | -------------------------------------- |
| `kolnd-hub/`   | MIT (ver `package.json`)               |
| `kloud-games/` | GPL-3.0 (fork do Sunshine, LizardByte) |

## Documentação adicional

- `kolnd-hub/README.md` — detalhes do aplicativo (comandos, qualidade/CI, primeira execução, UAC e antivírus, solução de problemas)
- `CHANGELOG.md` — histórico de mudanças (Keep a Changelog + SemVer, pt-BR); é a base das release notes
- `kolnd-hub/AGENTS.md` — regras operacionais para agentes e contribuidores do Hub
- `docs/architecture.md` — arquitetura técnica do Hub (processos, IPC, store + migrações, first-run, Big Picture, segurança)
- `docs/RELEASE.md` — guia/checklist de release passo a passo (fonte única do processo)
- `docs/FIRST-RUN-CHECKLIST.md` — checklist de validação em máquina limpa do fluxo de primeira execução (preparado; execução em VM pendente)
- `kloud-games/AGENTS.md` — instruções de build/teste do Kloud Games
- Repositório: [github.com/Gui-Kol/kolnd-hub](https://github.com/Gui-Kol/kolnd-hub)

> Branch de desenvolvimento: `Dev` (o `main` é mantido estável e não recebe commits diretos)
