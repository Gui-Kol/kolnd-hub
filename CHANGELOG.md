# Changelog

Todas as mudanças notáveis do **Kolnd Hub** são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento [SemVer](https://semver.org/lang/pt-BR/). Datas no formato `AAAA-MM-DD` e correspondem à data do commit que bumpou a versão — as tags `v1.0` e `v1.1.0-beta` existem no repositório, mas não há GitHub Releases publicadas com instalador (ver [Notas](#notas)); onde o git não permitir datar com precisão, consta `(a confirmar)`.

Repositório: <https://github.com/Gui-Kol/kolnd-hub>

## [Não lançado]

### Adicionado

- **PR automático de `Dev` para `main`** (`.github/workflows/dev-to-main-pr.yml`): todo push em `Dev` garante um PR aberto para `main`; se ele ainda não existe, é criado, e nos pushes seguintes apenas a descrição é atualizada (os commits novos entram sozinhos, porque o head do PR é a própria `Dev`). O bloco automático fica entre os marcadores `dev-to-main:auto` e o texto manual fora deles é preservado
- **Modo remoto do Kloud Games virou um fluxo completo de ZeroTier**: o clique instala a última versão pelo winget quando o ZeroTier está ausente e re-tenta ligar o modo; o tutorial do card ganhou abas **No PC (este computador)** e **No celular**, com passos simples e botões de copiar (IP do ZeroTier, ID da rede, IP local e "Copiar tudo"). O ZeroTier agora pode ser **aberto/fechado** pelo Hub com selo **Aberto / Aberto em segundo plano / Fechado** (serviço lido por `sc.exe` + GUI por `tasklist`; abrir/fechar o serviço usa UAC e relê o estado) e o card mostra o IP do ZeroTier em destaque com botão de copiar

### Removido

- **Dependabot**: `.github/dependabot.yml` removido do projeto; atualizações de dependências voltam a ser manuais

## [1.2.1] - 2026-11-24

### Alterado

- **JARVIS atualizado para o Mark LVII**: o Mark LVI saiu do monorepo e o Hub passou a apontar para o novo projeto em `Mark-LVII/` — bundle `resources/programs/MarkLVII/MarkLVII.exe`, script `kolnd-hub/scripts/build-mark-lvii.ps1` (PyInstaller) e migração automática das configurações salvas do Mark LVI (`MarkLVI.exe` em `resources/programs/MarkLVI` e `py main.py` em `../Mark-LVI`) para o novo executável
- **Dados do assistente sem espelho**: o Mark LVII grava `config/` (chave de API) e `memory/` ao lado do executável; o Hub não define mais `MARK_LVI_HOME`, não semeia `%APPDATA%\kolnd-hub\mark-lvi` e não lista essa pasta na desinstalação (os dados vão junto com a instalação, como antes do patch de migração)

### Removido

- Vestígios do Mark LVI: pasta do bundle antigo, referências em CI/release/`build-all.ps1`/`verify-release.ps1`, textos de desinstalação e o seed `seedMarkLviData`/`getMarkLviDataDir`

## [1.2.0] - 2026-11-24

### Adicionado

- **"Buscar jogos" na Biblioteca (Steam + Epic Games + Minecraft Launcher)**: o antigo "Importar jogos da Steam" virou uma ação única (`games:import-all`) que varre as três fontes instaladas, adiciona automaticamente o que encontra e mostra um relatório por fonte — novos, já na biblioteca, "não encontrado neste PC" e erros. A origem nova (`epic`/`minecraft`) aparece no badge do card e nos filtros, e uma fonte ausente não é erro
- **Big Picture pelo botão PS/Guide do controle**: com a janela do Hub em foco, apertar o botão PS (Xbox Guide, índice 16 da Gamepad API) abre o modo Big Picture pelo mesmo gate de configuração da topbar; sem foco nada acontece. Só a borda de pressão dispara (segurar não repete) e o estado já pressionado ao (re)armar é ignorado — sair do modo com o PS segurado não o reabre. O mapeamento das 12 ações continua proibindo o índice 16, e controles cujo driver não expõe esse índice mantêm a entrada pelo botão da topbar
- **Tensão do núcleo (Vcore) na sobreposição**: a seção **CPU** do HUD ganhou a métrica **Vcore** (`hud-cpu-voltage`, 3 casas, unidade V), lida do agente elevado de sensores (SVI2 no AMD, `IA32_PERF_STATUS` no Intel); sem leitura o valor é "—", nunca uma estimativa
- **FPS no HUD sem tarefa separada**: o coletor ETW (`KolndFpsEtw.exe --sink`) passou a rodar **dentro do agente elevado de sensores** (`KolndHubSensorsAgent`), com cópia protegida em `%ProgramData%` (ACL de Usuários: RX, SHA-256 conferido) e sink `%ProgramData%\Kolnd Hub\fps` legível por Usuários. Um único UAC instala/atualiza o agente e o FPS passa a funcionar sozinho a cada logon, sem pedir permissão por uso
- **Tempo de jogo na Biblioteca**: os cards mostram o total acumulado, o total da semana (desde segunda-feira 00:00 local) e a última vez que o jogo foi aberto; a contagem considera só jogos abertos pelo Hub (tick de 20 s, clamp de 60 s por tick) e o pendente é salvo a cada ~5 min de sessão e na saída do app
- **Favoritos e coleções de jogos**: estrela no card da Biblioteca, filtros Todos/Favoritos e seletor de coleção, seção de coleções no modal de edição (chips das existentes + criar nova, até 8 por jogo) e barra de filtros focável no Big Picture (Todos · Favoritos · Recentes + coleções), com estado vazio próprio
- **Busca, filtros e ordenação inline na Biblioteca**: busca por nome sem acento e sem diferenciar caixa, filtros de origem e coleção, alternador "Sem executável", ordenação por Nome A–Z/Z–A, Tempo de jogo e Mais recentes, contador de resultados e "Limpar filtros" — tudo em memória
- **"Continuar jogando" no Dashboard**: faixa até 6 jogos recentes (capa 2:3 quando houver, senão o ícone), com tempo relativo ("há 2 h") e clique que lança o jogo pelo Hub; some por completo quando não há histórico
- **Capa por jogo**: escolha manual de PNG/JPG/WebP (até 8 MB) no modal de edição, gravação em `%APPDATA%/kolnd-hub/game-covers/` e exibição em proporção 2:3 na grade da Biblioteca, no Big Picture e na faixa "Continuar jogando"; sem capa, o card mantém o ícone/fallback atual. Nada é baixado da internet
- **Ícones da Biblioteca recarregados ao abrir a aba**: o main revisa todos os jogos e re-extrai do executável apenas os ícones que não estão legíveis (arquivo ausente, vazio ou corrompido), garantindo que os cards fiquem preenchidos; ícones válidos — inclusive os escolhidos à mão no modal de edição — nunca são sobrescritos (IPC `games:reload-icons`)
- **Botão "Atualizar ícones" na Biblioteca**: no cabeçalho da página, re-extrai o ícone de **todos** os jogos a partir dos executáveis — o mesmo efeito de abrir cada jogo e clicar em "Restaurar ícone". Por ser ação explícita, sobrescreve também ícones escolhidos à mão; o main grava os arquivos, persiste os caminhos novos numa única escrita do store, apaga as sobras dos ícones antigos e o renderer descarta o cache para buscar as imagens novas; o toast resume atualizados/total e quantos ficaram sem ícone utilizável (IPC `games:refresh-icons`)

### Alterado

- **Aba Monitor com uma única fonte de FPS**: o card **Desempenho** lê apenas a publicação elevada (o caminho manual e a tarefa `KolndHubFpsAgent` saíram da UI); o estado e o motivo do "—" (fonte parada, amostra velha, sem alvo, sem presents) aparecem no card e no rodapé do HUD. Os IPCs `fps:*` e `fps:auto-*` e o preload continuam compatíveis
- **Agente de sensores marcado como desatualizado também sem o coletor de FPS**: `DriverStatusInfo.outdated` passa a considerar a ausência/divergência do `KolndFpsEtw.exe` estagiado, então o botão **"Atualizar leitura elevada"** reaparece mesmo com o sink de sensores fresco
- **Benchmark e teste de estresse de CPU usam 100% da CPU**: o benchmark mantém as cinco cargas, as três repetições e a escala, mas agora os processos de cada fase aquecem as cargas e começam a medir juntos (barreira de início), eliminando a cauda em que o multi rodava com menos núcleos no fim; o teste de estresse deixou de limitar a carga a ~80% de cada núcleo e passou a rodar carga contínua em um processo por núcleo lógico, com a mesma mecânica do CPU-Z. A interface continua respondendo porque os processos de carga rodam em prioridade abaixo da normal, e a aba Meu PC → Benchmark explica isso no texto
- **Kloud Games atualizado para o Sunshine v2026.1123.40502**: mantendo a identidade visual e o frontend do Kolnd Hub, o fork recebeu os encoders legados **MPEG-2/H.263+**, a opção **resolução máxima de stream**, captura **ScreenCaptureKit** e **VideoToolbox v2** no macOS, correções de input/portal/multiseat no Linux, a migração das dependências para **CPM** e a atualização de libvirtualhid/moonlight-common-c/nvapi; a opção de doações continua removida
- **Suíte unitária elevada a toda a lógica testável**: Vitest passou a cobrir `src/main` (incl. os 16 módulos de `ipc/`), `src/shared`, o contrato de `src/preload`, `renderer/src/lib` e `renderer/src/hooks` — 1.893 testes passando, com `src/main` em 93,8% de linhas, `src/shared` 98,1%, `preload` 100%, `renderer/lib` 99,0% e `renderer/hooks` 99,6%; `jsdom` entrou como devDependency só para os hooks de DOM e os limiares do `vitest.config.ts` subiram para os números reais (≥90% no main, ≥95% em shared/preload/lib, ≥96% em hooks)
- **Acesso remoto passou a usar ZeroTier no lugar do Tailscale**: a seção **Configurações → Acesso remoto** e o **Modo remoto** do card do Kloud Games detectam o CLI oficial (`zerotier-cli -j info`/`-j listnetworks`), mostram o endereço atribuído pela rede, separam os IPs da VPN dos da LAN pelo adapter/`assignedAddresses` e instalam/abrem o ZeroTier por ação explícita (`winget` e GUI oficial); ingressar na rede continua sendo feito no app/painel do ZeroTier (IPCs `remote:install-zerotier`/`remote:open-zerotier`, motivos `zerotier-missing`/`zerotier-disconnected`)

### Removido

- **OpenOffice removido por completo**: saíram a página do escritório isométrico, o card do grupo Inteligência Artificial, o item da topbar e do mega menu, a seção **Configurações → OpenOffice**, todos os canais IPC `office:*`, o instalador/ponte do plugin do OpenCode, os contratos compartilhados (`src/shared/office*`), as chaves `officeDepartments`/`officeAvatars` do electron-store (a migração 1.10.0 virou no-op) e os testes unitários/e2e correspondentes

### Corrigido

- **FPS não aparecia no overlay**: nesta máquina não existia tarefa de FPS nem sink `%ProgramData%\Kolnd Hub\fps`, então o HUD só tinha o caminho manual (que nunca rodou). O coletor agora é filho do agente de sensores, encerra junto com ele (stop-file + kill por linha de comando) e o instalador apaga a tarefa legada se ela existir
- **Falha do coletor de FPS não impede mais instalar os sensores**: a preparação do `KolndFpsEtw.exe` é best-effort; se ela falhar, o agente é instalado sem FPS, a UI mostra um aviso não fatal (não marca erro) e o botão "Atualizar leitura elevada" continua disponível para tentar de novo. O `--stop` do modo sink foi coberto por teste de processo real, saindo com `reason=stop-file`
- **Teste de estresse sem travar o Hub e sem deixar processos para trás**: a carga saiu das threads internas do app e passou a usar processos separados; parar, cancelar, a vigilância da interface (10 s sem resposta) e o fechamento do Hub encerram todos os processos na hora, e o checksum de integridade continua verificando a computação a cada meio segundo
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
