# Memory — Kolnd Hub

> Contexto rápido para o **gerente**. É a fonte de verdade, junto com os `task.md` em `gerente/tasks/`.
>
> **REGRA DE ATUALIZAÇÃO:** sempre que uma nova tarefa for finalizada, verifique se este arquivo precisa ser atualizado (caminhos, decisões, versões, estado do build/CI, estrutura do repo, bloqueios) e atualize na hora. Um `memory.md` desatualizado é pior do que nenhum.
>
> **Regras de marcação:** itens marcados com `[ATUALIZAR]` são estado vivo e DEVEM ser revisados após cada tarefa concluída.

## 1. Identidade do projeto

- **O que é:** Kolnd Hub — hub desktop central do ecossistema Kolnd. Inicia, para e monitora os programas do ecossistema, com bandeja do sistema, logs ao vivo e **Modo Big Picture** (interface em tela cheia para gamepad/TV).
- **Repositório:** `C:\Users\TiffoDi\desenv\Kolnd Hub` (git; **monorepo**; branch de desenvolvimento = **`Dev`**; o `main` é estável e **nunca recebe commits diretos**).
- **GitHub:** github.com/Gui-Kol/kolnd-hub
- **Interface do app:** pt-BR, linguagem amigável para usuário final.

## 2. Estrutura do monorepo (raiz do repo)

| Pasta / arquivo | O que é | Stack |
| --- | --- | --- |
| `kolnd-hub/` | O aplicativo Hub em si (dashboard, Configurações, bandeja, primeira execução, Big Picture) | Electron 28 + electron-vite + React 18 + TypeScript + Tailwind 3 + Framer Motion, MIT |
| `Mark-LVI/` | **Mark LVI (JARVIS)** — assistente de voz com IA (avatar holográfico, lip-sync, wake word, 50+ idiomas) | Python + PyQt6, empacotado com PyInstaller |
| `kloud-games/` | **Kloud Games** — servidor self-hosted de streaming de jogos para Moonlight (fork do Sunshine, LizardByte); vira MSI via WiX | C++ / CMake / MSYS2 (UCRT64), GPL-3.0; submódulos git de terceiros (ver `.gitmodules`); **patch obrigatório no build**: `kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch` aplicado em `third-party/moonlight-common-c` (ver `kloud-games` AGENTS.md e `kolnd-hub/scripts/build-kloud-games.ps1`) |
| `kolnd-hub-userdata-backups/` | Backups de dados de usuário do Hub (ignorado no git) | — |
| `task-big-picture.md` | Plano da tarefa Big Picture (T1–T8), novembro/2026 — formato auto-contido | — |
| `task-desinstalar.md` | Plano da tarefa Desinstalar (T1–T7), novembro/2026 — botões "Desinstalar Kloud Games" e "Desinstalar Kolnd Hub", destrutivo, confirmação obrigatória | — |
| `build-installer.bat` | Build completo em um comando (na raiz): MSYS2/WiX → MSI → `npm run package` | CMD + PowerShell |
| `.github/workflows/ci.yml` | CI (windows-latest): `npm ci` → typecheck → lint → format:check → Vitest → build → `npm run package`; recursos MarkLVI como placeholder (não commitados) | GitHub Actions |

## 3. O app Hub — fatos essenciais

- **Comandos** (em `kolnd-hub/`): `npm install` · `npm run dev` · `npm run build` · `npm run package` (gera `dist/Kolnd Hub Setup <versão>.exe`, ~360 MB) · `npm run typecheck` · `npm test` · `npm run lint` · `npm run format`
- **Config persistente:** `electron-store` em `%APPDATA%\kolnd-hub\config.json`, com schema e migrações versionadas (mais recente: **'1.4.0'** — chaves `gamepad` e `bigPicture`); migra automaticamente do `localStorage` na primeira execução; fallback `localStorage` se corrompido.
- **Primeira execução:** flag `%APPDATA%\kolnd-hub\first-run-complete.flag`; etapas: deps (Python/pip) → Python via winget (só se faltar) → MSI do Kloud Games via UAC (falha **não bloqueia**) → implantação dos programas → grava configs padrão.
- **Recursos embutidos NÃO vão para o git:** `kolnd-hub/resources/programs/MarkLVI/` e `kolnd-hub/resources/programs/kloud-games/` (MSI ~53 MB). São gerados por `kolnd-hub/scripts/build-*.ps1` e embutidos via `extraResources` (com `filter` para nunca levar segredos: `Mark-LVI/config/api_keys.json`, `config/certs/`, `config/whatsapp_web/`, `memory/`).
- **`MARK_LVI_HOME`:** o Hub define automaticamente para `%APPDATA%\kolnd-hub\mark-lvi` e semeia (copia, sem apagar) `config/` e `memory/` do bundle empacotado a cada boot. Até o Mark LVI ser reconstruído (`build-mark-lvi.ps1`), ele grava ao lado do `.exe` — use o app instalado, nunca o bundle de build.
- **Distribuição:** instalação por usuário em `%LOCALAPPDATA%\Programs\Kolnd Hub` (sem admin), mas a 1ª execução dispara 2 UAC (winget-python e MSI). Risco de falso positivo de antivírus → assinatura de código é pré-requisito prático para distribuição pública. **Validação em máquina limpa está pendente.**
- **Decisões registradas do usuário:** Playnite e SteamGridDB Manager foram **removidos** do projeto. Instalação do MSI do Kloud Games **exige UAC**. Desinstalações são destrutivas — confirmação explícita sempre.
- **Estrutura do código do Hub** (`kolnd-hub/src/`): `main/` (processo principal: janela, tray, IPC, primeira execução, instaladores, gerenciamento de processos, store), `preload/` (contextBridge, sandbox), `renderer/` (React: Dashboard, Settings, FirstRunInstall, Big Picture).

