# Roadmap de Desenvolvimento — Kolnd Hub & PC Tools

> **Versão 2.0 · Novembro/2026** — reescrita com base no estado real do código em `kolnd-hub/`.
> Mantém a estrutura original (4 fases, 10 tarefas T1–T10, prompts para agente de IA), mas cada
> tarefa agora traz **dependências, arquivos-alvo reais, prompt auto-contido, critérios de aceitação verificáveis e validação**.
> O que mudou em relação à v1: prompts auto-contidos; ambiguidades registradas como decisões (P1–P7);
> ordem com dependências explícitas; armadilhas técnicas documentadas; definição de pronto global.

---

## Como usar este documento

1. **Uma tarefa por sessão de agente** (uma por vez, em ordem ou respeitando as dependências). Não envie o documento inteiro.
2. Coloque o agente na raiz do repositório (`C:\Users\TiffoDi\desenv\Kolnd Hub`) e envie: *"Leia a tarefa Tn neste arquivo e implemente exatamente o escopo descrito."*
3. O agente deve **seguir os padrões existentes do projeto** (ver "Mapa rápido do código"), não inventar arquitetura nova.
4. Depois da implementação, o agente executa a seção **Validação** da tarefa e você revisa o diff contra os **Critérios de aceitação**. Reprovou algum? Mande corrigir antes de marcar `[x]`.
5. **Branch de trabalho** (`feature/Tn-...` ou `Dev`) — nunca direto em `main` (ver README, seção de branches).

### Regras globais (definition of done de toda tarefa)
- [x] `npx tsc --noEmit -p tsconfig.node.json` **e** `npx tsc --noEmit -p tsconfig.web.json` sem novos erros
- [x] `npm run build` concluído com sucesso
- [x] `npm run dev` abre o app e a feature nova funciona no fluxo manual
- [x] Escopo respeitado (nada fora do descrito; se precisar algo fora, pergunte antes)
- [x] Interface em **pt-BR**, linguagem amigável, sem jargão técnico para o usuário final
- [x] Sem adicionar dependências novas sem justificativa explícita no PR/commit

---

## Mapa rápido do código (âncoras reais)

| Arquivo | Papel |
|---|---|
| `kolnd-hub/src/renderer/src/App.tsx` | Estado global, roteamento **por estado** (sem router): `Page` union, render condicional, `handleLaunch`, montagem do layout |
| `kolnd-hub/src/renderer/src/types.ts` | União `Page = 'dashboard' \| 'settings' \| 'inicializacao'`, `AppConfig`, `StartupItem`, etc. |
| `kolnd-hub/src/renderer/src/components/Sidebar.tsx` | `navItems` (labels das páginas) + `activeColors` por página |
| `kolnd-hub/src/renderer/src/components/Inicializacao.tsx` | Página do PC (item da sidebar com o hostname) — hoje só gerencia itens de inicialização |
| `kolnd-hub/src/renderer/src/components/Dashboard.tsx` | Página "Biblioteca" (dashboard de apps) — título interno na linha ~82 |
| `kolnd-hub/src/renderer/src/components/Layout.tsx` | Shell: title bar frameless + `<Sidebar>` + `<main>` (contagem de apps ativos) |
| `kolnd-hub/src/main/store.ts` | **Persistência canônica**: `electron-store` → `%APPDATA%/kolnd-hub/config.json`, schema ajv + migrações versionadas (`migrations: { '1.0.0', '1.1.0', ... }`); IPC `config:get/setApps/setStartupImportance/migrate`; `registerConfigIpc()` |
| `kolnd-hub/src/renderer/src/lib/appsConfig.ts` | Merge/migração puros (testáveis): store via IPC primeiro, fallback para localStorage legado (`kolnd-hub-apps`) |
| `kolnd-hub/src/main/processManager.ts` | Lançar/parar apps: `spawn(command, { cwd, shell: true, windowsHide: true })`, `tree-kill` no stop; eventos `output`/`status-change` |
| `kolnd-hub/src/main/startupManager.ts` | Listar/adicionar/remover itens de inicialização (PowerShell + registro) |
| `kolnd-hub/src/main/silentInstaller.ts` | `isWingetAvailable()`, `installPython()`, `installKloudGames()` (msiexec elevado via UAC) |
| `kolnd-hub/src/main/kloudGames.ts` | Detecção/instalação do Kloud Games; persiste `kloud-games.paths.json` |
| `kolnd-hub/src/main/firstRunInstaller.ts` + `components/FirstRunInstall.tsx` | Fluxo da 1ª execução (etapa `kloud-games` entre outras; flag em `%APPDATA%/kolnd-hub/first-run-complete.flag`) |
| `kolnd-hub/src/main/index.ts` | `ipcMain.handle(...)` — registro dos IPCs (padrão `register*Ipc()` para módulos novos, ex.: `registerConfigIpc()`) |
| `kolnd-hub/src/preload/index.ts` + `index.d.ts` | `contextBridge.exposeInMainWorld('api', …)`; tipos do `window.api` (espelhar **sempre** os dois arquivos) |
| `kolnd-hub/src/renderer/src/index.css` | Classes utilitárias: `.glass-card`, `.btn-primary`, `.input-gamer`, `.toggle-console`, `.label-panel` |
| `kolnd-hub/tailwind.config.js` | Paleta customizada (`kloud`, `nintendo`, `playstation`, `steam`, `neon`), gradientes, `shadow-glow-*` |

**Padrão IPC ponta a ponta (obrigatório seguir nos módulos novos):**

```
main (novo módulo, ex.: games.ts)
  └─ registerGamesIpc() → ipcMain.handle('games:get', …)          ← exportado, chamado em main/index.ts
preload/index.ts   → getGames: () => ipcRenderer.invoke('games:get')  ← + tipos em preload/index.d.ts
renderer           → window.api.getGames()                             ← nunca usar Node/fs no renderer
```

**Componentes e visual:** Tailwind 3 + `framer-motion` + `lucide-react`. Sem shadcn/Radix — crie componentes próprios seguindo os existentes. Novas páginas: 4 pontos de edição (união `Page` → `Sidebar.tsx` → render em `App.tsx` → IPCs/preload).

---

## Decisões registradas (premissas deste plano)

