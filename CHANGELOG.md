# Changelog

Todas as mudanças notáveis do **Kolnd Hub** são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento [SemVer](https://semver.org/lang/pt-BR/). Datas no formato `AAAA-MM-DD` e correspondem à data do commit que bumpou a versão — **não há tags git nem GitHub Releases publicadas** (ver [Notas](#notas)); onde o git não permitir datar com precisão, consta `(a confirmar)`.

Repositório: <https://github.com/Gui-Kol/kolnd-hub>

## [Não lançado]

Mudanças em `Dev` desde a 1.4.0 (2026-11-12), ainda sem bump de versão. Intervalo de commits: `3454e458..cd433115`.

### Adicionado

- **Desinstalação pelo app**: botões "Desinstalar Kloud Games" (via `msiexec /x {ProductCode}`, elevado por UAC) e "Desinstalar Kolnd Hub" (desinstalador NSIS per-user) em Configurações → "Zona de perigo", com confirmação digitada, saídas honestas para instalação quebrada, matriz de erros e casos de borda dos fluxos (`15f6d9ab`, `b665ad5a`, `7e4f9898`)
- **Log persistente do Hub** com rotação (5 MB × 2) e redação mínima de comandos/segredos, em `%APPDATA%\kolnd-hub\logs\kolnd-hub.log` (`b1b697b3`)
- **Crash reporting local** — minidumps em `%APPDATA%\kolnd-hub\Crashpad` e handlers de exceção não capturada / rejeição não tratada; nada é enviado para fora da máquina (`a95ff463`)
- **Exportação de diagnóstico sanitizado** para a área de transferência (Configurações) (`a00117cd`)
- **Validação de comandos**: IPC `command:validate` com avisos inline nas Configurações (`cbe46979`)
- `npm run verify` (typecheck → lint → format:check → testes) como gate pré-commit único, e `npm run verify:build` (verify + build) (`7e01ef36`)
- **Testes do electron-store**: config corrompido, migração de schema e store indisponível (`1f0b1f9f`); relatório e limiar de cobertura Vitest+V8 (informativo) (`a7dc582b`)
- Documentação: `docs/RELEASE.md` (checklist de release passo a passo), seção "Desinstalação" nos READMEs, `AGENTS.md` do Hub e `docs/architecture.md` (`730f27d3`, `6bccba45`, `317d4400`, `702bec45`)

### Alterado

- **Versão unificada**: `kolnd-hub/package.json` é a fonte única — o rodapé da UI renderiza `__APP_VERSION__` (via `define` no `electron.vite.config.ts`), o instalador passa a ter nome explícito `Kolnd Hub Setup ${version}.exe` (`artifactName` em `electron-builder.yml`) e o CI falha se `v1.0.0` reaparecer em `src/` (`cd433115`)
- `build-installer.bat` lê a versão de `package.json` em runtime (fallback genérico, sem versão fixa) (`e7e9bf3b`)
- `kloud-games.paths.json` movido para `%APPDATA%\kolnd-hub` (userData) com migração automática da cópia antiga (`1e06b5d7`)
- Status do Kloud Games sem escrita a cada chamada e `tasklist` assíncrono com cache TTL (`6004979c`)
- CI passa a disparar também na branch `Dev` (`54f205bb`); repositório agora **público** (CodeQL gratuito e verde) (`a6554b94`); audit informativo, Dependabot e CodeQL no CI (`7608e74e`)
- Código formatado com Prettier e LF forçado via `.gitattributes` (`a9e58081`)
- Estrutura de orquestração de tarefas para desenvolvimento assistido (pasta `gerente/`, `edb86085`)

### Segurança

- Janela principal bloqueia navegação externa (`will-navigate`) (`620858c1`)
- `requestSingleInstanceLock`: a segunda instância restaura a janela existente em vez de subir outro processo/tocar no disco (`3751ca35`)

## [1.4.0] - 2026-11-12

Commit: `3454e458`. Sem tags git — hash citado como referência.

### Adicionado

- **Modo Big Picture** (interface fullscreen para gamepad/TV, estilo Steam Big Picture):
  - Detecção e identificação de controles (Vendor/Product) com perfis Xbox/PlayStation/Switch/genérico (`src/renderer/src/lib/gamepad/`)
  - Persistência no electron-store (chaves `gamepad` e `bigPicture`, esquema versionado com migração `'1.4.0'`) e IPCs `gamepad:*` / `bigpicture:*`
  - Shell fullscreen (`window:set-fullscreen`) com botão Big Picture na barra lateral e home em trilho (Jogos / Ferramentas / Controle / Sair)
  - Navegação por gamepad (foco espacial 2D, repetição de tecla, SFX via Web Audio, teclado de cortesia)
  - Seção Configurações → Big Picture com auto-mapeamento ("pressione qualquer botão") e ajuste manual com detecção de conflito
  - Gate de primeira execução: sem controle configurado, o setup abre antes da home
  - Transição cinematográfica de entrada (com skip por qualquer input e `prefers-reduced-motion`)
  - Hot connect/disconnect em tempo real, responsividade de 1280 px a 4K e acessibilidade (roles/aria/foco visível/reduced-motion)
  - Encerrar processo de jogo a partir do painel e `useGamesRunning`

### Alterado

- Store passa a ser a fonte da configuração do controle e do modo Big Picture (migração `'1.4.0'`; clientes antigos aplicam as migrações pendentes em ordem)

## [1.3.0] - 2026-11-12

Commit: `67f654c9`. Sem tags git — hash citado como referência.

### Adicionado

- **Jogo personalizado**: adicionar jogo via seletor de `.exe` (nome formatado a partir do arquivo, ícone extraído do executável, IPC `games:add-custom` com id determinístico) (T8)
- **Edição de jogos** na Biblioteca: renomear, trocar/restaurar ícone (PNG/JPG/WebP), trocar `.exe`, selo ".exe não encontrado" (IPC `games:check-exes`) e remoção com confirmação (T9)
- **Autostart do Kloud Games**: preferência "Iniciar Kloud Games junto com o Hub" nas Configurações (electron-store, migração `'1.3.0'`, IPCs `prefs:get`/`prefs:set`); avaliada uma única vez por sessão, nunca na primeira execução (T10)
- IPC `dialog:pick-path` passa a aceitar título opcional

## [1.2.0] - 2026-11-12

Commit de bump: `1ec3dffe` (12/11/2026). O conteúdo acumulado desde a 1.0.0 (commits `c110ca62..1ec3dffe`) entrou junto neste bump. Sem tags git — hashes citados como referência.

### Adicionado

- **Manutenção do PC** na UI: atualização de programas via `winget` (listagem com parsing posicional/JSON, seleção em lote com estado indeterminado, fila sequencial, cancelamento e erro por item que não aborta a fila) (T3/T4)
- **Limpeza de arquivos temporários**: apenas `%TEMP%`, `%LOCALAPPDATA%\Temp` e `C:\Windows\Temp`, mais antigos que 24h, ignorando symlinks (T5)
- **Biblioteca de jogos**: IPC `games:*` com persistência no electron-store (migração `'1.2.0'`) e página própria (T6)
- **Importação de jogos da Steam**: detecção via registro/layout padrão, parsing de `libraryfolders.vdf`/`appmanifest`, filtro de ferramentas/redistribuíveis, localização do executável, ícone extraído, deduplicação por `steamAppId` e id determinístico (T7)
- **Instalação do Kloud Games endurecida**: pula reinstalação, `/norestart`, log, verificação pós-instalação e erros claros (T1)
- **Hub detecta/instala o Kloud Games automaticamente ao abrir** (via MSI embutido, silencioso) (`88d3393c`)
- Infraestrutura de qualidade: Vitest, ESLint, Prettier e CI (GitHub Actions em `windows-latest`), helper `commandLine`

### Alterado

- Página "Biblioteca" renomeada para **Ferramentas** (T2)
- Defaults genéricos em `apps.ts` (`cdd2a597`); READMEs com nota sobre a branch `Dev` (`6b332af2`)

### Corrigido

- `build-installer.bat` garante o Node.js no PATH antes de invocar `npm` (`280fadfc`)

### Removido

- Diretório `Sunshine/` e snapshots do `deepseek-harness` do repositório (projeto consolidado no repo pessoal) (`9538de6b`, `156b113a`)

## [1.0.0] - 2026-11-11

Commit: `c110ca62`. Versão inicial registrada neste repositório. Sem tags git — hash citado como referência.

### Adicionado

- **Kolnd Hub** — aplicativo desktop (Electron) para iniciar, parar e monitorar os programas do ecossistema Kolnd: dashboard, bandeja do sistema, configurações e primeira execução guiada
- Instalador único **NSIS per-user** (`Kolnd Hub Setup <versao>.exe`), sem exigir administrador, com Python (winget) e MSI do Kloud Games instalados de forma elevada na primeira execução
- Monorepo: `kolnd-hub/` (o app), `Mark-LVI/` (assistente JARVIS), `kloud-games/` (servidor Sunshine-like), `build-installer.bat` (build completo: MSI → instalador) e `.github/workflows/ci.yml`
- READMEs gerais e notas sobre a branch `Dev`

**Nota honesta:** a 1.0.0 é uma importação de um projeto que já existia fora deste git — o histórico anterior (antes de `c110ca62`) não está disponível para reconstrução.

## Notas

- **Sem tags git**: o repositório não tem nenhuma tag (`git tag --list` vazio) e não houve GitHub Releases publicadas até a criação deste changelog. Por isso as seções citam **hashes de commit** em vez de links de comparação (`compare/v1.3.0...v1.4.0`). Se no futuro forem criadas tags (ex.: `v1.4.0`, `v1.5.0`), os links podem ser adicionados.
- **`1.1.0` nunca foi lançada**: o `package.json` saltou direto de `1.0.0` para `1.2.0` (commit `1ec3dffe`). O git não permite datar a decisão com precisão — `(a confirmar)`.
- **Datas**: correspondem ao commit de bump (`git log --date=short`), não a uma publicação de instalador. Apenas a 1.4.0 (e anteriores) foram empacotadas como instalador; as demais datas marcam o marco no código.
- **Licenças**: o código do Kolnd Hub (`kolnd-hub/`) é MIT (ver `kolnd-hub/package.json`). Os demais componentes têm licenças próprias: `kloud-games/` é GPL-3.0 (fork do Sunshine da LizardByte) e `Mark-LVI/` — ver `Mark-LVI/LICENSE`. Veja a seção **Licenças** do README raiz. A tarefa 11-11.5 (NOTICE no instalador) está pendente.
- **Conteúdo reconstruído de archaeologia de git** (`git log` + diffs de `package.json`); releases não foram publicadas e não há notas oficiais para confrontar — por isso **a revisão do usuário é etapa obrigatória** (T4) antes de tratar este arquivo como fonte definitiva das release notes.

## Como manter

Toda PR/commit relevante adiciona uma entrada em **[Não lançado]**, agrupada pelo tipo (Adicionado / Alterado / Corrigido / Removido / Segurança). No bump de versão, a seção vira `## [X.Y.Z] - AAAA-MM-DD` e **[Não lançado]** recomeça vazio. Versionamento segue SemVer: quebra de compatibilidade → MAJOR; recurso novo compatível → MINOR; correção → PATCH.
