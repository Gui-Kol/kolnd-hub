# ⚡ Kolnd Hub

Hub centralizado para iniciar, parar e monitorar os 5 programas do ecossistema Kolnd, com interface desktop moderna (glassmorphism), bandeja do sistema e logs ao vivo.

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

## Como usar

1. Abra o app e clique em **Iniciar** no card do programa.
2. Clique no card para ver detalhes, abrir a pasta e acompanhar os **logs**.
3. O botão **X** fecha para a bandeja; use o ícone da bandeja para reabrir.
4. Em **Configurações**, ajuste comando e diretório de trabalho de cada programa.

Caminhos aceitam:

- caminhos relativos (resolvidos a partir do diretório do Hub), ex.: `../Mark-LVI`
- caminhos absolutos, ex.: `C:\Program Files\Playnite`
- variáveis de ambiente, ex.: `%LOCALAPPDATA%\Playnite`, `%USERPROFILE%\Documents\My Games\kloud-games`

As configurações são salvas em `localStorage` (por usuário).

## Programas gerenciados

| Programa | Comando padrão | Observação |
| --- | --- | --- |
| Mark LVI (JARVIS) | `py main.py` | Requer as dependências de `requirements.txt` |
| Playnite | `Playnite.DesktopApp.exe` | Requer Playnite instalado em `%LOCALAPPDATA%\Playnite` |
| Kloud Games | `kloud-games.exe` | Ajuste o diretório para a instalação local do Kloud Games |

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