- **P1 — "Menu do PC" = a página do item da sidebar com o hostname** (rota `inicializacao`, `Inicializacao.tsx`; o cabeçalho exibe `pcName` hoje com a legenda *"Gerencie quais títulos iniciam junto com o seu PC"*). As tarefas T3–T5 transformam essa página num **hub "Manutenção do PC"** com três abas: **Inicialização** (conteúdo atual), **Atualizações** (winget) e **Limpeza** (temporários). Se preferir abas/rotas separadas, ajuste P1 antes de começar a T3.
- **P2 — T2 renomeia só os rótulos** ("Biblioteca" → "Ferramentas"). O `id` do `Page` permanece `'dashboard'` (evita churn em `App.tsx`, store e migrações). Não renomeie o membro da união.
- **P3 — Persistência de dados novos usa `electron-store`** (padrão de `store.ts`), nunca localStorage solto nem JSON novo paralelo. Isso vale para a `games` (T6), as prefs do Kloud Games (T10) e qualquer cache pequeno.
- **P4 — winget sempre sem shell e em fila sequencial** (args em array, `windowsHide: true`). Nunca `shell: true` com string interpolada. Falhas por item não cancelam a fila.
- **P5 — T2 antes de T6**: renomeia a página antiga primeiro; a nova "Biblioteca" (jogos) só nasce depois.
- **P6 — A Biblioteca de jogos é separada do dashboard** e **não** usa `ProcessManager` para lançar jogos (inflaria o contador de apps ativos do `Layout.tsx` e criaria semântica errada de "em execução"). Usar spawn direto do exe, sem rastreamento.
- **P7 — T10 não dispara na tela de 1ª execução**: o autostart do Kloud Games só é avaliado após o Hub sair da primeira execução; antes do launch, confira `kloud-games:status` para não duplicar um processo já aberto.

---

## Dependências e ordem de execução

```
T1 (Kloud Games install) ──────────────── independente (mas T10 reutiliza o fluxo)
T2 (Biblioteca→Ferramentas) ──┐
                               ├─→ T6 ─→ T7 (Steam)   → todas dependem de T6
                               │       └─→ T8 (exe)    ─┘
                               │       └─→ T9 (editar) ─┘
T3 (winget listar) ──→ T4 (upgrade em lote)
T5 (limpeza temp) ──────────────── independente
T10 (toggle autostart) ← reutiliza fluxo/launch da T1/kloudGames.ts
```

**Ordem sugerida (a mesma T1→T10, agora justificada):** T1, T2, T3, T4, T5, T6, T7, T8, T9, T10.
Nunca comece T7/T8/T9 antes de T6 estar `[x]`; T4 sempre depois de T3.

---

## Fase 1: Correções Críticas e Infraestrutura Base

### [x] T1 — Endurecer e simplificar o fluxo de instalação do Kloud Games
**Objetivo:** o MSI do Kloud Games já é instalado na 1ª execução (`silentInstaller.ts → installKloudGames()` via UAC + `msiexec /quiet`); esta tarefa elimina as etapas manuais restantes e torna o fluxo robusto, com erro claro e feedback visível.

**Dependências:** nenhuma.
**Arquivos-alvo:** `src/main/silentInstaller.ts`, `src/main/kloudGames.ts`, `src/main/firstRunInstaller.ts` (etapa `kloud-games`), `src/renderer/src/components/FirstRunInstall.tsx`, `src/main/firstRun.ts`.

**Prompt para o Agente:**
> Sua tarefa (T1) no Kolnd Hub é endurecer o fluxo de instalação do **Kloud Games**, que já existe — não crie um fluxo novo.
> Contexto: o MSI embutido (`resources/programs/kloud-games/KLOUD_GAMES.msi`) é instalado na 1ª execução por `installKloudGames()` (elevação via `Start-Process -Verb RunAs`, `msiexec /i … /quiet`); o estado persiste em `kloud-games.paths.json`; a detecção pós-instalação fica em `kloudGames.ts`; a falha **não** bloqueia a 1ª execução.
> Faça, nesta ordem:
> 1. Leia `silentInstaller.ts`, `kloudGames.ts`, `firstRunInstaller.ts` e `FirstRunInstall.tsx` para entender o fluxo completo e o formato de `kloud-games.paths.json`.
> 2. **Pular reinstalação:** antes de instalar, valide o `kloud-games.paths.json` e/ou varra `%ProgramFiles%\KLOUD_GAMES` (e `\WOW6432Node`) por `KLOUD_GAMES.exe`. Se existir instalação válida, **não** reinstale; registre `"[kloud-games] já instalado — pulando"` no log e marque a etapa como concluída.
> 3. Adicione `/norestart` ao msiexec e capture stdout/stderr num log em `%APPDATA%\kolnd-hub\logs\kloud-games-install.log`.
> 4. **Verificação pós-instalação:** após o msiexec retornar, confirme a existência real do exe (paths.json → Program Files → varredura de profundidade ≤ 3). Só então reporte sucesso na etapa. Se o exe não existir, reporte erro legível com o caminho do log.
> 5. **Erros mapeados para mensagens claras:** (a) usuário cancelou o UAC → "Permissão negada (UAC). A instalação do Kloud Games foi pulada; você pode ativá-la depois tentando de novo."; (b) MSI ausente no instalador; (c) msiexec com código ≠ 0 → inclua o código e o caminho do log.
> 6. **UI:** na etapa de Kloud Games com erro, mantenha o comportamento "não bloqueia" e garanta que o botão de tentar novamente (já existe para a 1ª execução) reexecute a instalação do Kloud Games. Não altere as outras etapas nem o layout geral.
> 7. Não modifique `markLvi*`/Mark LVI, nem `first-run-complete.flag`, nem as outras etapas.

**Critérios de aceitação:**
- [x] Máquina sem Kloud Games: etapa conclui; card do Hub consegue iniciar o jogo
- [x] UAC cancelado pelo usuário: 1ª execução segue normalmente; mensagem clara na etapa; log registra o motivo
- [x] Reabrir o app / rodar de novo com o jogo já instalado: instalação pulada (log confirma)
- [x] Simular falha do msiexec (ex.: MSI corrompido renomeado): app abre, etapa mostra erro com código + caminho do log; nada trava
- [x] `npm run build` ok; nenhuma outra etapa do fluxo de 1ª execução alterada

