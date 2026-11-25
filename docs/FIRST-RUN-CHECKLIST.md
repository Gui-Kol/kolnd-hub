# Checklist de validação em máquina limpa — primeira execução do Kolnd Hub

> **Status (15/11/2026):** checklist **preparado** a partir de leitura direta do código — **execução em VM limpa PENDENTE**. Nenhuma etapa deste roteiro foi exercitada de fato em máquina limpa até a data acima. Não interprete este documento como "validado".
>
> **Uso:** repetir a cada release (e após mudanças no fluxo de primeira execução ou bump de Electron). Fonte única do processo de release: [`RELEASE.md`](RELEASE.md) — este checklist detalha o **Passo 2** (e a parte de desinstalação do **Passo 5**). Marque os itens com `- [x]` durante a execução e registre o resultado na seção [Registro de execuções](#registro-de-execuções).
>
> **Escopo:** validar a instalação a partir do `.exe` e o fluxo de primeira execução (winget → Python; MSI do Kloud Games via UAC; implantação Mark LVII; flag de primeira execução; desinstalação preservando `%APPDATA%\kolnd-hub`).

---

## Como o fluxo funciona hoje (verificado no código em 15/11/2026)

Mapa levantado por leitura de `kolnd-hub/src/main/` (T1 da task 02-2.2). Cite símbolos, não só linhas — os números de linha podem envelhecer.

### Ordem das etapas — `firstRunInstaller.ts` (`FirstRunInstaller.install()`)

| # | stepId       | O que acontece                                                                                                                                                               | Fatal?                                |
| - | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1 | `check`      | `checkDependencies()` (`dependencyChecker.ts`): testa `py`, `python`, `python3 --version` e `-m pip --version` (spawnSync, timeout 5 s cada). Falta de dependência **não** interrompe; só loga `Faltam: …`. Exceção inesperada no `check` → `throw` → fluxo falha. | Na prática não-fatal (check não lança em operação normal) |
| 2 | `python`     | Se Python **e** pip já detectados → pula (`Python já instalado`). Senão `installPython()` (`silentInstaller.ts`): `winget install --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements` (spawn, `stdio: ignore`). | **Fatal** — falha aqui aborta a 1ª execução e a flag **não** é gravada |
| 3 | `kloud-games`| `installKloudGames()` → `ensureKloudGamesInstalled()` (`kloudGames.ts`). Já instalado → pula. Senão abre o **MSI embutido** via UAC (ver abaixo). Falha aqui **não** bloqueia o Hub. | **Não-fatal** (erro vira status `error` na UI; fluxo segue) |
| 4 | `programs`   | `deployPrograms()` (`programsDeployer.ts`): verifica/implanta `MarkLVII` (produção: só `resources/programs/MarkLVII` embutido; o fallback de copiar de `../Mark-LVII/dist` é **somente dev**) e detecta o Kloud Games (`findKloudGamesExe`). | **Fatal se 0 programas implantados**; parcial (1 de 2) → apenas aviso no log, segue |
| 5 | `finalize`   | Etapa simulada (5 ticks × 200 ms, `runStep`) — não persiste nada além do que já foi feito; só exibe "Finalizando instalação…".                                                | Não-fatal                              |
| — | (flag)       | `markFirstRunComplete()` (`firstRun.ts`) grava `1` em `%APPDATA%\kolnd-hub\first-run-complete.flag`. O renderer **também** chama `firstRun:markComplete` ao receber sucesso (`FirstRunInstall.tsx`, `firstRun:markComplete` → `markFirstRunComplete()`, idempotente). | —                                      |

Cancelamento (`firstRun:cancel`) só é checado **entre** etapas; cancelar no meio de um passo não mata o processo filho em andamento.

### Onde o UAC é elevado

- **Kloud Games (único `RunAs` explícito no código):** `launchInstallerElevated()` (`kloudGames.ts`) sobe `powershell.exe -NoProfile -Command "$p = Start-Process msiexec.exe -ArgumentList '/i \"<msi>\" /norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"` — **assistente visível** (não usa `/quiet`; comentário no código: "a pessoa vê e conclui o assistente"). O MSI é **per-machine** → Windows abre o prompt do UAC.
  - Saída/resultado da elevação vão para `%APPDATA%\kolnd-hub\logs\kloud-games-install.log` (início, MSI, comando, código de saída, motivo).
  - UAC negado é detectado por regex na saída (`looksLikeUacDenied`: `cancelad|cancelled|canceled|1223|…`, pt-BR/en).
  - Códigos tratados: `1602` (assistente cancelado), `1500`/`1618` (outra instalação em andamento), `1704`/`1705` (instalação suspensa/pendente). `3010`/`1641` = sucesso com reinício necessário.
  - Após instalar, o Hub **reconfirma a existência real** do `KLOUD_GAMES.exe` (estado salvo → pasta do Hub → `Program Files` → varredura ≤ 3 de profundidade) antes de reportar sucesso. Se o exe aparecer mesmo com `msiexec` ≠ 0, considera instalado.
- **Python via winget:** o código **não** eleva explicitamente (sem `RunAs`, sem `--scope`). Se um prompt de UAC aparecer, ele vem do próprio winget/instalador do pacote `Python.Python.3.12` — observar e registrar o comportamento real na VM (scope padrão do pacote, se eleva silenciosamente ou falha sem admin).
- **Instalação do Hub (NSIS):** per-user, **sem** UAC (`perMachine: false` em `electron-builder.yml`).

### O que os logs registram (e o que NÃO registram)

| Arquivo                                              | Quem escreve                                                                     | Conteúdo relevante à 1ª execução                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `%APPDATA%\kolnd-hub\logs\kolnd-hub.log`            | `logger.ts` (rotação 5 MB × 2; nível mínimo `info`; `debug` só com `KOLND_HUB_LOG_LEVEL=debug`) | Linhas de `kloud-games` (ex.: "já instalado — pulando") e `programsDeployer` (falhas de implantação do Mark LVII). **A sequência de etapas da 1ª execução NÃO é gravada aqui** — `firstRunInstaller.ts` só emite para o renderer. |
| `%APPDATA%\kolnd-hub\logs\kloud-games-install.log`  | `appendKloudGamesLog()` (`kloudGames.ts`)                                       | Início da instalação do MSI, comando elevado, código de saída, motivo da falha (UAC negado / 1602 / 1500·1618 / 1704·1705), MSI ausente, resultado da verificação pós-instalação. |
| `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log`| `appendKloudGamesUninstallLog()` (`kloudGames.ts`)                              | Só nos fluxos de desinstalação do Kloud Games (etapa relevante ao Passo 5 do RELEASE.md).                                      |
| (nenhum — volátil)                                   | UI `FirstRunInstall.tsx`                                                        | Log completo da instalação aparece **apenas na tela** (área monoespaçada, rolagem automática). Fechar o app perde o log.       |

Estado persistido também em `%APPDATA%\kolnd-hub\kloud-games.paths.json` (exePath/msiPath/installedAt/updatedAt) e, durante a 1ª execução, `config.json` (electron-store) é criado.

### Tela de primeira execução (T2 — `FirstRunInstall.tsx`)

- Lista as 5 etapas com ícone/estado: pendente (cinza) → running (laranja, spinner) → done (verde, check) → error (vermelho, alerta). Barra de progresso global = `etapas done / 5`.
- Rótulo sob a barra: `Instalando dependências…` → muda para `Erro na instalação` se qualquer etapa falhar ou `Instalação concluída` no sucesso.
- Cada etapa `running` com progresso > 0 mostra `(NN%)` ao lado do rótulo.
- Erro na etapa **Kloud Games**: botão **"Tentar novamente"** na própria linha (`firstRun:retry-kloud-games` → reexecuta **só** a etapa do Kloud Games — não refaz check/Python/programas).
- Erro em qualquer etapa: caixa de log exibe `Algo deu errado durante a instalação. Verifique sua conexão e tente novamente.`
- Botão inferior: desabilitado enquanto não há erro e após conclusão; em erro vira **"Tentar novamente mais tarde"** (chama `firstRun:cancel`, que é um no-op fora de uma instalação em andamento — a saída real para refazer o fluxo é **fechar e reabrir o app**; a flag não foi gravada, então a 1ª execução recomeça do zero).
- Sucesso: log `[KolndHub] Instalação concluída com sucesso!`, o renderer chama `firstRun:markComplete` e, após ~1,2 s, `onComplete()` → dashboard. Nas aberturas seguintes, o app vai direto para o dashboard (o `?first-run=1` só é anexado quando `isFirstRun()` é verdadeiro — `index.ts`).
- Nota: `Kloud Games` falho aparece como etapa vermelha **mas o fluxo termina com sucesso** (não-fatal) — o usuário só percebe o detalhe lendo o log da tela.

---

## Limitações atuais (leia antes de preparar a VM)

1. **O bundle real do Mark LVII não está no git** (`kolnd-hub/resources/programs/MarkLVII/` é gitignored, ~600 MB). O `npm run package` em CI usa apenas um **placeholder** (`.github/workflows/ci.yml`, "Create placeholder resources for packaging" — só um `README.txt`). O CI prova que o pipeline empacota; **não** prova que o app instalado funciona.
2. **O MSI do Kloud Games também não está no git** (`*.msi` ignorado). O caminho esperado é `kolnd-hub/resources/programs/kloud-games/KLOUD_GAMES.msi` (~53 MB), gerado por `build-installer.bat` (raiz) ou `kolnd-hub\scripts\build-kloud-games.ps1`.
3. **Validar a primeira execução de verdade exige** ou (a) o bundle local do Mark LVII (`kolnd-hub\scripts\build-mark-lvii.ps1`, requer o repo `Mark-LVII/` ao lado, Python + PyInstaller + deps) **mais** o MSI real, ou (b) aceitar explicitamente que o cenário testado é o de um instalador **sem** esses recursos.
4. **Instalador sem Mark LVII e sem MSI → etapa `programs` FALHA de forma fatal** (0 de 2 implantados → `throw` → `complete { success: false }` → flag **não** gravada → tela de erro, e a cada reabertura o fluxo recomeça). Esse é o resultado esperado de um build CI/placeholder, **não** um bug do fluxo — mas invalida qualquer "validação" feita com ele.
5. Assinatura de código pendente (task 02-2.4): SmartScreen/Defender podem sinalizar o `.exe` na VM. Isso é esperado hoje; não mascare como falha do fluxo — registre separadamente.
6. A desinstalação preservando `%APPDATA%\kolnd-hub` é coberta pelo **Passo 5 do [`RELEASE.md`](RELEASE.md)** e pela seção "Checklist de release: verificação da desinstalação" no README raiz — este checklist replica os passos mínimos e aponta para lá.

---

## Pré-requisitos da VM

- [ ] Windows 10 ou 11 **limpo** (Hyper-V ou Windows Sandbox), **sem** Node.js, **sem** Python, **sem** MSYS2, **sem** Kloud Games e **sem** Kolnd Hub instalados.
- [ ] Snapshot/checkpoint tirado **antes** de qualquer instalação (permite repetir cenários).
- [ ] Conta de usuário **padrão (sem admin)** criada na VM — é a conta do teste de instalação per-user e da primeira execução.
- [ ] Credenciais de um administrador disponíveis para aprovar/negar os prompts de UAC (MSI do Kloud Games é per-machine).
- [ ] Rede normal (NAT) funcionando; se houver ambiente corporativo/proxy, reservar um segundo cenário (seção [F. Rede atrás de proxy](#f-rede-atrás-de-proxy-se-aplicável)).
- [ ] Artefatos copiados para dentro da VM (pasta compartilhada ou mídia): `Kolnd Hub Setup <versão>.exe` (gerado em `kolnd-hub/dist/`) e, opcionalmente, `KLOUD_GAMES.msi` separado para instalação manual.
- [ ] Para gerar o instalador usado no teste: rodar `npm run package` em `kolnd-hub/` (equivale a `electron-vite build && electron-builder --win`) **com o bundle real do Mark LVII e o MSI presentes** — ver Limitações. O fluxo completo a partir do zero é `build-installer.bat` (na raiz; compila o Kloud Games → MSI e depois empacota o Hub).
- [ ] Espaço em disco: o instalador tem ~360 MB; a instalação descompactada + Mark LVII ocupa bem mais.

---

## A. Preparação

- [ ] Confirmar na VM que `winget --version` funciona **ou** falha conforme o cenário a testar (registrar a saída exata).
- [ ] Confirmar que `py --version`, `python --version` e `python3 --version` **falham** (máquina limpa não deve ter Python).
- [ ] Confirmar que `C:\Program Files\KLOUD_GAMES` **não** existe.
- [ ] Confirmar que `%APPDATA%\kolnd-hub` **não** existe (ou está vazio, se a VM foi reaproveitada — preferir snapshot limpo).
- [ ] Anotar versão testada (`version` de `kolnd-hub/package.json`) e origem do instalador (build local com bundle real? CI? build-installer.bat?).

## B. Instalação per-user (sem admin)

- [ ] Executar `Kolnd Hub Setup <versão>.exe` **como a conta sem admin**.
- [ ] Esperado: instalação **por usuário**, sem prompt de UAC, em `%LOCALAPPDATA%\Programs\Kolnd Hub`. Critério de falha: pedir admin ou falhar por permissão.
- [ ] Confirmar que `%LOCALAPPDATA%\Programs\Kolnd Hub\resources\programs\` contém `MarkLVII\` e `kloud-games\KLOUD_GAMES.msi` (ou registrar o que falta — ver Limitações).
- [ ] Confirmar que o Hub aparece em "Aplicativos instalados" sem UAC para desinstalar depois.

## C. Primeira execução — caminho feliz (Python ausente, UAC aceito)

- [ ] Abrir o Kolnd Hub pela primeira vez. Esperado: tela "Primeira execução" com as 5 etapas; a janela **não** vai direto ao dashboard.
- [ ] **Etapa check**: log mostra `=== Relatório de Dependências ===` com `Python: NÃO instalado` e `pip: NÃO disponível`; etapa fica verde.
- [ ] **Etapa python**: log mostra `Instalando Python 3.x e pip…`; o winget instala `Python.Python.3.12` silenciosamente. **Observar se há prompt de UAC** (o código não eleva explicitamente — registrar o que acontecer: sem prompt / UAC do próprio winget / falha por falta de permissão).
- [ ] Esperado ao final da etapa: `python --version` (ou `py --version`) funciona em um terminal **novo**. Se falhar, registrar a saída e tratar como falha do cenário.
- [ ] **Etapa kloud-games**: o Windows abre o **assistente visível** do MSI (não é silencioso). Aceitar o UAC e concluir o assistente.
- [ ] Esperado após a etapa:
  - `C:\Program Files\KLOUD_GAMES` existe;
  - serviço `KLOUD_GAMESsvc` presente e rodando (`services.msc`);
  - regras de firewall criadas (`wf.msc`);
  - `%APPDATA%\kolnd-hub\kloud-games.paths.json` com `exePath` apontando para `C:\Program Files\KLOUD_GAMES\KLOUD_GAMES.exe` e `installedAt` preenchido.
- [ ] `%APPDATA%\kolnd-hub\logs\kloud-games-install.log` contém: linha de início com o caminho do MSI, comando `Start-Process … -Verb RunAs …`, código de saída `0` (ou `3010`/`1641` = sucesso com reinício pendente).
- [ ] **Etapa programs**: log mostra relatório `=== Implantação de Programas ===` com `Mark LVII (JARVIS): OK` e `Kloud Games: OK`. (Se Mark LVII estiver ausente por falta de bundle, ver Limitações e seção [G](#g-programas-e-mark-lvii-bundle-real).)
- [ ] **Etapa finalize**: "Finalizando instalação…" por ~1 s; depois o log mostra `[KolndHub] Instalação concluída com sucesso!` e a tela fecha sozinha para o dashboard (~1,2 s).
- [ ] **Flag persistida**: `%APPDATA%\kolnd-hub\first-run-complete.flag` existe e contém `1`.
- [ ] `%APPDATA%\kolnd-hub\config.json` existe (electron-store criado).
- [ ] Fechar e reabrir o app → vai direto para o dashboard, sem a tela de instalação, **sem** novo UAC.

## D. Falha de winget / Python (cenários negativos)

- [ ] **winget ausente** (ex.: VM sem App Installer): a etapa python falha com `winget não encontrado. Instale o Python manualmente ou execute este app como administrador.` A tela mostra a etapa em vermelho + mensagem de erro genérica; a 1ª execução **falha** (fatal) e a flag **não** é gravada.
- [ ] Reabrir o app após essa falha → a tela de primeira execução reaparece e recomeça (comportamento esperado). Registrar.
- [ ] **winget falha** (ex.: rede bloqueada para as fontes do winget): a etapa falha com `winget saiu com código <N>`; mesmo resultado fatal. Registrar código de saída e mensagem.
- [ ] **UAC negado no Python** (se o winget chegar a pedir): registrar o que acontece — o Mark LVII fica inutilizável até Python ser instalado; o Hub não deve travar.
- [ ] Em qualquer falha acima: confirmar que `first-run-complete.flag` **não** foi criada e que `kolnd-hub.log` contém o que houver (note: a sequência de etapas em si não é logada em arquivo — ver tabela de logs).

## E. UAC do Kloud Games — aceitar e negar

Restaurar o snapshot antes de cada cenário (ou desinstalar o Kloud Games entre eles).

- [ ] **UAC aceito** (caminho feliz da seção C): resultado já registrado.
- [ ] **UAC negado**: negar o prompt → a etapa kloud-games fica vermelha com mensagem do tipo `Permissão negada (UAC)…`; o fluxo **continua** (etapas programs/finalize) e termina com sucesso; a flag **é** gravada; o Hub abre normalmente.
- [ ] O botão **"Tentar novamente"** aparece na linha do Kloud Games; ao clicar, **só** a etapa do Kloud Games reexecuta (check/python/programs não são refeitos).
- [ ] Após negar o UAC: `<instalação>\resources\programs\kloud-games\KLOUD_GAMES.msi` continua disponível; `msiexec /i "<instalação>\resources\programs\kloud-games\KLOUD_GAMES.msi"` como administrador instala depois (assistente visível).
- [ ] `kloud-games-install.log` registra `Motivo: permissão negada (UAC cancelado pelo usuário).`
- [ ] **Assistente cancelado** (aceitar UAC, depois fechar o assistente ou clicar Cancelar): etapa falha com `Instalação do Kloud Games cancelada no assistente…` (código 1602); não-fatal; registrar.
- [ ] Se disponível na VM, **política restritiva** (AppLocker / bloqueio de `powershell.exe -Verb RunAs`): registrar resultado ou marcar explicitamente como "não testado".

## F. Rede atrás de proxy (se aplicável)

- [ ] Repetir a seção C com a VM atrás de proxy corporativa. O winget usa as configurações de proxy do sistema/WinHTTP.
- [ ] Registrar: funcionou / falhou com a mensagem X / não testado. Se falhar, o cenário D (winget falha) cobre o comportamento do Hub.

## G. Programas e Mark LVII (bundle real)

- [ ] Se o instalador foi gerado **com** o bundle real (`build-mark-lvii.ps1` + `npm run package`, ou `build-installer.bat`): etapa programs mostra `Mark LVII (JARVIS): OK (<instalação>\resources\programs\MarkLVII)`.
- [ ] Abrir o Mark LVII a partir do Hub → inicia (`MarkLVII.exe`); a chave de API e a memória são gravadas ao lado do executável (`resources\programs\MarkLVII\config` e `...\memory`).
- [ ] Se o instalador foi gerado **sem** o bundle (CI/placeholder): `Mark LVII (JARVIS): FALHOU` no relatório; se o Kloud Games também não estiver implantado/instalado, a etapa programs é **fatal** e a 1ª execução termina em erro — registrar que o instalador testado é placeholder, não um release válido.

## H. Logs a observar durante toda a validação

- [ ] `%APPDATA%\kolnd-hub\logs\kolnd-hub.log` — linhas de `kloud-games` e `programsDeployer`; confirmar que não há `[CRASH]`.
- [ ] `%APPDATA%\kolnd-hub\logs\kloud-games-install.log` — fluxo completo do MSI (ver seção C/E).
- [ ] `%APPDATA%\kolnd-hub\logs\kloud-games-uninstall.log` — só ao testar desinstalação.
- [ ] `%APPDATA%\kolnd-hub\first-run-complete.flag`, `config.json`, `kloud-games.paths.json` — existência e conteúdo após cada cenário.
- [ ] Copiar os logs relevantes para junto do registro do resultado (ou anexar à task 02-2.2) antes de reverter o snapshot.

## I. Desinstalação preservando `%APPDATA%\kolnd-hub`

Detalhe completo e fonte única: [`RELEASE.md`](RELEASE.md) — **Passo 5 — Verificar desinstalação** — e seção "Checklist de release: verificação da desinstalação" do README raiz. Resumo mínimo a executar na mesma VM, com o release instalado e a 1ª execução concluída:

- [ ] Confirmar que `%APPDATA%\kolnd-hub` está populado **antes**: `config.json`, `first-run-complete.flag`, `logs\kolnd-hub.log`, `kloud-games.paths.json` e — se houver — `game-icons\`.
- [ ] Desinstalar (botão do Hub em "Zona de perigo" **ou** Windows → Aplicativos). Se pelo Hub: ele desinstala o Kloud Games antes (UAC) e pergunta como seguir se falhar; o desinstalador NSIS abre e o Hub se encerra.
- [ ] Confirmar **preservados** em `%APPDATA%\kolnd-hub`: `config.json`, `first-run-complete.flag`, `logs\` (e o que mais existia).
- [ ] Confirmar **removido**: o diretório de instalação inteiro — `%LOCALAPPDATA%\Programs\Kolnd Hub`, incluindo `resources\programs\MarkLVII\` (com a chave de API e a memória que o Mark LVII grava ao lado do exe). Essa perda é esperada; não há espelho em `%APPDATA%`.
- [ ] Se a opção "Apagar também meus dados e configurações" foi usada, o `%APPDATA%\kolnd-hub` **deve** sumir — registrar separadamente (é irreversível e não é o caminho padrão).
- [ ] Códigos `3010`/`1641` do msiexec = reinício necessário, sucesso com aviso.

## J. Registro do resultado

- [ ] Registrar, em local durável (task `gerente/tasks/2.0/02-2.2-…md`, release notes ou issue): **data, versão testada, configuração da VM (OS, conta, rede/proxy), origem do instalador, resultado por cenário (C–I), logs anexados**.
- [ ] Qualquer cenário falho = **no-go** para release (ou aceitação explícita e escrita do risco pelo usuário no go/no-go).
- [ ] Não marcar a task 02-2.2 como concluída sem a execução registrada.

### Registro de execuções

| Data       | Versão | VM / OS / conta | Instalador (bundle real?) | Resultado (cenários) | Quem executou |
| ---------- | ------ | --------------- | ------------------------- | -------------------- | ------------- |
| _pendente_ |        |                 |                           |                      |               |

---

## Notas e pegadinhas (ler antes de abrir issue)

- **Etapa `programs` fatal com 0 implantados**: em builds sem Mark LVII e sem MSI (CI/placeholder), a 1ª execução **sempre** termina em erro — não é regressão. Validar só com instalador gerado com os recursos reais.
- **Log da 1ª execução não vai para `kolnd-hub.log`**: o que aparece na tela some ao fechar o app. Para evidências, copie o texto da tela ou observe `kloud-games-install.log`/`kolnd-hub.log`.
- **Python não é elevado pelo código**: qualquer UAC no Python vem do winget/instalador do pacote; registrar o comportamento real em vez de assumir.
- **MSI é assistente visível** (sem `/quiet`): a instalação exige uma pessoa concluir o assistente na VM — não é automatizável por comando silencioso sem mudar o código.
- **"Tentar novamente mais tarde"** (botão em erro) não refaz nada; reabrir o app é o retry real (flag ausente ⇒ fluxo recomeça).
- **Flag dupla**: `install()` grava a flag no `main` e o renderer chama `firstRun:markComplete` no sucesso — escrita dupla idempotente, não é bug.
- **Cancelar não aborta processos filhos**: `firstRun:cancel` só é checado entre etapas.
- **Kloud Games falho ≠ 1ª execução falha**: etapa vermelha + Hub abrindo normalmente é o comportamento projetado.