## 4. Estado de trabalho [ATUALIZAR após cada tarefa]

- **Branch atual:** `Dev` (nunca `main` diretamente).
- **Observado em 13/11/2026 (pós-verificação):** working tree limpo exceto `gerente/memory.md` (modificado) e submódulo `kloud-games/third-party/moonlight-common-c` (patch do build) — os arquivos de Big Picture citados antes como não commitados não aparecem mais no `git status --short`; confirmar com o usuário o que foi commitado.
- **Melhorias (gerente/tasks/melhorias-task.md):** análise somente-leitura **concluída** em 13/11/2026. Relatório em `gerente/tasks/melhorias-sugestoes.md`; **71 task.md individuais + `README.md` índice** em `gerente/tasks/2.0/` (ondas + plano de execução detalhado do gerente: Fases 1–6, caminho crítico até release pública). **Nenhuma execução autorizada — aguardando o usuário escolher.** Nota: o `melhorias-task.md` original sumiu da pasta `gerente/tasks/` durante o processo (causa desconhecida; recriado).
- **Observado em 13/11/2026 (após a análise):** `git status --short` passou a mostrar `main/index.ts`, `main/uninstallDetection.ts`, `main/uninstaller.ts`, `preload/*` modificados e `renderer/src/lib/uninstall.{ts,test.ts}` novos — alterações de outra sessão paralela (provável Desinstalar T6); o subagente de análise não tocou no projeto (apenas o relatório em `gerente/tasks/`, ignorado pelo git).
- **Big Picture (gerente/tasks/task-big-picture.md):** T1–T8 todas marcadas `[X]` concluídas. Não commitado — working tree sujo com: `kolnd-hub/src/main/index.ts`, `kolnd-hub/src/main/kloudGames.ts`, `kolnd-hub/src/preload/index.ts`, `kolnd-hub/src/preload/index.d.ts`, `kolnd-hub/src/renderer/src/App.tsx`, `kolnd-hub/src/renderer/src/components/BigPicture.tsx`, `kolnd-hub/src/renderer/src/components/BigPictureRail.tsx`, `kolnd-hub/README.md` modificados; `kolnd-hub/src/renderer/src/components/BigPictureTools.tsx` removido; novos testes (`games.test.ts`, `startupManager.test.ts`, `store.test.ts`, `hubConfig.test.ts`, `sfx.test.ts`) não rastreados; submódulo `kloud-games/third-party/moonlight-common-c` modificado (patch do build).
- **Desinstalar (gerente/tasks/task-desinstalar.md):** T1–T6 concluídas e **commitadas na `Dev`** (`15f6d9ab` T1–T4, `b665ad5a` T5, `7e4f9898` T6; 409 testes + 1 skip verdes, build + tsc + lint ok). **Regra do usuário: nada finalizado sem commit.** **T7 é a próxima** (README + smoke final) — última do conjunto. Ressalva: validação destrutiva real só em VM/snapshot (T6/T7); nesta máquina nada destrutivo foi executado.
- **Quota do plano Free (13/11/2026):** a sessão de subagente em background da T4 (`ses_e29438de8ffeRnVMrBgzSdWY6W`) morreu com "Free usage limit reached". A T4 foi concluída e verificada pela sessão de continuação (`ses_e2944a15effeyu5zz6yz3qUz6Z`) — arquivos revisados e tsc (node/web) ok após o erro. Subagentes futuros podem falhar se a cota gratuita estiver esgotada; a solução é conectar um provider/assinar OpenCode Go ou trocar de modelo (não configurável pelo gerente — decisão/ação do usuário).
- Antes de delegar qualquer tarefa, rode `git status --short` e evite que duas sessões toquem os mesmos arquivos (Big Picture e Desinstalar se sobrepõem em `main/` e Configurações — T3/T4/T5 do Desinstalar tocam `uninstaller.ts`, `index.ts`, preload e `Settings.tsx`).
- `gerente/` (este arquivo incluído) e `.opencode/` são **novos e ainda não commitados** — decisão pendente do usuário.

