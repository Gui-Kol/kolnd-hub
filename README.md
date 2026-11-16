# ⚡ Kolnd Hub

Central de controle do ecossistema Kolnd — um aplicativo desktop para **iniciar, parar e monitorar** os programas do ecossistema, com interface moderna, bandeja do sistema e logs ao vivo. Este repositório também contém os programas gerenciados pelo Hub e os scripts para gerar o instalador único (`.exe`) de tudo.

## Estrutura do repositório

| Pasta / arquivo            | O que é                                                                                                                                                          | Stack                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `kolnd-hub/`               | O aplicativo Hub em si (dashboard, configurações, bandeja, primeira execução, modo Big Picture)                                                                  | Electron 28 + electron-vite + React 18 + TypeScript + Tailwind CSS |
| `Mark-LVI/`                | **Mark LVI (JARVIS)** — assistente pessoal de voz com IA em tempo real (avatar holográfico, lip-sync, controle do PC, wake word, 50+ idiomas)                    | Python + PyQt6, empacotado com PyInstaller                         |
| `kloud-games/`             | **Kloud Games** — servidor self-hosted de streaming de jogos para Moonlight (fork do Sunshine, da LizardByte)                                                    | C++ / CMake / MSYS2 (UCRT64), gerado como MSI via WiX              |
| `build-installer.bat`      | Build completo em um único comando: compila o Kloud Games → MSI, depois empacota o Hub → `.exe`                                                                  | CMD + PowerShell                                                   |
| `.github/workflows/ci.yml` | CI: `npm ci` → typecheck → lint → format:check → testes (Vitest) → build → empacotamento NSIS em `windows-latest` (com placeholders dos recursos não commitados) | GitHub Actions                                                     |

## Programas gerenciados pelo Hub

| Programa                                                                | Como é distribuído                                                           | Instalação                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Mark LVI (JARVIS)**                                                   | Embutido no instalador do Hub em `resources/programs/MarkLVI/` (PyInstaller) | Automática na primeira execução do Hub                                                            |
| **Kloud Games**                                                         | Embutido como MSI (`resources/programs/kloud-games/KLOUD_GAMES.msi`)         | Instalado na primeira execução via UAC (assistente visível do `msiexec /i … /norestart`, elevado com `Start-Process -Verb RunAs`), em `C:\Program Files\KLOUD_GAMES` |
| **IntelliJ, PyCharm, VS Code, Docker, Insomnia, OpenCode, Antigravity** | Atalhos configuráveis pelo usuário (não são instalados pelo Hub)             | Configurados em **Configurações** do app                                                          |

## Instalação para o usuário final

Baixe e execute `Kolnd Hub Setup <versao>.exe` (gerado em `kolnd-hub/dist/`; a versao atual esta em `kolnd-hub/package.json`). A instalação é **por usuário** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), sem exigir administrador — mas a primeira execução pode disparar elevação via UAC:

1. Instalação do **Python 3.x** via `winget`, apenas se ele não estiver presente (o Hub não eleva o winget explicitamente; se um UAC aparecer, é do próprio winget/instalador do pacote);
2. Instalação do **Kloud Games** a partir do MSI embutido (serviço + firewall + autostart) — sempre elevada via UAC, com assistente visível (sem `/quiet`).

Durante a primeira execução o app mostra uma tela de progresso com as etapas:

1. **Verificação de dependências** — Python e pip;
2. **Python** — instala via winget se faltar;
3. **Kloud Games** — instala o MSI embutido (falha não bloqueia o uso do Hub);
4. **Programas** — verifica a implantação do Mark LVI e do Kloud Games;
5. **Finalização** — salva os comandos/diretórios padrão e grava o marcador de primeira execução.

Na segunda abertura o app vai direto para o dashboard. O marcador fica em `%APPDATA%\kolnd-hub\first-run-complete.flag`.

> ⚠️ O Mark LVI grava sua chave de API e a memória das conversas **junto ao executável**. Use sempre o app instalado — nunca rode diretamente o bundle de build — para não perder dados ao reconstruir o pacote.

> Playnite e o SteamGridDB Manager foram removidos do projeto por decisão do usuário.

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

1. Primeiro o Hub desinstala o **Kloud Games** (se estiver instalado) — mesmo fluxo do botão acima, com UAC. Se algo falhar, você decide a cada passo: **"Desinstalar só o Hub"** (segue sem o Kloud Games) ou **"Cancelar"** (nada é alterado). Se o Kloud Games não estiver instalado, essa etapa é pulada.
2. Se você escolheu apagar seus dados, apaga a pasta `%APPDATA%\kolnd-hub` (ver abaixo).
3. Por fim, o desinstalador do Windows abre e o Hub se encerra sozinho para ele assumir. O Hub não abre mais depois disso.