**Validação:** mova/apague a flag `%APPDATA%\kolnd-hub\first-run-complete.flag` para forçar a 1ª execução (faça backup de `%APPDATA%\kolnd-hub` antes, como no procedimento de "máquina limpa" já documentado em `task.md`, T-13). Observe a etapa do Kloud Games, teste os 3 cenários acima e restaure a flag.

---

### [x] T2 — Navegação: renomear "Biblioteca" para "Ferramentas"
**Objetivo:** preparar a arquitetura de menus renomeando a seção atual, sem quebrar rotas nem IDs.

**Dependências:** nenhuma.
**Arquivos-alvo:** `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/Dashboard.tsx`.

**Prompt para o Agente:**
> Sua tarefa (T2) no Kolnd Hub é renomear o item de navegação **"Biblioteca"** (o dashboard de apps) para **"Ferramentas"**. Escopo estrito:
> 1. Em `Sidebar.tsx`: no array `navItems`, o item `{ id: 'dashboard', label: 'Biblioteca', ... }` passa a exibir **"Ferramentas"**. Troque o ícone `LayoutDashboard` por `Wrench` **se** ficar visualmente coerente com os demais itens; caso contrário mantenha o ícone e justifique no commit. Não altere `activeColors` nem a posição.
> 2. Em `Dashboard.tsx` (título interno, linha ~82): troque o texto **"Biblioteca"** por **"Ferramentas"** e ajuste a descrição de apoio para refletir ferramentas (ex.: "Seus programas do ecossistema, num só lugar"). Mantenha gradientes, animações e layout intactos.
> 3. **Mantenha `id: 'dashboard'`** na união `Page` (`types.ts`). Não renomeie o membro da união.
> 4. Faça `grep -ri "Biblioteca" src/` e trate **apenas** ocorrências ligadas ao dashboard (a Biblioteca de jogos só nasce na T6 — não a crie aqui). Se encontrar "Biblioteca" em comentários/READMEs do próprio dashboard, atualize-os.
> 5. Não toque em rotas, IPC, store ou outras páginas.

**Critérios de aceitação:**
- [x] Sidebar exibe "Ferramentas" no lugar de "Biblioteca"
- [x] Dashboard exibe título coerente ("Ferramentas") sem restos de "Biblioteca" visíveis ao usuário
- [x] Nenhuma mudança funcional: navegação, atalhos e estado de página idênticos aos atuais
- [x] Build + `tsc` ok

**Validação:** `npm run dev` → abrir o app → confirmar sidebar/título; grep confirma zero ocorrências espúrias de "Biblioteca".

---

## Fase 2: Funcionalidades do Sistema (Hub "Manutenção do PC")

> **P1:** a partir da T3, a página `inicializacao` (item da sidebar com o hostname) vira um hub com três abas/seções: **Inicialização** (conteúdo atual intacto), **Atualizações** (T3/T4) e **Limpeza** (T5). O subtítulo da página passa de "Gerencie quais títulos iniciam junto com o seu PC" para algo como "Manutenção e inicialização do seu PC", e a legenda dos controles fica dentro da aba Inicialização. Use abas/segmented control com Tailwind, seguindo o estilo existente (`.glass-card`, `.btn-primary`, `activeColors`).

### [x] T3 — Backend e listagem de atualizações via Winget
**Objetivo:** executar o winget em segundo plano, parsear a saída e listar apps desatualizados na aba **Atualizações** do PC.

**Dependências:** nenhuma (mas a T4 depende dela).
**Arquivos-alvo:** novo `src/main/wingetUpdater.ts`, `src/main/index.ts`, `src/preload/index.ts` + `index.d.ts`, `src/renderer/src/components/Inicializacao.tsx` (ou novo componente `PcUpdates.tsx` incluído nela), `types.ts` se necessário.

**Prompt para o Agente:**
> Sua tarefa (T3) é implementar, no **processo main**, a leitura de apps com atualização disponível via winget, exposta por IPC e exibida na aba **Atualizações** da página do PC (rota `inicializacao`).
> Backend — novo módulo `src/main/wingetUpdater.ts` (siga o estilo de `store.ts` / `kloudGames.ts`):
> 1. `listUpgradable(): Promise<WingetUpgrade[]>` executando **`winget upgrade --accept-source-agreements --accept-package-agreements`** com `windowsHide: true` e argumentos em **array** (nunca por string de shell).
> 2. Tipo exportado: `WingetUpgrade = { name: string; id: string; currentVersion: string; availableVersion: string }`.
> 3. **Parse robusto e localizado:** primeiro tente `--output json` (detecte uma única vez se a versão instalada suporta e faça cache em memória do resultado do probe). Se não houver suporte a JSON, faça parse posicional: localizar a linha de cabeçalho por palavras-chave em **pt-BR e inglês** (`Nome|Name`, `Id|ID|Identificador`, `Versão|Version`, `Disponível|Available`, `Origem|Source`), pegar as posições das colunas e extrair as linhas de dados correspondentes. Ignore linhas de ruído (ex.: "Carregando…", separadores, linhas em branco, avisos). Se a saída contiver "Nenhuma atualização disponível"/"No installed package found" ou equivalente, retorne `[]`. Se o parse falhar por completo, retorne erro com as primeiras 25 linhas do stdout em `rawLog`.
> 4. Reutilize `isWingetAvailable()` de `silentInstaller.ts` (extraia para módulo compartilhado ou importe — **não** duplique a lógica).
> 5. IPC: função `registerWingetIpc()` registrando `winget:list-upgrades` → retorna `{ ok: boolean; items?: WingetUpgrade[]; error?: string; rawLog?: string }`. Chame `registerWingetIpc()` em `src/main/index.ts` junto aos demais registros.
> 6. Preload: exponha `listUpgradableUpdates()` em `preload/index.ts` (com tipos em `preload/index.d.ts`), seguindo exatamente o padrão dos outros métodos (`ipcRenderer.invoke('winget:list-upgrades')`).
> Renderer — aba "Atualizações" dentro da página do PC:
> 7. Estruture a página com abas ("Inicialização" / "Atualizações" / "Limpeza" — esta última pode ficar vazia nesta tarefa) ou seções colapsáveis; atualize o subtítulo para refletir "manutenção do PC".
> 8. Estados da aba Atualizações: carregando (spinner) / erro / vazio ("Nenhuma atualização disponível 🎉") / resultado (contador "N atualização(ões) disponível(is)" + lista com **Nome, ID, versão atual → disponível**). Botão **"Verificar novamente"** para recarregar. Se o winget não existir, mostre orientação para instalar/atualizar o App Installer.
> 9. Lista rolável com as mesmas classes de card da página atual; nada de jargão técnico cru para o usuário (o ID pode aparecer em fonte menor/monospace).
> 10. Não altere a aba/seção de Inicialização além do necessário para criar a navegação por abas.