## 5. O gerente (este agente)

- **Trigger permanente (decidido em 13/11/2026):** sempre que o usuário disser **"novo GERENTE"** (ou "novo gerente" / "crie um novo gerente") no chat, criar imediatamente uma sessão de gerente nova — sem pedir confirmação. Número = `max(N) + 1` sobre as sessões `GERENTE*` existentes (ex.: `GERENTE3`). Ver também `.opencode/agents/gerente.md`, seção "Trigger phrases".
- **Criação de sessões de gerente (receita que funciona nesta máquina):**
  - CLI do app desktop (NÃO está no PATH): `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`; servidor OpenCode 2.3.0 em `http://127.0.0.1:28894`.
  - `opencode-cli api post /api/session --data '<JSON>'` cria a sessão; corpo `{"title":"GERENTE<N>","agent":"gerente","location":{"directory":"C:\\Users\\TiffoDi\\desenv\\Kolnd Hub"}}`.
  - O agente `gerente` só aparece em `/api/agent` quando a **location** é o projeto Kolnd Hub (`?location[directory]=...`); o global não o lista.
  - HTTP direto (fetch) retorna **401 Authentication required** — o CLI cuida da autenticação; não tente bater na porta à mão.
  - **PowerShell quebra os argumentos** (o JSON chega mutilado): invoque o CLI de dentro de um script Node com `spawnSync(cli, ['api','post','/api/session','--data', corpo], { windowsHide: true })`. Scripts prontos (ver temperatura): `%TEMP%\opencode\create-session2.js` (cria sessão) e `list-sessions.js` (lista com `--data` não; usa `api get "/api/session?search=<texto>"`).
  - Verificação: `api get "/api/session?search=GERENTE"` — todas as sessões GERENTE* com `agent: "gerente"` e location no repo.
- **System prompt real:** `.opencode/agents/gerente.md` (agente primário `gerente`, modo do agente = gerente). `gerente/agente-gerente.md` é apenas um ponteiro.
- **Sessões de gerente** (todas com agente primário `gerente`, diretório = raiz do repositório): título `GERENTE` · ID `ses_e2cadde8affe14em4BsHZlcjsL` · título `GERENTE1` · ID `ses_e293c88d1ffeYmZz7JSM0602xz` · título `GERENTE2` · ID `ses_e293c7bceffe4LG8oVPJYHaxir`. Criadas em 2026-11-13.
- **Pasta `gerente/`:** `agente-gerente.md` (ponteiro) · `task.md` (template de plano) · `tasks/` (um `task.md` por tarefa, ex.: `tasks/<nome>-task.md`) · `tasks/2.0/` (71 planos de melhoria, um por sugestão, + `README.md` índice — gerado em 13/11/2026, nenhuma execução autorizada) · `memory.md` (este arquivo).
- **`gerente/tasks/` está no `.gitignore` do repo — nunca commitar.** Os demais arquivos de `gerente/` e `.opencode/` são commitáveis quando o usuário decidir.
- **Ao finalizar QUALQUER tarefa:** 1) marque a tarefa como concluída no `task.md` correspondente; 2) **verifique se este `memory.md` precisa de atualização** (novos caminhos, decisões, estado de build/CI, estrutura); 3) atualize-o se necessário; 4) reporte ao usuário o que foi feito e o que mudou aqui.

## 6. Preferências e restrições do usuário

- Responder **sempre em pt-BR**; entender solicitações em pt-BR.
- **Nunca acessar dados sensíveis** (credenciais, tokens, `.env`, `Mark-LVI/config/api_keys.json`, chave de API, memória de conversas, `config/certs/`, etc.) sem permissão explícita e pedido do usuário.
- Não deletar, mover ou sobrescrever arquivos do usuário sem confirmação (salvo pedido explícito).
- Nunca commitar direto em `main`; trabalhar em `Dev` ou `feature/*`.

## 7. Como organizar o trabalho

1. Pedido não-trivial → criar/atualizar `gerente/tasks/<nome>-task.md` (copiar de `gerente/task.md`), com subtarefas, dependências e status.
2. **Uma tarefa por sessão de agente**, em ordem de dependência; paralelizar só o que for independente; checar sobreposição de arquivos/escopo **antes** de delegar.
3. Ao delegar, instrução auto-contida: objetivo, escopo, restrições, saída esperada, definição de pronto.
4. **DoD típico do Hub:** `npx tsc --noEmit -p tsconfig.node.json` e `-p tsconfig.web.json` sem novos erros · `npm run build` ok · `npm run dev` abre e a feature funciona · testes Vitest verdes · lint/prettier ok · escopo respeitado (nada fora do pedido sem perguntar) · UI em pt-BR · sem dependências novas sem justificativa.
5. Ao integrar/finalizar: checar conflitos, atualizar `task.md` e **este `memory.md`**, e dar resumo ao usuário.