- Pede para digitar `Kolnd Hub` antes de confirmar. Em `npm run dev` o botão fica desabilitado — só funciona no app instalado.
- O **Mark LVI** (assistente) fica dentro da pasta do Hub em `resources/programs/MarkLVI` e **vai junto** com a desinstalação.

### O que acontece com seus dados

Em **qualquer** desinstalação (pelo botão do Hub ou pelo Windows), o padrão é:

- **Preservado — `%APPDATA%\kolnd-hub` inteiro**: `config.json` (electron-store), a flag de primeira execução (`first-run-complete.flag`), `logs\` (`kolnd-hub.log` e `kloud-games-uninstall.log`), `kloud-games.paths.json`, `mark-lvi\` (os dados do assistente, quando gravados lá) e `game-icons\`. Nada disso é apagado pelo desinstalador NSIS (`deleteAppDataOnUninstall: false`), a menos que você escolha a opção irreversível no botão do Hub.
- **Removido — o diretório de instalação inteiro** (per-user: `%LOCALAPPDATA%\Programs\Kolnd Hub`), **incluindo `resources\programs\MarkLVI\` com os dados que a build atual do `MarkLVI.exe` grava ao lado do executável** (chave de API em `config\api_keys.json` e memória das conversas em `memory\`). Enquanto não houver o rebuild do Mark LVI (tarefa 01-1.9), o que estiver lá — fora do espelho parcial que o Hub mantém em `%APPDATA%\kolnd-hub\mark-lvi` a cada boot — é **perdido** na desinstalação; não há como o NSIS preservá-lo.

Ao desinstalar o Hub pelo botão, você escolhe uma das duas opções:

- **"Manter meus dados e configurações (recomendado)"** — padrão; o que está em `%APPDATA%\kolnd-hub` fica intacto (config, biblioteca, logs, ícones, flag de primeira execução, `mark-lvi\`);
- **"Apagar também meus dados e configurações (irreversível)"** — apaga o **conteúdo inteiro** de `%APPDATA%\kolnd-hub` (config.json, `first-run-complete.flag`, `logs\`, `mark-lvi\`, `game-icons\` e qualquer outra coisa que estiver lá). Não há como desfazer.

Resumindo em uma linha: **`%APPDATA%\kolnd-hub` é preservado; o diretório de instalação é removido** (com o que o Mark LVI gravou ao lado do seu `.exe` que ainda não foi espelhado para `%APPDATA%\kolnd-hub\mark-lvi`). Se você usa o Mark LVI com a build atual, copie `config` e `memory` de `resources\programs\MarkLVI\` antes de desinstalar se quiser garantia total.

Duas regras importantes:

- O botão **"Fazer backup dos meus dados"** copia `%APPDATA%\kolnd-hub` para `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss` (se já existir, cria `KolndHub-Backup-AAAAMMDD-HHmmss-2`, `-3`, …). O backup é **opcional e manual** — não é automático; clique nele **antes** de confirmar a desinstalação se quiser guardar seus dados. **Atenção: o backup cobre apenas `%APPDATA%\kolnd-hub`** — inclui o espelho `mark-lvi\` mantido pelo Hub, mas **não** cobre subpastas e não garante conter dados gravados ao lado do `MarkLVI.exe` desde o último boot; copie manualmente `resources\programs\MarkLVI\config` e `...\memory` se quiser garantia total.
- Nada fora de `%APPDATA%\kolnd-hub` é apagado pelo Hub. O que remove a instalação do Kloud Games e a pasta do Hub são os desinstaladores oficiais (MSI e NSIS).

Note que a preferência **"Iniciar Kloud Games junto com o Kolnd Hub"** (`launchKloudOnStart`, em `config.json`) também fica em `%APPDATA%\kolnd-hub` — ela sobrevive à desinstalação se você mantiver os dados; quem decide apagá-la é a opção de apagar tudo.

### Mark LVI

- O Mark LVI é removido junto com a pasta do Hub, porque fica dentro dela.
- **Build atual do Mark LVI (bundled)**: o `MarkLVI.exe` empacotado grava a chave de API (`config\api_keys.json`) e a memória das conversas (`memory\`) **ao lado do executável**, em `%LOCALAPPDATA%\Programs\Kolnd Hub\resources\programs\MarkLVI\` — ou seja, esses arquivos **vão junto com o diretório de instalação** na desinstalação.
- O que sobrevive: a cada boot o Hub **espelha** (seed, sem apagar) os arquivos `config\` e `memory\` do executável para `%APPDATA%\kolnd-hub\mark-lvi` (arquivos mais novos ganham; só arquivos no nível superior das pastas). Esses espelhos seguem a regra acima (preservados por padrão; cobertos pelo backup).
- O que **não** sobrevive: arquivos dentro de subpastas (`config\certs\`, `config\whatsapp_web\` etc.) nunca são espelhados; e dados gravados numa sessão cujo **último boot do Hub** foi anterior a essa gravação também ficam de fora. Nesse caso, copie manualmente os arquivos de `<instalação>\resources\programs\MarkLVI\config` e `<instalação>\resources\programs\MarkLVI\memory` antes de desinstalar.
- **Rebuild do Mark LVI (tarefa 01-1.9)**: a build refeita passa a honrar `MARK_LVI_HOME=%APPDATA%\kolnd-hub\mark-lvi` (o Hub já define essa variável ao lançar o assistente); a partir daí o assistente grava direto na pasta de dados do usuário e esses casos de borda deixam de existir. Até lá, vale a regra da build atual.

### Desinstalação manual pelo Windows (alternativa)

Você também pode desinstalar pelo sistema, sem abrir o Hub: **Configurações → Aplicativos**:

- "Kloud Games" → Desinstalar (executa o MSI; pede UAC); e
- "Kolnd Hub" → Desinstalar (executa o desinstalador NSIS; sem UAC).

É equivalente ao que os botões do Hub fazem. Códigos de retorno **3010** e **1641** do `msiexec` significam "reinício necessário para concluir a remoção" — é sucesso com aviso, não erro.

O desinstalador do Hub **não** guarda cópia dos seus dados e **não** apaga `%APPDATA%\kolnd-hub` — a decisão de apagar ou manter seus dados é sempre sua, dentro da "Zona de perigo" do Hub. Por outro lado, ele **remove o diretório de instalação inteiro** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), **incluindo `resources\programs\MarkLVI\` com os dados que a build atual do Mark LVI grava ao lado do executável**. Não existe opção de "manter a pasta do programa" — o NSIS sempre a remove.

### Checklist de release: verificação da desinstalação

A verificação da desinstalação em máquina/VM limpa faz parte do processo de release e **não é duplicada aqui**. A fonte única é o [`docs/RELEASE.md`](docs/RELEASE.md) — seção "Passo 5 — Verificar desinstalação". Em resumo: instale o release → desinstale (botão do Hub ou Windows) → confirme que `%APPDATA%\kolnd-hub` foi preservado (`config.json`, `first-run-complete.flag`, `logs\`) e que o diretório de instalação foi removido, incluindo `resources\programs\MarkLVI\`.

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
3. Roda `npm run package` em `kolnd-hub/` — compila o app e gera `kolnd-hub/dist/Kolnd Hub Setup <versao>.exe` (`<versao>` = `version` de `kolnd-hub/package.json`; ~360 MB).

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
- Python + PyInstaller apenas se você for reconstruir o Mark LVI (`kolnd-hub/scripts/build-mark-lvi.ps1`)

## Desenvolvimento do Hub

```powershell
cd kolnd-hub
npm install
npm run dev        # modo desenvolvimento com HMR
npm run build      # gera os bundles em out/
npm run package    # gera o instalador NSIS em dist/
npm run typecheck  # tsc --noEmit (main + renderer)
npm test           # testes unitários (Vitest)
npm run lint       # ESLint (flat config)
npm run format     # Prettier
```

Estrutura do código do Hub:

```
kolnd-hub/src/
├── main/       # processo principal: janela, tray, gerenciamento de processos,
│               # inicialização (registro/pasta de startup), primeira execução,
│               # instaladores silenciosos, implantação dos programas e
│               # config persistente (electron-store com schema + migração IPC)
├── preload/    # bridge segura (contextBridge, sandbox habilitado)
└── renderer/   # React: Dashboard, Settings, Inicialização, FirstRunInstall,
                # Big Picture (modo gamepad/TV)…