**Critérios de aceitação:**
- [x] Sem winget → mensagem orientando o App Installer (sem crash)
- [x] Com updates pendentes → lista correta (confira contra `winget upgrade` no terminal)
- [x] Sem updates → estado "Nenhuma atualização disponível"
- [x] IDs com pontos/espaços (`Microsoft.NET.Sdk`) extraídos corretamente
- [x] Falha total de parse → erro amigável com `rawLog` exibido de forma expansível/colapsável
- [x] Build + `tsc` ok; conteúdo da aba Inicialização inalterado

**Validação:** `npm run dev` → página do PC → aba Atualizações; comparar a lista com a saída de `winget upgrade` no terminal; testar com winget ausente (renomeie temporariamente no PATH, se aplicável) e restaurar.

---

### [x] T4 — Seleção em lote e execução do `winget upgrade`
**Objetivo:** marcar múltiplos apps e atualizá-los sequencialmente, com status em tempo real.

**Dependências:** T3 concluída e `[x]`.
**Arquivos-alvo:** `src/main/wingetUpdater.ts`, `src/main/index.ts`, preload ambos, aba Atualizações (`Inicializacao.tsx` ou `PcUpdates.tsx`).

**Prompt para o Agente:**
> Dando continuidade à T3, sua tarefa (T4) é implementar a seleção em lote e a execução das atualizações na aba **Atualizações**.
> 1. **Seleção:** checkbox por linha + "Selecionar todos" no cabeçalho, com estado **indeterminado** quando parte da seleção está marcada. Botão primário **"Atualizar selecionados (N)"**, desabilitado com N = 0 e durante a execução.
> 2. **Fila sequencial** (nunca paralela — o winget disputa locks de instalador/fonte), orquestrada pelo renderer chamando o IPC um app por vez:
>    - Novo IPC `winget:upgrade-one` (`{ id: string }` → `{ ok: boolean; exitCode: number | null; log: string }`): executa `winget upgrade --id "<id>" --exact --accept-package-agreements --accept-source-agreements` com args em array e `windowsHide: true`; capture a saída (últimas ~50 linhas) para exibir como detalhe.
>    - Novo IPC `winget:kill-upgrade` para interromper o processo em curso (use a estratégia já adotada no projeto com `tree-kill`, como em `processManager.ts`).
>    - **Não** use `shell: true` e **não** passe o ID interpolado em string de comando.
> 3. **Status por item em tempo real:** `aguardando…` → `atualizando…` → `concluído ✓` (exit 0) ou `erro ✗` (exit ≠ 0; tooltip/detalhe expansível com o código e as últimas linhas do log). Contador global "x/y concluídos" no topo da lista.
> 4. **Cancelar fila:** botão "Cancelar" durante a execução → chama `winget:kill-upgrade`, marca o item atual como "cancelado" e os demais pendentes permanecem sem executar.
> 5. **Erros por item não abortam a fila** — registre o erro daquele app e prossiga.
> 6. **Fim da fila:** toast/banner de resumo ("X concluídos, Y com erro") e recarregue a lista automaticamente (`window.api.listUpgradableUpdates()` de novo); itens que falharam e continuam desatualizados reaparecem.
> 7. Upgrades que exigem elevação/administração falharão por item com a mensagem do winget — exiba essa mensagem no detalhe do item (não tente elevar o Hub inteiro).
> 8. Mantenha os mesmos padrões visuais da aba (cards, `.btn-primary`, cores de status `neon/kloud` já existentes).

**Critérios de aceitação:**
- [x] Selecionar/Desmarcar individual e "Selecionar todos" (inclui indeterminado) funcionam
- [x] Fila executa **sequencialmente** (comprovar com ≥ 2 apps ou via logs)
- [x] Um item falhando não impede os demais; erro mostra código e log expansível
- [x] "Cancelar" interrompe o item em curso e impede os próximos
- [x] Ao final, lista é recarregada e reflete o estado real
- [x] Build + `tsc` ok

**Validação:** testar com um app desatualizado de verdade (ou mockando o IPC no devtools); simular falha forçando `--id` inexistente e conferindo a mensagem; cancelar no meio de uma fila de 2+ itens.

---

### [x] T5 — Limpeza de arquivos temporários do sistema
**Objetivo:** ação rápida que remove conteúdo seguro das pastas temporárias e reporta o espaço liberado.

**Dependências:** nenhuma (usa a navegação por abas criada na T3; se T3 ainda não foi feita, crie a aba "Limpeza" vazia na mesma estrutura).
**Arquivos-alvo:** novo `src/main/tempCleaner.ts`, `src/main/index.ts`, preload ambos, aba "Limpeza" (`Inicializacao.tsx` ou `PcCleanup.tsx`).

