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

## Gerando o instalador com tudo embutido

O instalador único (`Kolnd Hub Setup <versão>.exe`) embute os programas que o Hub precisa iniciar, via `extraResources` no `electron-builder.yml` (eles ficam em `<instalação>/resources/programs/...`):

| Programa | Origem | Status |
| --- | --- | --- |
| Mark LVI (JARVIS) | `Mark-LVI/` (PyInstaller) | ✅ Embutido no instalador |
| Kloud Games | `kloud-games/` (CMake + MSYS2) | ⚠️ Não embutido — o snapshot local não compila neste ambiente (toolchain atual: GCC 16/Clang 23 com C++23) |

```bash
# gerar e empacotar
powershell -ExecutionPolicy Bypass -File scripts\build-all.ps1
```

Depois de rodar a build de um programa, rode `npm run package` de novo para que o instalador pegue a versão nova.

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
- caminhos absolutos, ex.: `C:\Program Files\KloudGames`
- variáveis de ambiente, ex.: `%USERPROFILE%\Documents\My Games\kloud-games`

As configurações são salvas em `localStorage` (por usuário).

## Programas gerenciados

| Programa | Comando padrão | Observação |
| --- | --- | --- |
| Mark LVI (JARVIS) | `MarkLVI.exe` | Embutido no instalador em `resources/programs/MarkLVI` (PyInstaller) |
| Kloud Games | `KLOUD_GAMES.exe` | Não incluído por ora — o snapshot local não compila neste toolchain (GCC 16/Clang 23) |

## Estrutura

```
src/
├── main/          # processo principal, janela, tray, IPC
├── preload/       # bridge segura (contextBridge)
└── renderer/      # React (Dashboard, Settings, modais)
```

## Solução de problemas

- **"Diretório não encontrado"**: confira o campo *Diretório de trabalho* em Configurações. Variáveis como `%LOCALAPPDATA%` são expandidas automaticamente.
- **Programa inicia e para com "Erro"**: abra o card e clique no ícone de logs para ver a saída do processo.
- **Comando não encontrado**: confirme que o executável está no `PATH` ou use o caminho completo no campo *Comando*.