```

Os comandos e diretórios de cada programa ficam configuráveis no app (**Configurações**) e são salvos no **electron-store** (`%APPDATA%\kolnd-hub\config.json`, com schema e migrações versionadas; o Hub migra automaticamente o que estava no `localStorage` na primeira execução, mantendo-o como fallback; a migração mais recente é a **'1.4.0'**, do modo Big Picture). Caminhos aceitam variáveis de ambiente (`%ProgramFiles%`, `%LOCALAPPDATA%`…), caminhos absolutos e relativos. Comandos rodam via shell por padrão; em Configurações dá para desativar "Executar via shell" por comando.

O Hub também tem um **Modo Big Picture** (estilo Steam Big Picture): clique em **Big Picture** no rodapé da barra lateral e a janela entra em tela cheia com uma transição cinematográfica. A interface é navegável 100% por controle (D-Pad/stick + botões; LB/RB alternam Jogos · Ferramentas · Controle; B/Esc sai de volta ao Hub) — sem controle configurado, o primeiro acesso abre a configuração (detecção automática do modelo via "pressione qualquer botão", ajuste manual em **Configurações → Big Picture**). Mouse e teclado funcionam em paralelo, e a configuração do controle sobrevive a reinícios (`electron-store`, chaves `gamepad`/`bigPicture`).

## Segurança e distribuição

- **Segredos nunca vão para o instalador**: `Mark-LVI/config/api_keys.json`, `config/certs/`, `config/whatsapp_web/` e `memory/` são excluídos via `extraResources` (veja o `filter` no `electron-builder.yml`).
- Instalação **por usuário** mantém a pasta gravável. O Mark LVI (reconstruído com `core/paths.py`) grava a chave de API e a memória em `%APPDATA%\kolnd-hub\mark-lvi` (o Hub define `MARK_LVI_HOME` e semeia os dados ao lado do executável automaticamente). Enquanto o Mark LVI não for reconstruído, ele grava ao lado do próprio executável; nesses casos a instalação deve permanecer em `%LOCALAPPDATA%` (o instalador não permite trocar o diretório de propósito). O desinstalador remove o diretório da instalação inteiro — inclusive dados gravados ao lado do executável; o que estiver em `%APPDATA%\kolnd-hub` é preservado (veja **Desinstalação**).
- O instalador dispara UAC para instalar Python (se necessário) e o MSI do Kloud Games (serviço + firewall).
- Por ser um `.exe` único que baixa/executa instaladores, pode ser sinalizado como falso positivo pelo Defender — para distribuição pública, assine o código (ver detalhes em `kolnd-hub/README.md`, seção "Primeira execução, UAC e antivírus").
- **Validação em máquina limpa (VM/Sandbox) — status real: checklist preparado, execução PENDENTE.** O checklist reutilizável a cada release está em [`docs/FIRST-RUN-CHECKLIST.md`](docs/FIRST-RUN-CHECKLIST.md) (pré-requisitos da VM, passos com checkbox, cenários de falha/UAC negado, logs a observar, limitações — o bundle real do Mark LVI não está no git; CI só empacota com placeholder). A instalação de Python via winget e a instalação do MSI do Kloud Games **não foram exercitadas em ambiente limpo**; esta afirmação só pode ser removida/atualizada após uma execução registrada na VM. Os fluxos de desinstalação (botões da "Zona de perigo") também ainda não foram executados de ponta a ponta em VM — o que está documentado na seção **Desinstalação** descreve o comportamento implementado e coberto por testes, mas a desinstalação real (instalar, usar, desinstalar) aguarda validação em VM com snapshot. O roteiro dessa validação está em [`docs/RELEASE.md`](docs/RELEASE.md) (seção "Passo 2 — Teste em máquina limpa") e o checklist operacional em [`docs/FIRST-RUN-CHECKLIST.md`](docs/FIRST-RUN-CHECKLIST.md).

## Licenças

| Componente     | Licença                                |
| -------------- | -------------------------------------- |
| `kolnd-hub/`   | MIT (ver `package.json`)               |
| `kloud-games/` | GPL-3.0 (fork do Sunshine, LizardByte) |
| `Mark-LVI/`    | Ver `Mark-LVI/LICENSE`                 |

## Documentação adicional

- `kolnd-hub/README.md` — detalhes do aplicativo (comandos, qualidade/CI, primeira execução, UAC e antivírus, solução de problemas)
- `CHANGELOG.md` — histórico de mudanças (Keep a Changelog + SemVer, pt-BR); é a base das release notes
- `kolnd-hub/AGENTS.md` — regras operacionais para agentes e contribuidores do Hub
- `docs/architecture.md` — arquitetura técnica do Hub (processos, IPC, store + migrações, first-run, Big Picture, segurança)
- `docs/RELEASE.md` — guia/checklist de release passo a passo (fonte única do processo)
- `docs/FIRST-RUN-CHECKLIST.md` — checklist de validação em máquina limpa do fluxo de primeira execução (preparado; execução em VM pendente)
- `Mark-LVI/readme.md` — documentação do assistente JARVIS
- `kloud-games/AGENTS.md` — instruções de build/teste do Kloud Games
- Repositório: [github.com/Gui-Kol/kolnd-hub](https://github.com/Gui-Kol/kolnd-hub)

> Branch de desenvolvimento: `Dev` (o `main` é mantido estável e não recebe commits diretos)