**Prompt para o Agente:**
> Sua tarefa (T5) é criar a aba/seção **Limpeza** na página do PC, com o botão **"Limpar Arquivos Temporários"**.
> Backend — novo módulo `src/main/tempCleaner.ts`:
> 1. `cleanTempFiles(): Promise<CleanResult>` varrendo **apenas**: `%TEMP%` (= `os.tmpdir()`), `%LOCALAPPDATA%\Temp` (deduplicar se for o mesmo caminho) e `C:\Windows\Temp`. **Nenhuma outra pasta.** O retorno é `CleanResult = { ok: boolean; filesRemoved: number; bytesFreed: number; skippedLocked: number; errors: number }`.
> 2. Apague somente o **conteúdo** das pastas (mantenha as pastas-raiz). Ignore silenciosamente arquivos **em uso** (EPERM/EACCES/EBUSY) e trate cada arquivo individualmente: conte `bytesFreed` via `stat` antes de remover; `skippedLocked++` em arquivos ignorados; `errors++` em falhas inesperadas (não abortar a varredura).
> 3. **Conservadorismo:** remova apenas arquivos com mais de **24 h** (baseado no `mtime`/`ctime`); pastas vazias antigas podem ser removidas ao final; ignore symlinks/reparse points (use `withFileTypes` e pule `isSymbolicLink()`) para não seguir links para fora das pastas-alvo.
> 4. Nunca toque em `C:\Windows\SoftwareDistribution`, registro, Prefetch, downloads ou pastas de apps — se ficar em dúvida sobre um caminho, **não apague**.
> 5. IPC `system:clean-temp` + preload `cleanTempFiles()`; o renderer **sempre** pede confirmação antes (modal) explicando que arquivos em uso serão ignorados e que nada fora de pastas temporárias será tocado.
> Renderer — aba "Limpeza":
> 6. Botão primário `.btn-primary`; ao clicar: modal de confirmação → estado "Limpando… isso pode levar alguns segundos" (spinner + botão desabilitado) → resultado: **"✅ N arquivos removidos · X liberados · Y ignorados (em uso/sem permissão)"** com X formatado em MB/GB.
> 7. Trate falha global (ex.: tudo sem permissão) com mensagem amigável; nunca mostre stack trace.
> 8. Opcional, só se trivial: exibir também os caminhos varridos em fonte pequena.

**Critérios de aceitação:**
- [x] Primeira execução remove volume mensurável de temporários; segunda execução remove quase nada (idempotente na prática)
- [x] Arquivo aberto/em uso é ignorado sem crash nem bloqueio do app
- [x] Modal de confirmação precedido de qualquer exclusão
- [x] Resultado exibido com N arquivos, MB/GB liberados e itens ignorados
- [x] Nenhuma outra pasta fora das três listadas foi alterada (conferir timestamps/conteúdo)
- [x] Build + `tsc` ok

**Validação:** meça o tamanho de `%TEMP%` antes/depois (Explorer ou `dir /s`); teste com um arquivo `.txt` aberto e bloqueado; rode a limpeza duas vezes seguidas e compare os dois relatórios.

---

## Fase 3: Nova Biblioteca de Jogos (Kolnd Hub)

### [x] T6 — Estrutura da nova aba "Biblioteca" e persistência de jogos
**Objetivo:** criar a página Biblioteca (exclusiva de jogos), o item na sidebar e o schema persistente de jogos no `electron-store`.

**Dependências:** T2 (para o nome "Ferramentas" já estar livre de conflitos).
**Arquivos-alvo:** `src/main/store.ts` (schema + migração), novo `src/main/games.ts` (IPC), `src/main/index.ts`, preload ambos, `src/renderer/src/types.ts`, `Sidebar.tsx`, `App.tsx`, novo `components/Biblioteca.tsx`, `index.d.ts` do renderer se necessário.

**Prompt para o Agente:**
> Sua tarefa (T6) é criar no Kolnd Hub a nova página **"Biblioteca"**, dedicada exclusivamente a jogos instalados no PC, e a persistência local dos jogos. Esta tarefa mexe em 4 pontos de navegação + schema — siga o checklist à risca.
> Persistência (electron-store; **não** use localStorage nem JSON solto):
> 1. Em `src/main/store.ts`, adicione ao `HubStoreSchema` e ao `schema` a chave `games`: `{ type: 'array', default: [], items: { type:'object', required:['id','name','exePath','origin','addedAt'], properties: { id:{type:'string',minLength:1}, name:{type:'string',minLength:1}, exePath:{type:'string',minLength:1}, iconPath:{type:['string','null']}, origin:{enum:['steam','custom']}, steamAppId:{type:'number'}, addedAt:{type:'string'} } } }`. Adicione a migração versionada `'1.2.0'` garantindo o default (padrão já existente no arquivo). **Não** quebre as migrações `'1.0.0'`/`'1.1.0'`.
> 2. Adicione `normalizeGame()` / `normalizeGames()` no estilo de `normalizeAppConfig()` (coerção de tipos; dedupe por `id` **e** por `steamAppId`/`exePath`; descarte entradas inválidas — são dezenas de jogos no máximo, sem preocupação de performance).
> 3. Novo módulo `src/main/games.ts` com `registerGamesIpc()` registrando: `games:get` (retorna `Game[]`), `games:add`, `games:update` (patch parcial por `id`), `games:remove` (apaga também o ícone cacheado em `game-icons/`, se houver), `games:launch`, `games:get-icon` (retorna `dataURL` do PNG em `%APPDATA%/kolnd-hub/game-icons/<id>.png`, ou `null` se não existir). Chame `registerGamesIpc()` em `main/index.ts`.
> 4. **`games:launch`: spawn direto** do exe (`detached: true`, `windowsHide: false`, `unref()`, `cwd = dirname(exePath)`). **Não** reutilize `ProcessManager` (`app:launch`): isso inflaria o contador de apps ativos do `Layout.tsx` e daria a jogos semântica de "em execução gerenciada", que não queremos. Retorne `{ ok: boolean; error?: string }`.
> 5. Preload + `index.d.ts` (espelhar os dois): `getGames()`, `addGame(game)`, `updateGame(id, patch)`, `removeGame(id)`, `launchGame(id)`, `getGameIcon(id)`.
> Navegação — os 4 pontos:
> 6. `types.ts`: união `Page` passa a `'dashboard' | 'settings' | 'inicializacao' | 'biblioteca'`.
> 7. `Sidebar.tsx`: novo `navItems` `{ id: 'biblioteca', label: 'Biblioteca', icon: Gamepad2 }` (lucide), posição **antes** de Configurações, e entrada correspondente em `activeColors` (cor distinta, ex.: `playstation`/`steam`).
> 8. `App.tsx`: `currentPage === 'biblioteca' ? <Biblioteca … /> : …` com o padrão de `ErrorBoundary` usado na página do PC.
> 9. Novo `components/Biblioteca.tsx`: grade responsiva de cards (ícone/capa + nome), clique no card → `window.api.launchGame(id)`. Botão principal **"Adicionar Games"** no topo abrindo um dropdown/menu com as opções **"Importar jogos da Steam"** e **"Jogo Personalizado"** (nesta tarefa, os dois itens existem e respondem com um aviso "Disponível na próxima atualização" — os handlers reais chegam nas T7/T8).
> 10. Card: capa via `window.api.getGameIcon(id)` (cache local em estado do componente); fallback visual 🎮/Gamepad2 quando não houver ícone. Reserve o canto superior direito para o botão de **edição** (T9) — exiba-o, mas desabilitado, com tooltip "Editar (em breve)". Ícone de lápis é aceitável.
> 11. Estado vazio: "Sua biblioteca está vazia — clique em Adicionar Games para começar" + contador no cabeçalho ("N jogos").
> 12. Não implemente importação Steam nem file picker aqui. Não faça merge desta página com o dashboard.

