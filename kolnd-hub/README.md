# ⚡ Kolnd Hub

Hub centralizado para iniciar, parar e monitorar os programas do ecossistema Kolnd, com interface desktop moderna (glassmorphism), bandeja do sistema e logs ao vivo.

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
npm run package   # gera o instalador NSIS em dist/
```

## Primeira execução

Na primeira abertura, o app detecta a ausência do marcador `first-run-complete.flag` (salvo em `%APPDATA%\kolnd-hub`) e exibe uma tela de instalação com as etapas:

1. **Verificação de dependências** — Python e pip;
2. **Python** — instala silenciosamente via `winget` (`--silent --accept-package-agreements`), apenas se necessário;
3. **Kloud Games** — instala o MSI embutido em `resources/programs/kloud-games/KLOUD_GAMES.msi` via UAC (`msiexec /i … /quiet /norestart`, elevado com `Start-Process -Verb RunAs`). Falha aqui **não bloqueia** o uso do Hub;
4. **Programas** — verifica a implantação do Mark LVI e do Kloud Games;
5. **Finalização** — salva os comandos/diretórios padrão e grava o marcador de primeira execução.

Nas próximas aberturas o app vai direto para o dashboard. A flag fica em `%APPDATA%\kolnd-hub\first-run-complete.flag`.

## Gerando o instalador com tudo embutido

O instalador único (`Kolnd Hub Setup <versão>.exe`) embute os programas que o Hub precisa, via `extraResources` no `electron-builder.yml` (eles ficam em `<instalação>/resources/programs/...`):

| Programa | Origem | Status |
| --- | --- | --- |
| Mark LVI (JARVIS) | `Mark-LVI/` (PyInstaller) | ✅ Embutido no instalador em `resources/programs/MarkLVI` |
| Kloud Games | `kloud-games/` (CMake + MSYS2) | ✅ Embutido como MSI (`resources/programs/kloud-games/KLOUD_GAMES.msi`, ~53 MB), instalado na primeira execução em `C:\Program Files\KLOUD_GAMES` |

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

> ⚠️ **Dados do usuário e builds**: o Mark LVI grava a chave de API e a memória da conversa **na pasta do executável** (`<instalação>/resources/programs/MarkLVI/`). Ao rodar a build de novo, o bundle é recriado a partir do código e o script move esses arquivos para `kolnd-hub-userdata-backups/` automaticamente — mas o ideal é usar sempre o app **instalado**, nunca o bundle de build, para não perder nada. O desinstalador pode remover esses dados junto com a pasta do app.

## Como usar

1. Abra o app e clique em **Iniciar** no card do programa.
2. Clique no card para ver detalhes, abrir a pasta e acompanhar os **logs**.
3. O botão **X** fecha para a bandeja; use o ícone da bandeja para reabrir.
4. Em **Configurações**, ajuste comando e diretório de trabalho de cada programa.

Caminhos aceitam:

- caminhos relativos (resolvidos a partir do diretório do Hub), ex.: `../Mark-LVI`
- caminhos absolutos, ex.: `C:\Program Files\KLOUD_GAMES`
- variáveis de ambiente, ex.: `%USERPROFILE%\Documents\My Games\kloud-games`

As configurações são salvas em `localStorage` (por usuário).

## Programas gerenciados

| Programa | Comando padrão | Observação |
| --- | --- | --- |
| Mark LVI (JARVIS) | `MarkLVI.exe` | Embutido no instalador em `resources/programs/MarkLVI` (PyInstaller) |
| Kloud Games | `"%ProgramFiles%\KLOUD_GAMES\KLOUD_GAMES.exe"` | Embutido como MSI; instalado na primeira execução em `C:\Program Files\KLOUD_GAMES` (serviço + firewall + autostart) |

> ⚠️ A instalação do MSI do Kloud Games na primeira execução ainda não foi validada em máquina limpa (ver `task.md`, T-13/T-14).

## Estrutura

```
src/
├── main/          # processo principal, janela, tray, IPC, primeira execução
│                  # (firstRun*, dependencyChecker, silentInstaller,
│                  #  programsDeployer), gerenciamento de processos
├── preload/       # bridge segura (contextBridge)
└── renderer/      # React (Dashboard, Settings, Inicialização, FirstRunInstall…)
```

## Solução de problemas

- **"Diretório não encontrado"**: confira o campo *Diretório de trabalho* em Configurações. Variáveis como `%LOCALAPPDATA%` são expandidas automaticamente.
- **Programa inicia e para com "Erro"**: abra o card e clique no ícone de logs para ver a saída do processo.
- **Comando não encontrado**: confirme que o executável está no `PATH` ou use o caminho completo no campo *Comando*.
- **Kloud Games não inicia**: confirme que o MSI foi instalado na primeira execução (`%ProgramFiles%\KLOUD_GAMES`). Se necessário, execute `msiexec /i resources\programs\kloud-games\KLOUD_GAMES.msi` manualmente como administrador.
- **Instalador sinalizado como falso positivo**: o `.exe` instala outros programas na primeira execução; considere assinar o código para distribuição pública (ver `task.md`, T-18).
