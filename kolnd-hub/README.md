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
npm run package   # gera os bundles + instalador NSIS em dist/

npm run typecheck # tsc --noEmit nos projetos main e renderer
npm test          # testes unitários (Vitest) de renderer/lib e main
npm run lint      # ESLint (flat config, typescript-eslint + react-hooks)
npm run format    # Prettier --write
```

## Qualidade e CI

- **Vitest** cobre a lógica pura (`lib/startup.ts`, `lib/appsConfig.ts`, `lib/spatialNav.ts`, `lib/gamepad/*` (perfis e detecção), `main/commandLine.ts`, `main/steamScanner.ts`, `main/wingetUpdater.ts`) — sem Electron, sem DOM.
- **ESLint 10** (flat config) + **Prettier** mantêm o estilo consistente.
- **GitHub Actions** (`.github/workflows/ci.yml`, `windows-latest`): `npm ci` → typecheck → lint → format:check → testes → build → `npm run package` (com placeholders de `resources/programs/MarkLVI`, que não vai para o git). Artefato: `dist/Kolnd Hub Setup *.exe` (7 dias).

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

> ⚠️ **Dados do Mark LVI e desinstalador**: o `MarkLVI.exe` empacotado grava a chave de API e a memória **na pasta do executável** (`<instalação>/resources/programs/MarkLVI/`). Ao desinstalar o Kolnd Hub, o NSIS remove **o diretório da instalação inteiro** — inclusive esses dados. Faça backup antes de desinstalar (ou copie `config/` e `memory/` para outro lugar).
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

> ⚠️ A instalação do MSI do Kloud Games na primeira execução **ainda não foi validada em máquina limpa** (sem Python/winget pré-instalados e com UAC aprovado). A validação ficou pendente — veja a seção de primeira execução acima.

## Modo Big Picture

Interface em tela cheia otimizada para gamepad e TV (estilo Steam Big Picture).

- **Entrar:** botão **Big Picture** no rodapé da barra lateral, acima da versão. Sem controle configurado, o Hub abre a configuração antes de liberar a home ("pressione qualquer botão" detecta Xbox, PlayStation, Switch Pro ou genérico e aplica o perfil certo).
- **Usar:** D-Pad ou stick esquerdo navega, A/Cross confirma, B/Circle volta, LB/RB alternam as seções (**Jogos · Ferramentas · Controle**), Start abre as opções. Mouse e teclado funcionam por inteiro em paralelo; os jogos da Biblioteca e os programas do Hub abrem direto da grade.
- **Configurar:** em **Configurações → Big Picture** dá para remapear botão a botão (conflito entre ações pede confirmação) e ligar/desligar os efeitos sonoros. Se o controle desconectar no meio do uso, um aviso aparece na hora e some ao reconectar.
- **Sair:** item **Sair do Big Picture** no rail, **B** na raiz ou **Esc** — devolve ao Hub normal sem fechar nada.

A configuração do controle fica no **electron-store** (chaves `gamepad` e `bigPicture`, migração **'1.4.0'**), então sobrevive a reinícios.

## Primeira execução, UAC e antivírus

Pontos de atenção para quem instala ou distribui o app:

### Prompts de UAC na primeira execução

A instalação do Hub em si (NSIS) é **por usuário** e não pede administrador. Mas a primeira execução dispara dois processos elevados:

1. **Python** — instalado via `winget` (`--silent --accept-package-agreements`), apenas se faltar no sistema;
2. **Kloud Games** — o MSI embutido é instalado com `msiexec /i … /quiet /norestart` elevado via `Start-Process -Verb RunAs` (instala o serviço `KLOUD_GAMESsvc`, regras de firewall e o autostart).

Se você **negar o UAC do Kloud Games**, a etapa falha mas não bloqueia o uso do Hub — o MSI continua disponível em `<instalação>/resources/programs/kloud-games/KLOUD_GAMES.msi` para instalação manual posterior (`msiexec /i …` como administrador). Se negar o UAC do Python (quando ele faltar), o Mark LVI não funciona até o Python ser instalado.

### Antivírus / falso positivo

Um `.exe` único que dispara outros instaladores pode ser sinalizado como suspeito por heurísticas (comportamento típico de downloader/dropper):

- **Distribua por canal oficial** com o hash SHA-256 publicado junto — facilita a conferência manual.
- **Assine o código** (certificado de assinatura para executáveis). Sem assinatura, o SmartScreen provavelmente exibirá "aplicativo não reconhecido". Com assinatura, alertas heurísticos caem bastante.
- Máquinas corporativas com políticas rígidas (AppLocker, bloqueio de `powershell.exe` com `-Verb RunAs`) podem impedir a instalação silenciosa do MSI — nesse caso, instale o MSI manualmente como administrador.

Um `.exe` sinalizável também pode ser evitado compilando/assinando o instalador e o próprio `KLOUD_GAMES.msi` (WiX). Para distribuição pública, a assinatura de código é pré-requisito prático.

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

- **"Diretório não encontrado"**: confira o campo _Diretório de trabalho_ em Configurações. Variáveis como `%LOCALAPPDATA%` são expandidas automaticamente.
- **Programa inicia e para com "Erro"**: abra o card e clique no ícone de logs para ver a saída do processo.
- **Comando não encontrado**: confirme que o executável está no `PATH` ou use o caminho completo no campo _Comando_.
- **Kloud Games não inicia**: confirme que o MSI foi instalado na primeira execução (`%ProgramFiles%\KLOUD_GAMES`). Se necessário, execute `msiexec /i resources\programs\kloud-games\KLOUD_GAMES.msi` manualmente como administrador.
- **Instalador sinalizado como falso positivo**: o `.exe` instala outros programas na primeira execução; veja a seção **Primeira execução, UAC e antivírus** acima antes de distribuir.
- **Configurações "sumiram"**: desde a versão com electron-store, elas ficam em `%APPDATA%\kolnd-hub\config.json`. Se o arquivo estiver corrompido, o app usa o fallback de `localStorage` — se você limpar `%APPDATA%\kolnd-hub`, perde a flag de primeira execução (o app roda o fluxo de instalação de novo) e as configurações. Mantenha backup do `config.json` a cada atualização manual.
- **"Não foi possível iniciar" / processo com aspas**: confira se "Executar via shell" está como desejado em Configurações (ver seção "Como usar").

> Branch de desenvolvimento: `Dev` (o `main` é mantido estável e não recebe commits diretos)