**Critérios de aceitação:**
- [x] Item "Biblioteca" na sidebar, navegação ida e volta sem quebrar outras páginas
- [x] Adicionar manualmente (via devtools/mock ou inserção direta no store) e ver o card; fechar e reabrir o app → o jogo **continua** salvo (persistência real)
- [x] Clique no card lança o exe (jogo abre, Hub não quebra, contador do `Layout` **não** muda)
- [x] `?first-run=1` continua abrindo a 1ª execução; dashboard/Ferramentas inalterados
- [x] Build + `tsc` (node e web) ok

**Validação:** `npm run dev`; usar devtools para `window.api.addGame({...})` com um `.exe` válido qualquer e conferir o ciclo adicionar → fechar → abrir → jogo listado.

---

### [x] T7 — Importação automática de jogos da Steam
**Objetivo:** detectar jogos Steam instalados e adicioná-los à Biblioteca automaticamente.

**Dependências:** T6 concluída e `[x]`.
**Arquivos-alvo:** novo `src/main/steamScanner.ts`, `src/main/games.ts`, `src/main/index.ts`, preload ambos, `Biblioteca.tsx` (item do menu "Adicionar Games" + modal de progresso), `store.ts` (se faltar `steamAppId` — já vem da T6).

**Prompt para o Agente:**
> Dando continuidade à T6, sua tarefa (T7) é implementar a opção **"Importar jogos da Steam"** do menu "Adicionar Games".
> Backend — novo módulo `src/main/steamScanner.ts`:
> 1. **Localizar a Steam** (nesta ordem): (a) `reg query "HKCU\Software\Valve\Steam" /v SteamPath` (parse da linha `SteamPath    REG_SZ    <valor>`); (b) `reg query "HKLM\SOFTWARE\WOW6432Node\Valve\Steam" /v InstallPath`; (c) caminhos padrão `C:\Program Files (x86)\Steam` e `C:\Program Files\Steam`. Se nenhum válido existir, retorne erro claro: "Steam não detectada. Verifique se ela está instalada."
> 2. **Ler `libraryfolders.vdf`** em `<steam>\steamapps\libraryfolders.vdf` (e nos `steamapps` das demais bibliotecas declaradas): extraia caminhos de bibliotecas com o regex `/"path"\s+"([^"]+)"/g` (formato novo) e, como fallback, chaves numéricas com caminho bruto (formato legado). **Desescape** `\\` → `\`. Inclua a raiz da Steam como biblioteca. Deduplique.
> 3. Em cada `<biblioteca>\steamapps\`, varra `appmanifest_*.acf` e extraia por regex: `/"appid"\s+"(\d+)"/`, `/"name"\s+"([^"]+)"/`, `/"installdir"\s+"([^"]+)"/`. Ignore entradas inválidas.
> 4. **Filtrar ferramentas/redistribuíveis** (não são jogos): descarte por nome (case-insensitive): `proton`, `steamworks common redistributables`, `steam linux runtime`, `steam demo`, `easy anticheat`. Também descarte appIDs utilitários conhecidos se aparecerem, e apps sem `installdir`.
> 5. **Localizar o executável** em `<biblioteca>\steamapps\common\<installdir>` (varredura com profundidade ≤ 2; **não siga symlinks**): filtre `*.exe` excluindo `unins*`, `*setup*`, `*redist*`, `vc_redist*`, `unitycrashhandler*`, `crashhandler*`, `prereq*`, `ueprereq*`. Escolha: (a) exe cujo nome normalizado (minúsculas, só alfanumérico) contenha o nome da pasta de instalação normalizado; senão (b) o `*.exe` de **maior tamanho**; senão (c) o primeiro encontrado; senão → contabilize como "sem executável localizado".
> 6. **Ícone:** reutilize a extração da T8 (`app.getFileIcon(exePath, { size: 'large' })`) e grave em `userData\game-icons\steam_<appid>.png`; falha → `iconPath: null`.
> 7. **Dedupe e persistência:** para cada jogo candidato, se já existir em `games` com o mesmo `steamAppId`, pule; grave os novos via `addGame` com `{ id: 'steam-<appid>-<hash>', origin: 'steam', steamAppId, addedAt: now }` (id determinístico → reimportar não duplica).
> 8. Retorne um relatório: `{ ok, imported, alreadyInLibrary, ignoredTools, noExe, errors[] }` exibido ao usuário.
> 9. IPC `steam:import` (timeout generoso; pode demorar alguns segundos) + preload `importSteamGames()`. **Não** bloqueie a UI com I/O síncrono congelado — o IPC async já resolve, mas mostre estado "Importando jogos da Steam…".
> Renderer:
> 10. Menu "Adicionar Games" → item habilitado: abre modal/overlay "Importando jogos da Steam…" (spinner) → ao concluir, modal-resumo: "**N** jogos importados · **A** já estavam na biblioteca · **I** itens ignorados · **E** erros" com botão Fechar; lista recarrega automaticamente.
> 11. Não abra janelas de console visíveis em nenhuma etapa (`windowsHide` / `execFile` sem shell).

**Critérios de aceitação:**
- [x] Steam detectada → importação adiciona os jogos esperados; grade atualiza sem reiniciar
- [x] Reimportar não duplica (entradas com `steamAppId` reconhecido são puladas)
- [x] Ferramentas Steam (Proton, Redistributables, Linux Runtime) ficam de fora
- [x] Steam não instalada/detectável → erro claro, sem quebrar a página
- [x] Jogos sem exe localizável são contabilizados em "sem executável", sem travar o restante
- [x] Build + `tsc` ok

**Validação:** executar a importação na máquina dev (Steam presente) e conferir: contagem total vs. `libraryfolders`/`appmanifest_*.acf` manuais; rodar duas vezes e verificar que `alreadyInLibrary` = total importado da primeira vez; desconectar/renomear a Steam e conferir a mensagem de erro.

---

### [x] T8 — Adição de Jogo Personalizado via Seletor de Arquivos (.exe)
**Objetivo:** o usuário escolhe manualmente qualquer `.exe` e ele entra na Biblioteca formatado.

**Dependências:** T6 concluída e `[x]`.
**Arquivos-alvo:** `src/main/games.ts` (extração de ícone), `src/main/index.ts` ou reutilizar `dialog:pick-path` (já filtra `*.exe` no modo `file`), preload se necessário, `Biblioteca.tsx`.

**Prompt para o Agente:**
> Dando continuidade à T6, sua tarefa (T8) é implementar a opção **"Jogo Personalizado"** do menu "Adicionar Games".
> 1. Ao clicar, abra o seletor de arquivos nativo filtrado para executáveis. **Reutilize o IPC existente `dialog:pick-path`** com `mode: 'file'` (já filtra `*.exe` e abre na pasta do caminho atual). Só ajuste o `title` do diálogo para algo como "Selecione o executável do jogo" se fizer sentido — mudanças mínimas.
> 2. Assim que o usuário escolher o `.exe`:
>    - **Nome:** derive do nome do arquivo sem extensão; substitua `_`, `-`, `.` e múltiplos espaços por um único espaço; faça trim; aplique capitalização por palavra (mantenha siglas conhecidas quando possível, ex.: `GTA V` fica "GTA V") e permita acentos; remova sufixos irrelevantes comuns (`_x64`, `-Win64-Shipping` etc. são aceitos manter — priorize simplicidade previsível; documente a heurística no código).
>    - **Ícone:** extraia o ícone embutido com `app.getFileIcon(exePath, { size: 'large' })`; se válido, grave como PNG em `%APPDATA%/kolnd-hub/game-icons/custom_<hash>.png` e guarde o caminho; senão `iconPath: null` (a grade usa o fallback 🎮).
> 3. Monte o jogo `{ id: 'custom-<hash>', name, exePath, iconPath, origin: 'custom', addedAt: now }` e salve via `addGame`. A grade da Biblioteca atualiza imediatamente (otimista ou recarregando de `games:get`) e um toast confirma: "Jogo adicionado à sua biblioteca: <nome>".
> 4. O caminho gravado deve ser o absoluto selecionado; não copie o exe.
> 5. Cancelar o diálogo não faz nada (sem erro, sem toast).

**Critérios de aceitação:**
- [x] Fluxo completo: clique → escolher `.exe` → card aparece na grade com nome formatado e ícone (ou fallback)
- [x] Jogo persistido e presente após reiniciar o app
- [x] Cancelar o seletor não gera efeito colateral
- [x] Ícone extraído aparece na grade (verifique num exe conhecido com ícone)
- [x] Build + `tsc` ok

**Validação:** adicionar 2–3 exes reais distintos (um com ícone customizado, um sem); conferir nome formatado; fechar/abrir e verificar persistência.

---

### [x] T9 — Edição de jogos na Biblioteca (nome, ícone, .exe e remoção)
**Objetivo:** customizar metadados e caminhos de qualquer jogo cadastrado.

**Dependências:** T6 concluída. (Funciona de forma independente de T7/T8, mas é para eles que a edição mais importa.)
**Arquivos-alvo:** `Biblioteca.tsx` (modal de edição + botão/lápis habilitado), `src/main/games.ts` (`games:update`, `games:pick-icon`, remoção de ícone cacheado), preload ambos, `index.d.ts`.

**Prompt para o Agente:**
> Sua tarefa (T9) é habilitar a edição de jogos na **Biblioteca** do Kolnd Hub.
> 1. Em cada card, o botão de edição (lápis, canto superior direito) abre o modal **"Editar Game"**.
> 2. Campos do modal:
>    - **Nome do jogo** — campo de texto pré-preenchido (obrigatório; desabilitar salvar se vazio).
>    - **Executável** — caminho atual em fonte pequena/mono; botão **"Alterar…"** abre o seletor filtrado para `.exe` (reutilize `dialog:pick-path` `mode:'file'`); ao trocar, atualize também o `cwd` implícito do lançamento (não é exibido).
>    - **Ícone/capa** — botão **"Escolher imagem…"** abrindo seletor nativo filtrado para `png, jpg, jpeg, webp` (extensões que o `nativeImage` decodifica de forma confiável — **não** aceite `.ico`: se o usuário escolher ICO, mostre aviso "formato não suportado, use PNG/JPG/WebP"). Copie a imagem para `userData/game-icons/<id>.<ext>` e atualize `iconPath`. Inclua também **"Restaurar ícone do executável"** quando o `.exe` atual tiver ícone extraível.
>    - **Remover jogo** — botão secundário/destrutivo com confirmação em duas etapas ("Tem certeza?" + Nome), chamando `games:remove` (que também apaga o ícone cacheado).
> 3. **Salvar** grava via `games:update` (patch por id); o card reflete as mudanças imediatamente; toast "Alterações salvas". Fechar sem salvar descarta alterações (exceto troca de ícone/exe, que você pode pré-visualizar, mas só persista no Salvar — escolha e documente no código; o mais simples é pré-visualizar e persistir só no Salvar).
> 4. Se o exe configurado não existir mais no disco, exiba no card um selo discreto ".exe não encontrado" com atalho para o modal de edição (o jogo permanece na biblioteca até ser removido).
> 5. Não altere o fluxo de adição (T7/T8) além do compartilhamento dos helpers de seleção de arquivo/ícone.

**Critérios de aceitação:**
- [x] Editar nome → card atualiza na hora; após restart, mantém o novo nome
- [x] Trocar o executável → clique no card lança o novo exe
- [x] Trocar a imagem → nova capa visível na grade; imagem inválida/ICO → aviso, sem gravar
- [x] Remover com confirmação → card some; ícone cacheado apagado; restart não traz o jogo de volta
- [x] Exe movido/apagado do disco → selo ".exe não encontrado" no card, app estável
- [x] Build + `tsc` ok

**Validação:** exercitar as quatro edições num jogo existente; remover e reinserir um jogo; apagar o exe de um jogo e conferir o selo.

---

## Fase 4: Configurações e Automação

### [ ] T10 — Preferência para iniciar o Kloud Games junto com o Kolnd Hub
**Objetivo:** toggle persistente que dispara o Kloud Games na inicialização do Hub.

**Dependências:** recomendado após T1 (reutiliza o fluxo de launch); não a bloqueia.
**Arquivos-alvo:** `src/main/store.ts` (chave de pref), `src/main/index.ts`, `src/main/kloudGames.ts` (status), preload ambos, `src/renderer/src/App.tsx` (efeito de montagem), `src/renderer/src/components/Settings.tsx` (toggle), `index.css` (`.toggle-console` já existe).

**Prompt para o Agente:**
> Sua tarefa (T10) é adicionar à tela de **Configurações** do Kolnd Hub a opção **"Iniciar Kloud Games junto com o Kolnd Hub"**.
> Persistência (electron-store):
> 1. Em `store.ts`, adicione ao schema e ao `HubStoreSchema` a chave booleana `launchKloudOnStart` com default `false` (migração `'1.2.0'` compartilhada com a T6, ou `'1.3.0'` se a T6 já tiver consumido — mantenha o padrão de migrações versionadas do arquivo). Exponha IPC `prefs:get` / `prefs:set` (ou estenda `config:get/setApps` com uma chave de topo, preferindo um IPC próprio mínimo para não acoplar).
> 2. Preload + `index.d.ts`: `getLaunchKloudOnStart()` / `setLaunchKloudOnStart(value)`.
> Configurações:
> 3. Em `Settings.tsx`, nova seção **"Inicialização"** (ou "Ao abrir o Hub") com o rótulo **"Iniciar Kloud Games junto com o Kolnd Hub"** e descrição curta (ex.: "O Hub abre o Kloud Games em segundo plano sempre que for iniciado"). Use o padrão de switch existente (`.toggle-console` em `index.css` / componente equivalente já usado no projeto) e deixe o valor inicial refletindo o store; mostre mini-feedback "Salvo" ao alternar.
> Inicialização do Hub:
> 4. Em `App.tsx`, **após** a tela de carregamento e **somente quando não estiver em `?first-run=1`**, leia a pref uma vez na montagem: se `true`, consulte `kloud-games:status`; se o jogo **não** estiver em execução, chame `kloud-games:launch` (o lançamento é não-bloqueante e silencioso — o jogo abre na janela normal dele, como no padrão do app). Se já estiver em execução, não faça nada.
> 5. Não chame o launch durante a 1ª execução; não chame duas vezes em StrictMode (proteja com `useRef`/guarda de efeito única).
> 6. Se o launch falhar, registre no console do renderer e mostre um toast discreto (não bloqueie o Hub).
> 7. Não altere o comportamento de "Sair", tray ou da instalação em 1ª execução.

**Critérios de aceitação:**
- [ ] Toggle em Configurações persiste entre reinícios (true/false)
- [ ] Com toggle ligado: abrir o Hub (fora da 1ª execução) inicia o Kloud Games automaticamente, uma única vez
- [ ] Com toggle ligado e o jogo já aberto: Hub não abre segunda instância
- [ ] Com toggle ligado: tela de 1ª execução não dispara o jogo
- [ ] Com toggle desligado: nada acontece ao abrir o Hub
- [ ] Build + `tsc` ok

**Validação:** ligar o toggle → fechar tudo → abrir o Hub → confirmar processo `KLOUD_GAMES.exe` (Gerenciador de Tarefas); repetir com o jogo já aberto (sem duplicar); testar cenário de 1ª execução forçada (flag movida) com toggle ligado.

---

## Riscos e armadilhas conhecidas (leia antes de começar)

- **Parse do winget:** a saída é localizada e as larguras de coluna variam; nomes de pacotes contêm espaços. A estratégia por posições de cabeçalho (T3) com fallback para `--output json` é a mais resiliente. Não confie em `split('  ')` ingênuo. Upgrades de escopo máquina/admin falham por item — é esperado; não tente elevação global.
- **Limpeza de temporários (T5):** arquivos abertos não podem ser removidos (EPERM/EBUSY) — pular é o comportamento correto, não um bug. **Nunca** amplie o escopo para Windows Update/Prefetch/Registro. Use `withFileTypes` e ignore symlinks.
- **Registry/PowerShell:** `reg query` retorna `REG_SZ` com espaçamento livre; nomes de valores diferem entre Steam SteamPath (HKCU) e InstallPath (HKLM). Desescape `\\` em `libraryfolders.vdf` (o formato moderno duplica barras).
- **`app.getFileIcon`** (T8) pode devolver imagem **vazia** para exes sem ícone (raro) ou formatos não suportados — sempre verificar `isEmpty()` antes de gravar o PNG; fallback 🎮 é obrigatório.
- **`.ico`:** não é decodificado confiavelmente por `nativeImage` — a T9 restringe a PNG/JPG/WebP de propósito.
- **Persistência:** dados novos vão para o `electron-store` (`config.json`, com schema e migrações). O `localStorage` legado (`kolnd-hub-apps`) é apenas fonte de leitura/migração — não crie novas chaves nele.
- **Navegação sem router:** qualquer página nova = 4 pontos (união `Page`, `Sidebar.tsx`, render em `App.tsx`, IPCs/preload). Esquecer qualquer um gera tela em branco ou erro de tipo.

---

## Validação final de entrega (smoke test)

Antes de considerar o conjunto concluído:

- [ ] `npm run build` limpo e `npx tsc --noEmit` nos dois projetos ok
- [ ] 1ª execução ainda funciona ponta a ponta (flag forçada) sem regressões
- [ ] Sidebar: Ferramentas (ex-Biblioteca), PC (hostname) com 3 abas, Biblioteca (jogos), Configurações
- [ ] winget list → upgrade lote (≥ 1 item real) → limpeza temporários → adicionar jogo manual → importar Steam → editar → remover → toggle ligado/desligado
- [ ] Nenhuma referência quebrada a "Biblioteca" antiga no dashboard; `git status` sem arquivos fora do escopo

---

## Histórico

- **v1** — roadmap original (prompts curtos, sem critérios de aceitação).
- **v2 (este arquivo)** — prompts auto-contidos; premissas P1–P7 registradas; dependências e ordem justificadas; definição de pronto global; mapa do código com âncoras reais; decisões técnicas (electron-store, spawn direto para jogos, fila sequencial, restrição a PNG/JPG/WebP) documentadas onde impactam o código; riscos conhecidos.
