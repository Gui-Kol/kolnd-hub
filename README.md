# ⚡ Kolnd Hub

Central de controle do ecossistema Kolnd — um aplicativo desktop para **iniciar, parar e monitorar** os programas do ecossistema, com interface moderna, bandeja do sistema e logs ao vivo. Este repositório também contém os programas gerenciados pelo Hub e os scripts para gerar o instalador único (`.exe`) de tudo.

## Estrutura do repositório

| Pasta / arquivo | O que é | Stack |
| --- | --- | --- |
| `kolnd-hub/` | O aplicativo Hub em si (dashboard, configurações, bandeja, primeira execução) | Electron 28 + electron-vite + React 18 + TypeScript + Tailwind CSS |
| `Mark-LVI/` | **Mark LVI (JARVIS)** — assistente pessoal de voz com IA em tempo real (avatar holográfico, lip-sync, controle do PC, wake word, 50+ idiomas) | Python + PyQt6, empacotado com PyInstaller |
| `kloud-games/` | **Kloud Games** — servidor self-hosted de streaming de jogos para Moonlight (fork do Sunshine, da LizardByte) | C++ / CMake / MSYS2 (UCRT64), gerado como MSI via WiX |
| `build-installer.bat` | Build completo em um único comando: compila o Kloud Games → MSI, depois empacota o Hub → `.exe` | CMD + PowerShell |
| `task.md` | Plano de implementação e checklist das tarefas (fases 1–6) | — |

## Programas gerenciados pelo Hub

| Programa | Como é distribuído | Instalação |
| --- | --- | --- |
| **Mark LVI (JARVIS)** | Embutido no instalador do Hub em `resources/programs/MarkLVI/` (PyInstaller) | Automática na primeira execução do Hub |
| **Kloud Games** | Embutido como MSI (`resources/programs/kloud-games/KLOUD_GAMES.msi`) | Instalado na primeira execução via UAC (`msiexec /i … /quiet`), em `C:\Program Files\KLOUD_GAMES` |
| **IntelliJ, PyCharm, VS Code, Docker, Insomnia, OpenCode, Antigravity** | Atalhos configuráveis pelo usuário (não são instalados pelo Hub) | Configurados em **Configurações** do app |

## Instalação para o usuário final

Baixe e execute `Kolnd Hub Setup 1.0.0.exe` (gerado em `kolnd-hub/dist/`). A instalação é **por usuário** (`%LOCALAPPDATA%\Programs\Kolnd Hub`), sem exigir administrador — mas a primeira execução dispara dois processos elevados via UAC:

1. Instalação silenciosa do **Python 3.x** via `winget`, apenas se ele não estiver presente;
2. Instalação do **Kloud Games** a partir do MSI embutido (serviço + firewall + autostart).

Durante a primeira execução o app mostra uma tela de progresso com as etapas:

1. **Verificação de dependências** — Python e pip;
2. **Python** — instala via winget se faltar;
3. **Kloud Games** — instala o MSI embutido (falha não bloqueia o uso do Hub);
4. **Programas** — verifica a implantação do Mark LVI e do Kloud Games;
5. **Finalização** — salva os comandos/diretórios padrão e grava o marcador de primeira execução.

Na segunda abertura o app vai direto para o dashboard. O marcador fica em `%APPDATA%\kolnd-hub\first-run-complete.flag`.

> ⚠️ O Mark LVI grava sua chave de API e a memória das conversas **junto ao executável**. Use sempre o app instalado — nunca rode diretamente o bundle de build — para não perder dados ao reconstruir o pacote.

> Playnite e o SteamGridDB Manager foram removidos do projeto por decisão do usuário (ver `task.md`).

## Build do instalador

### Um comando (recomendado)

Na raiz do repositório:

```bat
build-installer.bat
```

O script:

1. Garante o Node.js no PATH e instala pré-requisitos via `winget` (Git, MSYS2 em `C:\msys64` e .NET SDK 8, necessários para o WiX/cpack);
2. Roda `kolnd-hub/scripts/build-kloud-games.ps1` — correções idempotentes de renomeação do snapshot, submódulos (incluindo aninhados e o fix aplicado via `scripts/patches/moonlight-stdatomic-guards.patch`), dependências ucrt64, `cmake + ninja` com gcc, `cpack -G WIX` e cópia do MSI para `kolnd-hub/resources/programs/kloud-games/`;
3. Roda `npm run package` em `kolnd-hub/` — compila o app e gera `kolnd-hub/dist/Kolnd Hub Setup 1.0.0.exe` (~360 MB).

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
npm run dev       # modo desenvolvimento com HMR
npm run build     # gera os bundles em out/
npm run package   # gera o instalador NSIS em dist/
```

Estrutura do código do Hub:

```
kolnd-hub/src/
├── main/       # processo principal: janela, tray, gerenciamento de processos,
│               # inicialização (registro/pasta de startup), primeira execução,
│               # instaladores silenciosos e implantação dos programas
├── preload/    # bridge segura (contextBridge) entre main e renderer
└── renderer/   # React: Dashboard, Settings, Inicialização, FirstRunInstall…
```

Os comandos e diretórios de cada programa ficam configuráveis no app (**Configurações**) e são salvos em `localStorage` (por usuário). Caminhos aceitam variáveis de ambiente (`%ProgramFiles%`, `%LOCALAPPDATA%`…), caminhos absolutos e relativos.

## Segurança e distribuição

- **Segredos nunca vão para o instalador**: `Mark-LVI/config/api_keys.json`, `config/certs/`, `config/whatsapp_web/` e `memory/` são excluídos via `extraResources` (veja o `filter` no `electron-builder.yml`).
- Instalação **por usuário** mantém a pasta gravável (o Mark LVI cria `config/` e `memory/` ao lado do próprio executável).
- O instalador dispara UAC para instalar Python (se necessário) e o MSI do Kloud Games (serviço + firewall).
- Por ser um `.exe` único que baixa/executa instaladores, pode ser sinalizado como falso positivo pelo Defender — para distribuição pública, considere assinar o código.
- A validação completa em máquina limpa (VM/Sandbox) ainda está pendente; a instalação de Python via winget não foi exercitada em ambiente limpo (ver `task.md`, T-13/T-14).

## Licenças

| Componente | Licença |
| --- | --- |
| `kolnd-hub/` | MIT (ver `package.json`) |
| `kloud-games/` | GPL-3.0 (fork do Sunshine, LizardByte) |
| `Mark-LVI/` | Ver `Mark-LVI/LICENSE` |

## Documentação adicional

- `kolnd-hub/README.md` — detalhes do aplicativo (comandos, solução de problemas)
- `task.md` — checklist de implementação completo, com decisões e status
- `Mark-LVI/readme.md` — documentação do assistente JARVIS
- `kloud-games/AGENTS.md` — instruções de build/teste do Kloud Games
- Repositório: [github.com/Gui-Kol/kolnd-hub](https://github.com/Gui-Kol/kolnd-hub)

> Branch de desenvolvimento: `Dev` (o `main` é mantido estável e não recebe commits diretos)
