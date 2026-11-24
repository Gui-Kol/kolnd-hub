# Changelog

Todas as mudanças notáveis do **Kolnd Hub** são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento [SemVer](https://semver.org/lang/pt-BR/). Datas no formato `AAAA-MM-DD` e correspondem à data do commit que bumpou a versão — as tags `v1.0` e `v1.1.0-beta` existem no repositório, mas não há GitHub Releases publicadas com instalador (ver [Notas](#notas)); onde o git não permitir datar com precisão, consta `(a confirmar)`.

Repositório: <https://github.com/Gui-Kol/kolnd-hub>

## [Não lançado]

### Adicionado

- **Ícones da Biblioteca recarregados ao abrir a aba**: o main revisa todos os jogos e re-extrai do executável apenas os ícones que não estão legíveis (arquivo ausente, vazio ou corrompido), garantindo que os cards fiquem preenchidos; ícones válidos — inclusive os escolhidos à mão no modal de edição — nunca são sobrescritos (IPC `games:reload-icons`)
- **Botão "Atualizar ícones" na Biblioteca**: no cabeçalho da página, re-extrai o ícone de **todos** os jogos a partir dos executáveis — o mesmo efeito de abrir cada jogo e clicar em "Restaurar ícone". Por ser ação explícita, sobrescreve também ícones escolhidos à mão; o main grava os arquivos, persiste os caminhos novos numa única escrita do store, apaga as sobras dos ícones antigos e o renderer descarta o cache para buscar as imagens novas; o toast resume atualizados/total e quantos ficaram sem ícone utilizável (IPC `games:refresh-icons`)

### Alterado

- **Suíte unitária elevada a toda a lógica testável**: Vitest passou a cobrir `src/main` (incl. os 16 módulos de `ipc/`), `src/shared`, o contrato de `src/preload`, `renderer/src/lib` e `renderer/src/hooks` — 1.893 testes passando, com `src/main` em 93,8% de linhas, `src/shared` 98,1%, `preload` 100%, `renderer/lib` 99,0% e `renderer/hooks` 99,6%; `jsdom` entrou como devDependency só para os hooks de DOM e os limiares do `vitest.config.ts` subiram para os números reais (≥90% no main, ≥95% em shared/preload/lib, ≥96% em hooks)
- **Acesso remoto passou a usar ZeroTier no lugar do Tailscale**: a seção **Configurações → Acesso remoto** e o **Modo remoto** do card do Kloud Games detectam o CLI oficial (`zerotier-cli -j info`/`-j listnetworks`), mostram o endereço atribuído pela rede, separam os IPs da VPN dos da LAN pelo adapter/`assignedAddresses` e instalam/abrem o ZeroTier por ação explícita (`winget` e GUI oficial); ingressar na rede continua sendo feito no app/painel do ZeroTier (IPCs `remote:install-zerotier`/`remote:open-zerotier`, motivos `zerotier-missing`/`zerotier-disconnected`)

### Corrigido

- **Travamento do mouse/PC ao abrir o Hub** (pior com jogo em fullscreen, ex.: Valorant): a listagem de processos do sistema virou **assíncrona** e roda num **único** processo PowerShell persistente por sessão (com cache de 5 s e uma consulta em voo) — antes cada consulta levava ~5 s **bloqueando o event loop** e um `powershell.exe` novo era criado a cada 5 s. A lista de inicialização também saiu do caminho da tela de loading, o seed do Mark LVI e o reparo de ícones passaram a rodar **depois** da janela abrir e as páginas/painéis do renderer entram por **code splitting** (chunk inicial de 1.334 KB → 649 KB)

## [1.1.0] - 2026-11-18

Primeira versão com a numeração alinhada às tags (`v1.1.0`). Reúne o que estava em `[Não lançado]` e o que foi bumpado internamente como `1.2.0`, `1.3.0` e `1.4.0` — numeração que nunca teve tag nem release própria (ver [Notas](#notas)). Conteúdo acumulado desde a 1.0.0 (`c110ca62`), passando pelos bumps internos `1ec3dffe`, `67f654c9` e `3454e458`.

### Adicionado

- **Intervalo de atualização do monitor**: seletor na aba **Meu PC → Monitor** (0,1 s a 2,0 s, padrão 0,5 s) aplicado ao polling único de sensores que alimenta a aba e o **HUD**; o valor é persistido em `hwmonIntervalMs` no electron-store e normalizado no main (IPC `hwmon:get-interval`/`hwmon:set-interval`). Abaixo de ~0,6 s a coleta completa não cabe no período — o Hub atualiza o mais rápido que consegue, sem sobrepor leituras
- **Atualização pelo próprio app**: a cada abertura o Hub consulta a release estável mais recente no GitHub (`/releases/latest`) e mostra o banner **"Nova atualização disponível"** quando a tag `vX.Y.Z` é mais nova que `app.getVersion()` (comparação **SemVer**; tag fora do formato é ignorada); o download do Setup tem progresso e cancelamento, **exige o digest SHA-256 publicado na Release** (release sem hash só oferece a página) e confere a assinatura Authenticode antes de executar — `NotSigned` é aceito porque o projeto não assina código, mas assinatura quebrada/ilegível é recusada; o hash é recalculado imediatamente antes do `spawn` (proteção contra troca do arquivo em disco); ao final o instalador é aberto e o Hub encerra (IPC `updates:check`/`install`/`cancel` + evento `update:progress`)
- **Acesso remoto (Tailscale)** em Configurações: status do Tailscale e das interfaces, IP público consultado só por clique (com classificação NAT/CGNAT), teste das portas TCP do Moonlight, instalação via `winget` e abertura do painel para parear o PIN — tudo validado no renderer; nova chave `remoteAccess` no electron-store (migração 1.8.0)
- **Desinstalação pelo app**: botões "Desinstalar Kloud Games" (via `msiexec /x {ProductCode}`, elevado por UAC) e "Desinstalar Kolnd Hub" (desinstalador NSIS per-user) em Configurações → "Zona de perigo", com confirmação digitada, saídas honestas para instalação quebrada, matriz de erros e casos de borda dos fluxos (`15f6d9ab`, `b665ad5a`, `7e4f9898`)
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
- **Jogo personalizado**: adicionar jogo via seletor de `.exe` (nome formatado a partir do arquivo, ícone extraído do executável, IPC `games:add-custom` com id determinístico) (T8)
- **Edição de jogos** na Biblioteca: renomear, trocar/restaurar ícone (PNG/JPG/WebP), trocar `.exe`, selo ".exe não encontrado" (IPC `games:check-exes`) e remoção com confirmação (T9)
- **Autostart do Kloud Games**: preferência "Iniciar Kloud Games junto com o Hub" nas Configurações (electron-store, migração `'1.3.0'`, IPCs `prefs:get`/`prefs:set`); avaliada uma única vez por sessão, nunca na primeira execução (T10)
- IPC `dialog:pick-path` passa a aceitar título opcional
- **Manutenção do PC** na UI: atualização de programas via `winget` (listagem com parsing posicional/JSON, seleção em lote com estado indeterminado, fila sequencial, cancelamento e erro por item que não aborta a fila) (T3/T4)
- **Limpeza de arquivos temporários**: apenas `%TEMP%`, `%LOCALAPPDATA%\Temp` e `C:\Windows\Temp`, mais antigos que 24h, ignorando symlinks (T5)
- **Biblioteca de jogos**: IPC `games:*` com persistência no electron-store (migração `'1.2.0'`) e página própria (T6)
- **Importação de jogos da Steam**: detecção via registro/layout padrão, parsing de `libraryfolders.vdf`/`appmanifest`, filtro de ferramentas/redistribuíveis, localização do executável, ícone extraído, deduplicação por `steamAppId` e id determinístico (T7)
- **Instalação do Kloud Games endurecida**: pula reinstalação, `/norestart`, log, verificação pós-instalação e erros claros (T1)
- **Hub detecta/instala o Kloud Games automaticamente ao abrir** (via MSI embutido, silencioso) (`88d3393c`)
- Infraestrutura de qualidade: Vitest, ESLint, Prettier e CI (GitHub Actions em `windows-latest`), helper `commandLine`
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
- Store passa a ser a fonte da configuração do controle e do modo Big Picture (migração `'1.4.0'`; clientes antigos aplicam as migrações pendentes em ordem)
- Página "Biblioteca" renomeada para **Ferramentas** (T2)
- Defaults genéricos em `apps.ts` (`cdd2a597`); READMEs com nota sobre a branch `Dev` (`6b332af2`)

### Removido

- Diretório `Sunshine/` e snapshots do `deepseek-harness` do repositório (projeto consolidado no repo pessoal) (`9538de6b`, `156b113a`)

### Corrigido

- `build-installer.bat` garante o Node.js no PATH antes de invocar `npm` (`280fadfc`)

### Segurança

- **Helper de FPS protegido**: a tarefa `KolndHubFpsAgent` (`ONLOGON`/`HIGHEST`) passou a executar o binário em `%ProgramData%\Kolnd Hub\fps\bin`, criado pelo processo elevado com ACL explícita (SYSTEM/Administradores `F`, Usuários só `RX`, sem herança) e **SHA-256 conferido no destino** — antes o `.exe` ficava em `%APPDATA%`, onde qualquer processo do usuário podia substituí-lo e ganhar Administrador no próximo logon
- **Elevação sem arquivo em `%APPDATA%`**: os scripts elevados (instalar/remover o agent e iniciar a medição) vão por `powershell.exe -EncodedCommand` (UTF-16LE/base64); não existe mais `.ps1` gravado em diretório gravável pelo usuário entre a gravação e o clique no UAC
- **FPS automático é opt-in**: a tarefa no logon deixou de ser instalada na primeira execução — a ativação (1 UAC explícito) fica na aba **Monitor**
- Janela principal bloqueia navegação externa (`will-navigate`) (`620858c1`)
- `requestSingleInstanceLock`: a segunda instância restaura a janela existente em vez de subir outro processo/tocar no disco (`3751ca35`)

## [1.0.0] - 2026-11-11

Commit: `c110ca62`. Versão inicial registrada neste repositório. Sem tags git — hash citado como referência.

### Adicionado

- **Kolnd Hub** — aplicativo desktop (Electron) para iniciar, parar e monitorar os programas do ecossistema Kolnd: dashboard, bandeja do sistema, configurações e primeira execução guiada
- Instalador único **NSIS per-user** (`Kolnd Hub Setup <versao>.exe`), sem exigir administrador, com Python (winget) e MSI do Kloud Games instalados de forma elevada na primeira execução
- Monorepo: `kolnd-hub/` (o app), `Mark-LVI/` (assistente JARVIS), `kloud-games/` (servidor Sunshine-like), `build-installer.bat` (build completo: MSI → instalador) e `.github/workflows/ci.yml`
- READMEs gerais e notas sobre a branch `Dev`

**Nota honesta:** a 1.0.0 é uma importação de um projeto que já existia fora deste git — o histórico anterior (antes de `c110ca62`) não está disponível para reconstrução.

## Notas

- **Tags**: o repositório tem `v1.0` (17/11/2026, commit `e65d90e0`) e `v1.1.0-beta` (11/11/2026, commit `4a0e61fb`); não há GitHub Releases publicadas com instalador. Por isso as seções citam **hashes de commit** em vez de links de comparação (`compare/v1.0...v1.1.0`). Se releases futuras forem publicadas, os links podem ser adicionados.
- **Numeração interna (1.2.0–1.4.0)**: antes de existirem tags, o `package.json` foi bumpado internamente para `1.2.0`, `1.3.0` e `1.4.0` (a `1.1.0` foi pulada). Nenhuma dessas versões teve tag ou release própria; todo o conteúdo foi consolidado na `1.1.0` para alinhar a versão do app à tag. Instaladores gerados nessa fase se identificam como `1.4.0` e, pela comparação **SemVer** do updater, não recebem a oferta da `1.1.0` — é preciso instalar o Setup `1.1.0` manualmente.
- **Datas**: correspondem ao commit de bump no `package.json`, não a uma publicação de instalador; a geração e a publicação do artefato são passos separados (ver `docs/RELEASE.md`).
- **Licenças**: o código do Kolnd Hub (`kolnd-hub/`) é MIT (ver `kolnd-hub/package.json`). Os demais componentes têm licenças próprias: `kloud-games/` é GPL-3.0 (fork do Sunshine da LizardByte) e `Mark-LVI/` — ver `Mark-LVI/LICENSE`. Veja a seção **Licenças** do README raiz. A tarefa 11-11.5 (NOTICE no instalador) está pendente.
- **Conteúdo reconstruído de archaeologia de git** (`git log` + diffs de `package.json`); releases não foram publicadas e não há notas oficiais para confrontar — por isso **a revisão do usuário é etapa obrigatória** (T4) antes de tratar este arquivo como fonte definitiva das release notes.

## Como manter

Toda PR/commit relevante adiciona uma entrada em **[Não lançado]**, agrupada pelo tipo (Adicionado / Alterado / Corrigido / Removido / Segurança). No bump de versão, a seção vira `## [X.Y.Z] - AAAA-MM-DD` e **[Não lançado]** recomeça vazio. Versionamento segue SemVer: quebra de compatibilidade → MAJOR; recurso novo compatível → MINOR; correção → PATCH.
