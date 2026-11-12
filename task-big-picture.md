# ⚡ Kolnd Hub — Task Big Picture (T1–T8): Modo Big Picture otimizado para gamepad

> **Task Big Picture · Novembro/2026** — tarefa auto-contida no mesmo formato do `plano_de_tarefas_e_prompts.md` (v2), dedicada ao **Modo Big Picture**.
> Implementa um modo "console" (inspirado no Steam Big Picture) com navegação completa por gamepad, tela de configuração de controles (manual + mapeamento automático), gate de primeira execução para usuários sem controle configurado, persistência entre sessões e animação cinematográfica de entrada (raio + choque elétrico + onda de energia).
> Antes de começar, leia **Decisões registradas (premissas)** e **Riscos e armadilhas conhecidas**.

---

## Como usar este documento

1. **Uma tarefa por sessão de agente** (uma por vez, em ordem ou respeitando as dependências). Não envie o documento inteiro.
2. Coloque o agente na raiz do repositório (`C:\Users\TiffoDi\desenv\Kolnd Hub`) e envie: *"Leia a tarefa Tn neste arquivo e implemente exatamente o escopo descrito."*
3. O agente deve **seguir os padrões existentes do projeto** (ver "Mapa rápido do código"), não inventar arquitetura nova.
4. Depois da implementação, o agente executa a seção **Validação** da tarefa e você revisa o diff contra os **Critérios de aceitação**. Reprovou algum? Mande corrigir antes de marcar a tarefa como concluída.
5. **Branch de trabalho** (`feature/big-picture` ou `Dev`) — nunca direto em `main` (ver README, seção de branches).

### Regras globais (definition of done de toda tarefa)
- [ ] `npx tsc --noEmit -p tsconfig.node.json` **e** `npx tsc --noEmit -p tsconfig.web.json` sem novos erros
- [ ] `npm run build` concluído com sucesso
- [ ] `npm run dev` abre o app e a feature nova funciona no fluxo manual
- [ ] Escopo respeitado (nada fora do descrito; se precisar algo fora, pergunte antes)
- [ ] Interface em **pt-BR**, linguagem amigável, sem jargão técnico para o usuário final
- [ ] Sem adicionar dependências novas sem justificativa explícita no PR/commit

---

## Mapa rápido do código (âncoras reais)

| Arquivo | Papel |
|---|---|
| `kolnd-hub/src/renderer/src/App.tsx` | Estado global, roteamento **por estado** (sem router): `const [currentPage, setCurrentPage] = useState<Page>('dashboard')` (~linha 40); render condicional (~487–515); gates de carregamento (`dataReady`/`animationDone`) e de 1ª execução (`isFirstRunFromQuery()`, `?first-run=1`); branching de topo (1ª execução → LoadingScreen → `<Layout>`) (~466–515) |
| `kolnd-hub/src/renderer/src/types.ts` | União `Page = 'dashboard' \| 'settings' \| 'inicializacao' \| 'biblioteca'` (linha 30), `AppConfig`, `Game`, `SteamImportResult`, etc. |
| `kolnd-hub/src/renderer/src/components/Sidebar.tsx` | `navItems` (~12–17: Ferramentas/Wrench, PC/Monitor, Biblioteca/Gamepad2, Configurações/Settings) + `activeColors` por página (~66–75); rodapé com `v1.0.0 · Gamer Edition` (~110) — ponto exato para o botão "Big Picture" |
| `kolnd-hub/src/renderer/src/components/Layout.tsx` | Shell: `.scanlines` (~26), title bar frameless (~29–70) com botões Minus/Square/X (`minimizeWindow`/`maximizeWindow`/`closeWindow`, wrapper `.title-bar-no-drag`), `<main className="flex-1 overflow-y-auto p-8 pb-12">` |
| `kolnd-hub/src/main/index.ts` | `createWindow()` (~47–90): janela **frameless, NÃO fullscreen/kiosk** — `width: 1280, height: 800, frame: false, titleBarStyle: 'hidden', backgroundColor: '#0a0a0f', webPreferences: { sandbox: true, contextIsolation: true }`. Registro de IPCs via `register*Ipc()` dentro de `app.whenReady()` (~137–155: `registerFirstRunIpc`, `registerConfigIpc`, `registerPrefsIpc`, `registerWingetIpc`, `registerTempCleanerIpc`, `registerGamesIpc`, `registerSteamIpc`). Handler inline `window:maximize` (~298–304). Eventos `app:status-changed`/`app:output` encaminhados ao renderer |
| `kolnd-hub/src/main/store.ts` | **Persistência canônica**: `electron-store` → `%APPDATA%/kolnd-hub/config.json`, schema ajv + migrações versionadas (`'1.0.0'` baseline no-op, `'1.1.0'` normaliza apps/startupImportance, `'1.2.0'` garante `games`, `'1.3.0'` default `launchKloudOnStart`); degrada para `null` em corrupção. Chaves atuais: `apps`, `startupImportance`, `games`, `launchKloudOnStart` |
| `kolnd-hub/src/preload/index.ts` + `index.d.ts` | Objeto `api` único (~316 `contextBridge.exposeInMainWorld('api', api)`); cada método embrulha `ipcRenderer.invoke(...)`; `index.d.ts` espelha **manualmente** os tipos — sempre atualizar os **dois** arquivos |
| `kolnd-hub/src/renderer/src/index.css` | `.glass`, `.glass-card`, `.glass-hover`, `.glass-panel`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.input-gamer`, `.toggle-console` (+`-checked`/`-knob`), `.label-panel`, `.scanlines`, `.title-bar`, `.title-bar-no-drag` |
| `kolnd-hub/tailwind.config.js` | Paletas `kloud` (#f97316…), `steam` (#171a21, blue #0568e5), `playstation`, `neon` (cyan #00f3ff, purple #bc13fe); gradientes `gradient-gaming`, `gradient-rainbow`, `gradient-kloud/steam/playstation`; sombras `shadow-glow-cyan/purple/blue/orange/red` |
| `kolnd-hub/src/renderer/src/components/Settings.tsx` | Seções com cabeçalho uppercase (`text-xs font-bold text-slate-600 uppercase tracking-widest mx-2`) + card `.glass rounded-2xl p-6 border-l-4 …`; padrão de toggle persistente com feedback "Salvo" (`launchKloudOnStart`, ver linhas ~26–72 e ~160–208) — modelo para a nova seção "Big Picture" |
| `kolnd-hub/src/renderer/src/components/Biblioteca.tsx` | Grid de jogos + `window.api.launchGame(id)` + selo de exe não encontrado; referência de como consumir `games:get` |
| `kolnd-hub/package.json` | v1.3.0; Electron ^28, React 18, **framer-motion ^11** (usar nas animações), lucide-react, electron-store ^8.2; scripts `dev`/`build`/`typecheck`/`lint`/`test` (Vitest) |
| Testes | `*.test.ts` **ao lado do fonte** (ex.: `src/renderer/src/lib/appsConfig.test.ts`, `src/main/steamScanner.test.ts`) |

**Estado atual (verificado):** **não existe** nenhum código de gamepad (`navigator.getGamepads()`), fullscreen/kiosk (`setFullScreen`), áudio (`AudioContext`/assets) ou navegação por teclado/foco espacial no Hub. Tudo isso nasce nesta task.

**Padrão IPC ponta a ponta (obrigatório seguir):**

```
main (novo módulo, ex.: gamepad.ts)
  └─ registerGamepadIpc() → ipcMain.handle('gamepad:get', …)          ← exportado, chamado em main/index.ts
preload/index.ts   → getGamepadConfig: () => ipcRenderer.invoke('gamepad:get')  ← + tipos em preload/index.d.ts
renderer           → window.api.getGamepadConfig()                     ← nunca usar Node/fs no renderer
```

**Componentes e visual:** Tailwind 3 + `framer-motion` + `lucide-react`. Sem shadcn/Radix — crie componentes próprios seguindo os existentes.

---

## Decisões registradas (premissas deste plano)

- **P1 — O Big Picture é um takeover fullscreen da janela principal**, não uma `BrowserWindow` separada e não uma nova `Page` na sidebar. Ao entrar: `setFullScreen(true)` via novo IPC `window:set-fullscreen` e `<BigPicture>` é renderizado em `App.tsx` **acima** do `<Layout>` (como os gates de 1ª execução/LoadingScreen), ocultando sidebar e title bar. Ao sair: restaura fullscreen e devolve ao shell normal. Se um dia virar janela separada, ajuste P1 antes de começar.
- **P2 — Ponto de entrada:** botão **"Big Picture"** (ícone `Gamepad2`, classe `.btn-ghost`/estilo do rodapé) fixado no **rodapé da `Sidebar.tsx`**, acima do texto de versão; escondido quando `?first-run=1`. **Saída:** item "Sair do Big Picture" no rail final + botão **B** na tela inicial (com confirmação "Sair do Big Picture?") + tecla **Esc**.
- **P3 — Gate de primeira execução:** ao tentar entrar sem controle configurado (`gamepad:get` retornando `null`), o Hub abre o takeover diretamente na **tela de configuração de controles** (modo `setup`), com um aviso amigável: *"Antes de usar o Big Picture, configure seu controle — pressione qualquer botão"*. Concluído o setup, a entrada normal é liberada e o usuário cai direto no Big Picture (após a animação de transição).
- **P4 — Persistência no `electron-store`** (nunca localStorage): nova chave **`gamepad`** (`GamepadConfig | null`, default `null`) e nova chave **`bigPicture`** (`{ sounds: boolean }`, default `{ sounds: true }`), com migração versionada **`'1.4.0'`** (não consumar `'1.3.0'`). Sobreviver ao fechamento do app é requisito — por isso store, não memória/localStorage.
- **P5 — Identificação do controle** via `Gamepad.id`: regex `Vendor:\s*([0-9a-f]{4})` / `Product:\s*([0-9a-f]{4})` (formato Chromium, ex.: `"Xbox Wireless Controller (… Vendor: 045e Product: 028e)"`); fallback: procurar as siglas `045e`/`054c`/`057e` em qualquer parte do `id` (formato Mozilla, ex.: `030000005e0400008e02000000000000`). Mapeamento para: `045e` → **xbox**, `054c` → **playstation**, `057e` → **switch**, qualquer outro → **generic**. Se `mapping !== 'standard'`, aplicar perfil positional `generic` e registrar aviso no console. Perfis diferem por **rótulos/glifos** e pela **convenção Nintendo** (ver P10), não pelos índices.
- **P6 — SFX via Web Audio API** (`src/renderer/src/lib/sfx.ts`, osciladores + envelopes; **sem assets e sem dependências novas**): sons para navegar, confirmar, voltar, erro e impacto da animação. Toggle **"Efeitos sonoros"** na seção Big Picture das Configurações (per `bigPicture.sounds`); `AudioContext` suspenso é retomado no primeiro gesto do usuário.
- **P7 — Animação de entrada em canvas + máscara CSS:** `<canvas>` fullscreen desenha raio, faíscas e anel de choque elétrico; a revelação do fundo do Big Picture é feita por uma camada com `mask-image: radial-gradient(circle at 50% 50%, black var(--reveal), transparent var(--reveal))` cuja variável é animada em `requestAnimationFrame` (GPU, sem reflow). Fala em 7 fases (ver T7). Duração total ≈ **2,5–3,5 s**. **Qualquer botão/clique/Esc pula para o fim.** `prefers-reduced-motion: reduce` desativa raio/ondas e mantém apenas um fade.
- **P8 — Navegação espacial declarativa** (sem lib externa): cada tela do Big Picture registra seus itens focáveis (`id` → `ref`) num contexto `BigPictureFocusProvider`; a direção pressionada escolhe o candidato mais próximo por ângulo + distância (algoritmo clássico de navegação 2-D). Movimentos de foco: anel `ring-4 ring-neon-cyan` + `shadow-glow-cyan` + `scale-[1.03]` + `transition-transform`. Mouse continua **100% operável**: `hover` move o foco, `click` ativa. **Repetição ao segurar:** delay inicial 380 ms, depois 1 disparo a cada 110 ms (direções do D-Pad e eixo do stick esquerdo com deadzone 0,5).
- **P9 — Home do Big Picture:** rail vertical à esquerda (logo **KOLND** + itens: **Jogos** (`Gamepad2`), **Ferramentas** (`Wrench`), **Controle** (`Gamepad`/`SlidersHorizontal`) e **Sair do Big Picture** (`LogOut`)); área de conteúdo com cards grandes (capa/ícone ≥ 96 px, nome ≥ text-xl). **Jogos** lista via IPC `games:get` e lança com `games:launch`. **Ferramentas** reutiliza `AppConfig[]` + `handleLaunch` equivalentes ao Dashboard/Biblioteca (via props vindas de `App.tsx`). **Controle** reabre a tela de acompanhamento/ajuste do mapeamento (T5). Canto superior direito: relógio `HH:MM` (atualizado 1×/min) — toque "console".
- **P10 — Todo botão físico é mapeável.** Ações semânticas do Hub: `confirm, back, up, down, left, right, menu, options, tab_prev, tab_next, stick_left, stick_right` → índices de botão `0–15` (o botão `16` Guide/Home é **ignorado** no mapeamento — reservado em vários drivers). Perfil padrão (índices da Gamepad API com `mapping: 'standard'`):

  | Ação | Xbox / PlayStation / Generic | Switch Pro (convenção Nintendo) |
  |---|---|---|
  | confirm | 0 (A / Cross) | **1** (A — botão da direita) |
  | back | 1 (B / Circle) | **0** (B — botão inferior) |
  | up / down / left / right | 12 / 13 / 14 / 15 (D-Pad) | 12 / 13 / 14 / 15 |
  | menu | 9 (Start / Options) | 9 (+) |
  | options | 8 (Back / Share / −) | 8 (−) |
  | tab_prev / tab_next | 4 / 5 (LB / L1 · RB / R1) | 4 / 5 (L · R) |
  | stick_left / stick_right | 10 / 11 (LS / L3 · RS / R3) | 10 / 11 (L3 · R3) |

  O stick analógico esquerdo **sempre** navega (além do D-Pad), com deadzone 0,5 — não é remapeável (documentar na UI). X/Y (2/3) e LT/RT (6/7) ficam **livres** por padrão (disponíveis para o usuário mapear, ex.: tabs).
- **P11 — Hot connect/disconnect:** eventos `gamepadconnected`/`gamepaddisconnected` + heurística no loop de polling (controle sumiu da lista de `navigator.getGamepads()`). Ao desconectar dentro do Big Picture: overlay **"Controle desconectado — reconecte-o ou use a mouse"** com spinner; some sozinho quando reconectar. O mouse **nunca** é bloqueado. Se o controle reconectado for o mesmo (`id` igual), retoma normalmente; se for outro modelo, mantém o mapeamento persistido mas avisa que os rótulos podem mudar (ver T8).
- **P12 — `?first-run=1` nunca abre Big Picture:** botão oculto, `Enter` em deep-link ignorado. O gate de 1ª execução (P3) só age **dentro** do Big Picture, não no fluxo de first-run.

---

## Dependências e ordem de execução

```
T1 (lib gamepad pura + testes)
  └─→ T2 (persistência store + IPC + preload)
        ├─→ T3 (shell fullscreen: entrada/saída + layout TV)
        │     └─→ T4 (navegação por gamepad: foco espacial, repetição, SFX)
        │           └─→ T7 (animação cinematográfica de transição)
        └─→ T5 (seção Settings "Big Picture": config manual + auto-mapping)
              └─→ T6 (gate: sem controle → configuração antes da UI principal)
T8 (hot connect/disconnect, responsividade, acessibilidade) ← por último (depende de T3..T7)
```

**Ordem sugerida (T1 → T8):** T1, T2, T3, T4, T5, T6, T7, T8.
T5 e T6 podem ser feitas em paralelo a T3/T4 desde que T2 esteja concluída.

---

## Fase 1: Controles e persistência (infraestrutura)

### [X] T1 — Camada de gamepad: detecção, identificação e perfis de layout
**Objetivo:** criar a base **pura e testável** (sem Electron) para ler gamepads via Gamepad API, identificar o modelo e aplicar o perfil de mapeamento padrão.

**Dependências:** nenhuma.
**Arquivos-alvo:** novos `src/renderer/src/lib/gamepad/types.ts`, `profiles.ts`, `detect.ts`, `index.ts` (barrel); novo `src/renderer/src/lib/gamepad/profiles.test.ts` e `detect.test.ts`.

**Prompt para o Agente:**
> Sua tarefa (T1) é criar, em `src/renderer/src/lib/gamepad/`, a camada pura de detecção e perfis de controles do modo Big Picture. **Nada de Electron/IPC aqui** — só lógica + testes (o IPC vem na T2).
> 1. `types.ts`: exporte
>    - `export type GamepadProfile = 'xbox' | 'playstation' | 'switch' | 'generic';`
>    - `export type GamepadAction = 'confirm' | 'back' | 'up' | 'down' | 'left' | 'right' | 'menu' | 'options' | 'tab_prev' | 'tab_next' | 'stick_left' | 'stick_right';`
>    - `export type GamepadButtonMapping = Record<GamepadAction, number>;`
>    - `export interface GamepadConfig { profile: GamepadProfile; controllerId: string; controllerName: string; vendorId?: string; productId?: string; mapping: GamepadButtonMapping; autoMapped: boolean; configuredAt: string; }`
>    - `export const GAMEPAD_ACTION_LABELS: Record<GamepadAction, string>` com rótulos pt-BR amigáveis ("Confirmar", "Voltar", "Cima", "Baixo", "Esquerda", "Direita", "Menu", "Opções", "Aba anterior", "Aba seguinte", "Analógico esquerdo", "Analógico direito").
> 2. `profiles.ts`: `export const GAMEPAD_PROFILES: Record<GamepadProfile, { label: string; buttons: Record<number, string>; mapping: GamepadButtonMapping }>` com os 4 perfis conforme a tabela P10 do plano (índices idênticos entre xbox/playstation/generic; **switch troca confirm↔back para 1/0**). `buttons` = nome amigável por índice 0–16 (ex.: `{ 0: 'A', 1: 'B', … }` para xbox; `{ 0: 'Cross', 1: 'Circle', … }` para playstation; `{ 0: 'B', 1: 'A', … }` para switch; `'Botão 0'…` para generic). `GENERIC_PROFILE` quando `mapping !== 'standard'`.
> 3. `detect.ts`:
>    - `export function parseGamepadId(id: string): { vendorId?: string; productId?: string }` — regex `Vendor:\s*([0-9a-fA-F]{4})` e `Product:\s*([0-9a-fA-F]{4})`; se não casar, procure `045e`/`054c`/`057e` (case-insensitive) em qualquer posição do id.
>    - `export function detectProfile(id: string, mapping: string): GamepadProfile` — vendor `045e`→`xbox`, `054c`→`playstation`, `057e`→`switch`, senão `'generic'`; se `mapping !== 'standard'`, force `'generic'`.
>    - `export function friendlyControllerName(id: string, profile: GamepadProfile): string` — nome humano: "Controle Xbox", "Controle PlayStation", "Nintendo Switch Pro Controller", ou o id truncado (80 chars) como fallback.
>    - `export function buildAutoConfig(pad: Gamepad): GamepadConfig` — monta a config completa (`autoMapped: true`, `configuredAt: new Date().toISOString()`, `controllerId`/`controllerName`/`vendorId`/`productId`, `mapping` do perfil detectado).
>    - `export const AXIS_DEADZONE = 0.5;` e `export function axisToDirection(value: number): -1 | 0 | 1` (abs < deadzone → 0).
> 4. `index.ts`: re-exporta tudo.
> 5. Testes (Vitest, ao lado do fonte): `profiles.test.ts` (switch tem confirm=1/back=0; demais confirm=0/back=1; todas as ações presentes em todos os perfis) e `detect.test.ts` com fixtures reais de `id` ("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", "Pro Controller (…057e…)", id Mozilla hexadecimal, id desconhecido, `mapping: 'non-standard'`).
> 6. Não implemente polling/rAF ainda (isso é a T4). Não toque em `store.ts`.

**Critérios de aceitação:**
- [ ] `detectProfile` classifica corretamente os 4 fixtures principais (xbox/ps/switch/generic) e força `generic` com `non-standard`
- [ ] `buildAutoConfig` produz config válida com mapeamento completo (12 ações) para os 3 vendors cobertos
- [ ] `npm test` verde; `tsc` (web) sem novos erros
- [ ] Zero dependências novas

**Validação:** `npx vitest run src/renderer/src/lib/gamepad` e conferir os fixtures; rodar `npm run typecheck`.

---

### [X] T2 — Persistência do mapeamento (electron-store + IPC + preload)
**Objetivo:** persistir `GamepadConfig` e as preferências do Big Picture no `electron-store`, expostos por IPC no padrão do projeto.

**Dependências:** T1 concluída.
**Arquivos-alvo:** `src/main/store.ts`, novo `src/main/gamepad.ts` (ou estender `store.ts` com `registerGamepadIpc()` — **prefira módulo novo** no estilo `games.ts`), `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/types.ts` (re-exportar tipos da T1 se necessário).

**Prompt para o Agente:**
> Dando continuidade à T1, sua tarefa (T2) é persistir a configuração de controle do Big Picture seguindo o padrão canônico do `store.ts`.
> 1. Em `src/main/store.ts`: adicione ao `HubStoreSchema` e ao `schema` a chave **`gamepad`** (`{ type: ['object','null'], default: null }` — objeto livre mas validado por `normalizeGamepadConfig()`) e a chave **`bigPicture`** (`{ type: 'object', default: { sounds: true }, properties: { sounds: { type: 'boolean' } } }`).
> 2. `normalizeGamepadConfig(raw): GamepadConfig | null` no estilo de `normalizeGame()`: valida `profile` ∈ união, `mapping` com as 12 ações (coerção de índice de botão para inteiro 0–15; descarte índices fora de 0–15 — Guide/16 é proibido, ver P10), strings não vazias; qualquer inconsistência → `null` (o gate de primeira execução trata `null` como "não configurado").
> 3. Migração versionada **`'1.4.0'`**: garante defaults de `gamepad` (null) e `bigPicture` (`{ sounds: true }`). **Não quebre** as migrações `'1.0.0'`–`'1.3.0'`. `package.json` vai para `1.4.0` (mantenha o alinhamento store↔app).
> 4. Novo `src/main/gamepad.ts` com `registerGamepadIpc()` registrando:
>    - `gamepad:get` → `{ ok: boolean; config: GamepadConfig | null; error?: string }`
>    - `gamepad:set` (`config: unknown` → valida com `normalizeGamepadConfig`; inválido → `{ ok: false, error }` sem gravar) — persiste via `store.set('gamepad', cfg)`; **não** sobrescrever `configuredAt` se o restante for idêntico (evita churn)
>    - `gamepad:reset` → apaga a chave (`gamepad` volta a `null`)
>    - `bigpicture:get-prefs` → `{ ok, prefs: { sounds: boolean } }`; `bigpicture:set-prefs` (`{ sounds: boolean }`) → persiste `bigPicture`
>    Chame `registerGamepadIpc()` em `main/index.ts` junto aos demais `register*Ipc()`.
> 5. Preload + `index.d.ts` (**espelhar os dois**): `getGamepadConfig()`, `setGamepadConfig(cfg)`, `resetGamepadConfig()`, `getBigPicturePrefs()`, `setBigPicturePrefs(prefs)`.
> 6. Nenhum ajuste de UI nesta tarefa (chega na T5).

**Critérios de aceitação:**
- [ ] Salvar config via devtools → `window.api.getGamepadConfig()` retorna idêntica; fechar/reabrir o app → **continua salva**
- [ ] `gamepad:set` com mapping inválido (índice 16 ou perfil inexistente) é rejeitado sem gravar
- [ ] `resetGamepadConfig()` devolve `null` e o app segue estável
- [ ] Migração `'1.4.0'` roda em cima de um store 1.3.0 real sem apagar `apps`/`games`/`launchKloudOnStart`
- [ ] Build + `tsc` (node e web) ok

**Validação:** backup de `%APPDATA%\kolnd-hub\config.json`; via devtools chame `setGamepadConfig` com fixture válido e inválido; reinicie o app; confira o JSON (chaves `gamepad`/`bigPicture` presentes, migrações registradas em `__internal__.migrations.version` ≥ 1.4.0); restaure o backup ao final.

---

## Fase 2: Shell do Big Picture e navegação

### [X] T3 — Shell fullscreen: entrada, saída e layout para TV
**Objetivo:** criar o takeover fullscreen do Big Picture (sem gamepad ainda): botão de entrada na Sidebar, janela em tela cheia via IPC, e a home com rail + área de conteúdo (Jogos/Ferramentas/Controle/Sair) operável por mouse.

**Dependências:** T2 concluída.
**Arquivos-alvo:** `src/main/index.ts` (novo handler), `src/main/window…` (se extraído), preload ambos, `src/renderer/src/App.tsx`, `src/renderer/src/components/Layout.tsx` (prop opcional), `src/renderer/src/components/Sidebar.tsx` (botão), novo `src/renderer/src/components/BigPicture.tsx` (+ `BigPictureRail.tsx`, `BigPictureHome.tsx` ou similar), `src/renderer/src/types.ts`.

**Prompt para o Agente:**
> Sua tarefa (T3) é criar o **shell** do modo Big Picture: entrar em tela cheia, exibir a home para TV e sair de volta ao Hub normal. A navegação por gamepad é a T4 — aqui, mouse/teclado já devem funcionar por completo.
> 1. **Janela:** novo IPC `window:set-fullscreen` (`flag: boolean` validado como booleano) em `main/index.ts` chamando `mainWindow.setFullScreen(flag)`; preload `setFullScreen(flag)`. **Não** use `kiosk` (queremos Alt+F4/gesto de saída funcionando em emergência) nem maximize.
> 2. **Entrada:** em `Sidebar.tsx`, rodapé acima do texto de versão, botão **"Big Picture"** (`Gamepad2`, `text-neon-cyan`/`hover` com `shadow-glow-cyan`) chamando `onEnterBigPicture()` (prop nova, opcional). Oculto em `?first-run=1`. Em `App.tsx`, estado `bigPicture: 'hidden' | 'setup' | 'active'`; entrar **sempre** passa antes pelo gate (T6): nesta tarefa, assuma `setBigPicture('active')` quando já houver config, senão `'setup'` (tela placeholder "Configuração do controle…" — a tela real é a T5).
> 3. **Render:** em `App.tsx`, quando `bigPicture !== 'hidden'`, renderize `<BigPicture>` **no lugar** de `<Layout>` (não dentro dele), como o gate de 1ª execução. Escureça o shell por baixo com o `.scanlines` normal.
> 4. **`BigPicture.tsx`:** container fullscreen `fixed inset-0 z-50 bg-gradient-gaming` + glows radiais (orbs `kloud`/`neon-purple` bem desfocados, baixa opacidade) + `.scanlines`. Layout: rail à esquerda (`w-72`, logo **KOLND** gradient-text no topo; itens grandes, `text-2xl`, ícone 28–32px: **Jogos**, **Ferramentas**, **Controle**, divisor, **Sair do Big Picture**) + área de conteúdo à direita (`flex-1 p-12`) + **relógio** `HH:MM` no canto superior direito (`text-3xl`, `tabular-nums`, atualiza a cada minuto).
> 5. **Conteúdo por seção** (estado local `section: 'games' | 'tools' | 'controls'`):
>    - **Jogos:** grade responsiva de cards grandes (capa ≥ 128px, nome `text-2xl`, `grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`) alimentada por `games:get` (reusar cache/IPC existente); clique no card → `window.api.launchGame(id)`; estado vazio amigável ("Sua biblioteca está vazia — adicione jogos pelo Hub normal") ; contador "N jogos" no cabeçalho.
>    - **Ferramentas:** mesma grade com os `apps` vindos do App (props), clique lança pela **mesma função de launch** do Dashboard (repasse a prop de launch do App; na dúvida, espelhe o comportamento de `Biblioteca.tsx`/`handleLaunch` — **não** duplique a lógica de spawn, apenas chame o handler existente).
>    - **Controle:** nesta tarefa, placeholder estático ("Configuração de controles — disponível na T5"); o conteúdo real é da T5/T6.
> 6. **Saída:** item "Sair do Big Picture" no rail → `setFullScreen(false)` + `setBigPicture('hidden')`. **Esc** também sai (listener global só enquanto o Big Picture está montado). Voltar à seção anterior quando aplicável.
> 7. **Mouse completo:** todos os itens do rail e cards respondem a clique/hover; foco visual obrigatório em `:focus-visible` (outline neon). Nenhum `cursor: none`.
> 8. Não implemente gamepad, setup real, transição nem SFX aqui.

**Critérios de aceitação:**
- [ ] Botão "Big Picture" na Sidebar entra em tela cheia (frameless fullscreen) e ESC/Sair devolve ao Hub idêntico ao estado anterior (página, tray, processo)
- [ ] Home com Jogos (grade real via `games:get`), Ferramentas (launch funciona e **não** altera o contador de apps ativos do shell após sair) e relógio HH:MM
- [ ] 100% operável por mouse (rail, cards, sair); `?first-run=1` não mostra o botão
- [ ] `setFullScreen(true)` não derruba tray nem IPC; Alt+F4 continua fechando a janela como antes
- [ ] Build + `tsc` (node e web) ok

**Validação:** `npm run dev` → clicar "Big Picture" → conferir fullscreen (sem bordas) e as duas seções; lançar 1 jogo e 1 ferramenta de dentro do Big Picture; sair com Esc e pelo rail; forçar `?first-run=1` e confirmar a ausência do botão.

---

### [X] T4 — Navegação por gamepad: polling, foco espacial, repetição, SFX
**Objetivo:** fazer o Big Picture **100% utilizável só com gamepad**: leitura contínua, foco visual claro, navegação fluida com repetição ao segurar, feedback sonoro e suporte total paralelo a mouse/teclado.

**Dependências:** T3 concluída.
**Arquivos-alvo:** novo `src/renderer/src/hooks/useGamepad.ts`, novo `src/renderer/src/lib/spatialNav.ts` (+ `.test.ts`), novo `src/renderer/src/lib/sfx.ts`, `src/renderer/src/components/BigPicture.tsx` (+ subcomponentes), `src/renderer/src/components/BigPictureFocus.tsx` (contexto).

**Prompt para o Agente:**
> Sua tarefa (T4) é ligar o gamepad ao shell da T3. Toda a matemática de foco fica em `lib/spatialNav.ts` (pura, testável); a coleta fica em `hooks/useGamepad.ts`.
> 1. **`spatialNav.ts`:** `export function nearestInDirection(from: DOMRect, candidates: { id: string; rect: DOMRect }[], dir: 'up'|'down'|'left'|'right'): string | null` — filtra candidatos no semiplano da direção (ex.: `dir='left'` exige `center.x < from.center.x`), pontuando por `distância × (1 + ânguloDesvio)`; retorna o de menor score ou `null`. Testes unitários: grid 3×3 navega corretamente nas 4 direções, bordas retornam `null`, empate resolve pelo eixo perpendicular mais alinhado.
> 2. **`useGamepad.ts`:** loop em `requestAnimationFrame` enquanto o Big Picture está montado; lê `navigator.getGamepads()` e usa o **primeiro gamepad presente** (ou o cujo `id` === `controllerId` da config, se presente). Ações resolvidas via `config.mapping` (botões) + eixos (`axisToDirection(axes[0])`/`axes[1]` da T1) OU D-Pad (12–15 via mapping). Estado por botão: `{ pressedAt, lastFiredAt }`. **Repetição:** na primeira borda dispara na hora; mantido pressionado > **380 ms**, repete a cada **110 ms** (direções apenas — `confirm/back/menu` não repetem). Limpeza completa no unmount (cancela rAF, remove listeners). **Fallback "nenhum controle configurado":** `getGamepadConfig()` null → o hook devolve `{ connected: false, actions: noop }` e a UI mostra a dica discreta "Use o mouse ou configure um controle (Configurações → Big Picture)".
> 3. **Contexto de foco** (`BigPictureFocusProvider`): registro `id → ref` via `registerFocusable(id, ref)`/`unregister`; `focusedId` em estado; navegação: `moveFocus(dir)` usa `nearestInDirection` sobre os rects correntes; **A/confirm** → `activateFocused()` (click no elemento focado); **B/back** → seção anterior ou, na raiz, pede confirmação de saída; **LB/RB** → `tab_prev`/`tab_next` alterna seções do rail; **Start/menu** → pausa/overlay de "Opções" (máx: Sair / Configuração de controle). Mouse: `onMouseEnter` nos focáveis seta `focusedId`; `onClick` ativa. Foco visível idêntico para fonte mouse e gamepad.
> 4. **SFX** (`sfx.ts`): `playSfx('move' | 'confirm' | 'back' | 'open' | 'error' | 'launch')` com Web Audio API (oscilador square/triangle + gain envelope curto; `move` ~60 ms agudo, `confirm` dois tons ascendentes, `error` tom grave). Respeita `bigPicture.sounds` (lido via `getBigPicturePrefs()` no mount e a cada toggle). `AudioContext` único e lazy (criado no primeiro gesto); erros de áudio nunca quebram a navegação.
> 5. **Visão geral de interação na home:** rail e grade usam o mesmo contexto; ao trocar seção, foco vai para o primeiro item da área; cards focados escalam (`scale-105`) + `ring-4 ring-neon-cyan shadow-glow-cyan`; item do rail focado: barra lateral neon à esquerda + ícone aceso.
> 6. **Teclado de cortesia:** setas navegam, Enter confirma, Esc sai/volta — mesma semântica do controle (mantém usuários de teclado felizes sem prometer suporte completo).
> 7. **Indicador de conexão:** ponto no rail inferior — verde "Controle conectado" / cinza "Sem controle (mouse)"; desaparece após 3 s quando tudo bem (só erro persistente fica fixo).
> 8. Não implemente setup/mapeamento (T5) nem transição (T7).

**Critérios de aceitação:**
- [ ] Toda a home operável **só com gamepad**: rail, grade de jogos/ferramentas, lançar, voltar, alternar seções com LB/RB, sair
- [ ] Foco sempre visível, único e previsível; mouse hover rouba foco sem conflito
- [ ] Segurar uma direção repete a navegação (380/110 ms) e parar de segurar interrompe imediatamente
- [ ] SFX toca nas 4 interações e respeita o toggle "Efeitos sonoros" (off = silêncio total)
- [ ] `spatialNav` coberto por testes; `npm test` verde; build + `tsc` ok

**Validação:** com um controle real (Xbox/PS/Switch/genérico — ou emulador como "XInput Tester"/AntiMicro): navegar por toda a interface, conferir repetição ao segurar ↓ em lista longa, alternar abas com LB/RB, mutar os sons pelo toggle e repetir o percurso em silêncio; navegue também só com mouse e misture os dois no meio do caminho.

---

### [X] T5 — Seção "Big Picture" nas Configurações + tela de configuração de controles (manual e automático)
**Objetivo:** criar em **Configurações** a nova seção "Big Picture" com a tela de configuração de controles: mapeamento automático por "pressione qualquer botão", ajuste manual por botão, e persistência — tudo reutilizando a base das T1/T2/T4.

**Dependências:** T2 concluída. (T4 recomendada antes; o "setup" usa os mesmos telares de foco.)
**Arquivos-alvo:** `src/renderer/src/components/Settings.tsx`, novo `src/renderer/src/components/BigPictureSettings.tsx` (seção) e novo `src/renderer/src/components/GamepadSetup.tsx` (fluxo automático + ajuste manual, compartilhado com o modo `setup` do Big Picture), `src/preload/…` se faltar algo, `src/renderer/src/index.css` (classes novas se necessário).

**Prompt para o Agente:**
> Sua tarefa (T5) é a seção **"Big Picture"** das Configurações e a **tela de configuração de controles** usada tanto lá quanto no gate de 1ª execução do Big Picture (T6). Um único componente `GamepadSetup.tsx`, dois pontos de entrada.
> 1. **Nova seção em `Settings.tsx`:** cabeçalho uppercase **"Big Picture"** no mesmo estilo das seções existentes ("Ao abrir o Hub" / "Gerenciador de títulos"). Card `.glass rounded-2xl p-6 border-l-4 border-neon-cyan` contendo, nesta ordem:
>    - Ícone + título "Modo Big Picture" + descrição curta ("Interface em tela cheia otimizada para gamepad e TV — navegação, lançamento de jogos e controles do Hub").
>    - **Status do controle:** "Nenhum controle configurado" / "Controle: **<nome detectado>** · perfil **Xbox/PlayStation/Switch/Genérico** · configurado em DD/MM/AAAA" (via `getGamepadConfig()`).
>    - Botões: **"Configurar controle"** (abre `GamepadSetup`) · **"Refazer mapeamento automático"** (só com config existente; apaga e recomeça o fluxo automático) · **"Apagar configuração"** (destrutivo, com confirmação; volta ao estado "não configurado").
>    - Toggle **"Efeitos sonoros"** persistido em `bigPicture.sounds` (mesmo padrão `.toggle-console` + feedback "Salvo"/"Erro ao salvar" do toggle Kloud Games já existente na mesma tela).
> 2. **`GamepadSetup.tsx` — passo 1 (auto-mapping):** fullscreen próprio dentro do overlay (padrão: ocupa a área de conteúdo ou modal `fixed inset-0 z-[60]`) com o texto central: **"Pressione qualquer botão do controle"** (+ subtexto "Detectamos automaticamente o modelo e configuramos tudo para você") + animação pulsante de um gamepad (`animate-pulse-slow`) + botão **"Cancelar"**. Escuta contínua: `gamepadconnected` + polling leve (200 ms) em `navigator.getGamepads()`; no **primeiro** botão pressionado (`value > 0.5`): pega aquele gamepad, chama `buildAutoConfig(pad)` (T1), salva com `setGamepadConfig()` e avança para o passo 2. **Nenhum botão pressionado por 30 s?** Mostrar dica ("Não reconheceu seu controle? Tente USB ou outro cabo") sem travar.
> 3. **Passo 2 (resumo + ajuste):** "**Controle detectado:** <nome> · perfil <X>" + tabela/lista dos 12 mapeamentos (rótulo da ação → nome amigável do botão no perfil detectado) + botões **"Concluir"** e **"Ajustar manualmente"**.
> 4. **Ajuste manual:** lista das 12 ações, cada uma com o botão atual e um botão **"Remapear"**; ao clicar, a linha entra em estado de escuta ("Pressione o botão…", destaque neon); a próxima borda de botão no gamepad grava o índice; **Conflito** (índice já usado por outra ação): destaque vermelho na linha conflitante + mensagem "Este botão já está em <ação>" com opções **Substituir** (a ação antiga fica sem botão) / **Cancelar**. `Esc` cancela a escuta; `Enter` confirma. Botões `0–15` apenas (16 ignorado com aviso). Botão **"Restaurar padrão do perfil"** limpa o mapping customizado. **"Salvar"** persiste tudo de uma vez (`setGamepadConfig`) + toast "Configuração de controle salva"; fechar sem salvar descarta (com confirmação se houve alteração).
> 5. **Feedback sonoro** (se `bigPicture.sounds`): beep curto ao mapear, erro ao conflito.
> 6. **Mouse sempre funciona:** todo o fluxo é operável clicando (Remapear também aceita "capturar" via clique num seletor de índice de botão — dropdown simples `Botão 0…15` — para quem não tem controle no momento de configurar em mesa).
> 7. **Estados de erro:** nenhum gamepad presente no passo 1 → manter tela de espera com dica + botão "Cancelar"; `setGamepadConfig` falhar → mensagem amigável + opção de tentar de novo; config corrompida no store (normalize → null) → tratar como não configurada.
> 8. Não altere as outras seções das Configurações além do necessário para inserir a nova.

**Critérios de aceitação:**
- [ ] Fluxo completo: Configurações → Big Picture → Configurar controle → pressionar qualquer botão → config automática aplicada e listada corretamente (perfil certo para Xbox/PS/Switch)
- [ ] Ajuste manual: remapear uma ação, simular conflito (mesma tecla em duas ações) e confirmar o tratamento
- [ ] Sair/reiniciar o app: a seção mostra status/config persistidos
- [ ] "Apagar configuração" devolve o app ao estado "não configurado" (o gate da T6 volta a valer)
- [ ] Toggle "Efeitos sonoros" persiste e silencia os SFX do Big Picture na hora
- [ ] Build + `tsc` ok

**Validação:** `npm run dev` → Configurações → Big Picture → executar o fluxo com ao menos 1 controle real (ou emulado); verificar no `config.json` a chave `gamepad`; editar manualmente um botão, reiniciar e conferir; apagar a config e confirmar o estado inicial; testar todo o fluxo também só com mouse (dropdown de índice).

---

### [X] T6 — Gate de primeira execução: sem controle configurado → configuração antes da interface
**Objetivo:** se o usuário tentar entrar no Big Picture sem nenhum controle configurado, redirecioná-lo automaticamente para a tela de configuração antes de permitir a interface principal.

**Dependências:** T2 e T5 concluídas.
**Arquivos-alvo:** `src/renderer/src/App.tsx`, `src/renderer/src/components/BigPicture.tsx`, `src/renderer/src/components/GamepadSetup.tsx` (reuso).

**Prompt para o Agente:**
> Sua tarefa (T6) é implementar o **gate** da entrada no Big Picture.
> 1. No handler de entrada do Big Picture (botão da Sidebar/ação equivalente), **antes** de ativar o takeover, consulte `window.api.getGamepadConfig()`:
>    - `config` válida → entra direto (`setBigPicture('active')` → T7 toca a transição);
>    - `null` (ou erro) → `setBigPicture('setup')` e renderize o takeover já com a **tela de `GamepadSetup` embutida** e um cabeçalho amigável: **"Antes de usar o Big Picture…"** / "Nenhum controle configurado. Pressione qualquer botão do seu controle para detectar e configurar automaticamente — ou configure com o mouse." + botão discreto **"Voltar ao Hub"**.
> 2. **Após concluir o setup** (passo "Concluir" do `GamepadSetup`), não volte para o Hub: transição automática para a home do Big Picture (disparando a T7 se já implementada; senão, entrada direta). Se o usuário cancelar o setup no gate, volte ao Hub (`setBigPicture('hidden')` + `setFullScreen(false)`).
> 3. **Enquanto em `setup`, o restante do Big Picture fica inacessível** (rail/conteúdo não montados; só o setup + "Voltar ao Hub").
> 4. **O mesmo gate protege qualquer outro caminho de entrada** (ex.: deep-link futuro `?big-picture=1`, se existir) — centralize a decisão num único ponto (`enterBigPicture()` em `App.tsx`) para não duplicar a regra.
> 5. `?first-run=1`: o botão de entrada nem aparece (T3); se acionado por outro caminho, recusa silenciosa com log.
> 6. Caso o store esteja corrompido (`getGamepadConfig` → `{ ok: false }`), trate como não configurado (segura: configura antes, nunca libera sem config).
> 7. Não altere a 1ª execução (`FirstRunInstall`) nem o gate de `launchKloudOnStart`.

**Critérios de aceitação:**
- [ ] Com `gamepad` ausente no store: entrar no Big Picture **sempre** abre o setup primeiro; a home é inalcançável antes de concluir
- [ ] Concluir o setup leva direto ao Big Picture (sem passar pelo Hub); "Voltar ao Hub" desiste e restaura o shell
- [ ] Com config existente: entrada direta, sem setup
- [ ] Config apagada pelas Configurações → próxima entrada cai no gate novamente
- [ ] Store corrompido manualmente (`"gamepad": 123`) → gate assume "não configurado" sem crash
- [ ] Build + `tsc` ok

**Validação:** em `%APPDATA%\kolnd-hub\config.json`, renomeie `gamepad` (backup antes) e reinicie: clique em Big Picture e confira o redirecionamento; complete o setup e confirme a entrada automática; repita apagando a config pelas telas; restaure o backup.

---

## Fase 3: Transição cinematográfica

### [X] T7 — Animação de entrada: escurecimento, raio, choque elétrico e onda de energia
**Objetivo:** animação cinematográfica ao entrar no Big Picture: a tela escurece → raio cai do topo ao centro → impacto com choque elétrico intenso → onda de energia radial → o fundo se transforma para o visual do Big Picture conforme a onda se expande → efeitos decaem → interface exibida pronta.

**Dependências:** T3 concluída (idealmente T4/T6 já na fila).
**Arquivos-alvo:** novo `src/renderer/src/components/BigPictureTransition.tsx`, `src/renderer/src/components/BigPicture.tsx` (orquestração), `src/renderer/src/lib/sfx.ts` (sons `zap`/`impact`/`wave`), `src/renderer/src/index.css` (keyframes se necessário).

**Prompt para o Agente:**
> Sua tarefa (T7) é a **transição cinematográfica** do Hub para o Big Picture. Implemente como um componente `BigPictureTransition` montado durante o estado `transitioning` (entre o gate T6/T3 e a home pronta).
> 1. **Máquina de estados por timestamps** (rAF único, `performance.now()`), fases com início/duração relativos:
>    - **Fase 1 — Escurecimento** (0–400 ms): overlay preto `opacity 0 → 0.85` (CSS transition); aba/shell por baixo "morre" visualmente (sem desmontar ainda).
>    - **Fase 2 — Raio** (400–1000 ms): `<canvas>` fullscreen (devicePixelRatio-aware, resize no mount) desenha o raio do topo **centro** até o **centro da tela**: polilinha irregular (8–14 segmentos, jitter horizontal decrescente perto do centro) com `strokeStyle` branco-violeta + `shadowBlur` grande (neon cyan/purple); **flicker**: redesenhar a cada 2–3 frames com seeds diferentes + 2 passadas (núcleo branco grosso + halo difuso). Tom `zap` do `sfx.ts` no início (se sons ativos).
>    - **Fase 3 — Impacto / choque elétrico** (1000–1350 ms): flash branco do ponto central (radial gradient expandindo e morrendo) + **anel de choque** com 3 anéis concêntricos desalinhados (stroke com blur) + 24–36 **faíscas** (partículas com velocidade radial aleatória, gravidade leve, fade) + arcos laterais (3–5 raios curtos partindo do centro, vida ~250 ms). SFX `impact` (ruído + grave).
>    - **Fase 4 — Onda radial** (1100–1900 ms, sobreposta): 1–2 frentes circulares expandindo do centro até cobrir a tela (raio até `hypot(w, h) / 2 + 100`), desenhadas no canvas com `shadowBlur` e leve cromatismo (borda cyan, núcleo branco); dentro do raio, fade elétrico extra (partículas adensadas na borda da frente).
>    - **Fase 5 — Revelação do fundo do Big Picture** (1000–2000 ms, em paralelo à fase 4): o fundo do Big Picture (gradient-gaming + glows) vive numa camada **abaixo** do canvas e **acima** do shell, com `mask-image: radial-gradient(circle at 50% 50%, black R px, transparent R px)` — `R` anima de ~120 px até `maxRadius` (um pouco além da diagonal/2) **seguindo a mesma curva da frente de onda** (mesmo rAF, mesmo timestamp). É isso que "transforma o fundo gradualmente" conforme o choque se espalha — sem re-render de layout, só a variável do mask.
>    - **Fase 6 — Decaimento** (1900–2600 ms): raio zera (já passou), anéis/faíscas com `alpha` decaindo para 0, overlay residual some (0.85 → 0.15) revelando a home do Big Picture **montada por baixo** (renderize a home escondida durante a transição — `visibility: hidden`/`opacity 0` até a fase 7 — para ela estar pronta de verdade, sem flash de layout).
>    - **Fase 7 — Pronto** (2600–2900 ms): canvas desmonta, rail/conteúdo do Big Picture fazem fade/slide-in sutil (framer-motion, `duration: 0.4`), `bigPicture` → `'active'`; SFX `open` (acordes suaves).
> 2. **Performance:** um único canvas e um único rAF; zero `setState` por frame (progresso em refs; só 2–3 `setState` de fase); sem `box-shadow` gigante animado fora do canvas; testar em 1080p e 4K (canvas escala por DPR).
> 3. **Skip:** qualquer botão de gamepad/clique/Esc/Enter **pula** para a fase 7 (finaliza imediatamente). Documentar no código.
> 4. **`prefers-reduced-motion: reduce`:** pular direto para um fade de 250 ms (sem raio/onda).
> 5. **Falha de canvas/WebGL ausente:** `try/catch` em volta da criação do contexto → fallback silencioso para fade (nunca bloquear a entrada).
> 6. **Saída (sair do Big Picture) não usa esta animação** — apenas fade curto (200 ms) de volta ao Hub.
> 7. Se `bigPicture.sounds` estiver ligado, os tons acompanham; senão, silêncio total durante a transição.

**Critérios de aceitação:**
- [ ] Entrada no Big Picture exibindo, em ordem: escurecimento → raio caindo no centro → flash/choque no impacto → onda radial expandindo → fundo do Big Picture revelado atrás da onda → efeitos desvanecendo → home interativa
- [ ] Transição completa sem travadas perceptíveis (≈ ≤ 3,5 s; 60 fps em máquina alvo; sem long tasks > 100 ms no devtools)
- [ ] Skip por qualquer input funciona em qualquer fase
- [ ] `prefers-reduced-motion` reduz para fade; falha de canvas não impede a entrada
- [ ] Sons respeitam o toggle "Efeitos sonoros"
- [ ] Build + `tsc` + `npm test` ok

**Validação:** `npm run dev` → entrar no Big Picture com sons ligados e desligados; pular a animação no meio com um botão do controle; medir com o Performance do devtools (sem drops > 100 ms); testar com `prefers-reduced-motion` emulado; testar em resolução de TV (ajustar zoom/stretch a 1920×1080 e 3840×2160) — a onda deve cobrir o canto mais distante.

---

## Fase 4: Robustez e validação final

### [X] T8 — Hot connect/disconnect, responsividade, acessibilidade e passagem final
**Objetivo:** robustez de sessão longa (controle desconecta/reconecta ao vivo), layout realmente responsivo a TVs/monitores grandes e acessibilidade — fechando os requisitos técnicos e os critérios de aceitação globais.

**Dependências:** T3 a T7 concluídas.
**Arquivos-alvo:** `src/renderer/src/hooks/useGamepad.ts`, `BigPicture.tsx`, `BigPictureFocus.tsx`, `index.css`, `App.tsx`, testes conforme necessário.

**Prompt para o Agente:**
> Sua tarefa (T8) é endurecer o Big Picture para uso real em sala de TV.
> 1. **Hot connect/disconnect em tempo real:**
>    - Escutar `gamepadconnected`/`gamepaddisconnected` **e** detectar sumiço no loop de polling (índice presente antes, ausente agora).
>    - Ao desconectar dentro do Big Picture: overlay central **"Controle desconectado"** + "Reconecte o controle ou use o mouse" + spinner; rail/conteúdo ficam visíveis mas inertes ao gamepad; o mouse segue funcionando. Some sozinho ao reconectar.
>    - Reconectado com **mesmo** `id` → retoma sem avisos. Reconectado com **outro modelo** → manter o mapeamento salvo (índices 0–15 são posicionais) e exibir aviso não-bloqueante: "Controle diferente detectado — os botões podem ter rótulos diferentes. Revise em Configurações → Big Picture."
>    - Conectado **durante o gate/setup** → detectar e exigir o "pressione qualquer botão" normalmente.
>    - Nenhum controle presente na home **e** mouse parado → dica discreta no canto inferior ("Conecte um controle para navegação por botão"), some ao conectar.
> 2. **Responsividade (telas grandes e além):** testar/ajustar de 1280×800 e 1920×1080 até 3840×2160 (100–200% DPI): rail escala (`w-64` → `w-80`), cards crescem (`minmax` fluido via `clamp()` ou breakpoints `xl:`/`2xl:`), tipografia mínima `text-xl` em qualquer elemento interativo, alvos de clique/foco ≥ 48 px. Sem scroll horizontal em nenhuma resolução alvo.
> 3. **Acessibilidade e legibilidade TV:** contraste AA nos textos/foco (anel neon sobre fundos escuros já passa — validar o secundário), foco **sempre** visível (nunca só `:hover`), `aria-selected`/`role="option"` nos itens do rail e cards, ordem de tabulação lógica para teclado de cortesia, `prefers-reduced-motion` respeitado em todas as animações do Big Picture, nenhum texto abaixo de 16 px em telas ≥ 1920 px.
> 4. **Vazamentos e limpeza:** desmontar Big Picture remove listeners (`gamepadconnected/disconnected`, keydown global, rAF do polling, intervalo do relógio); reentrar no Big Picture remonta tudo do zero sem estado fantasma; trocar de controle não duplica loops.
> 5. **Texto de saída coerente:** overlay "Sair do Big Picture?" (B na raiz/Esc) menciona explicitamente voltar ao Hub normal.
> 6. **Revisão final guiada pelos requisitos:** rode o checklist de **Critérios de aceitação (globais)** abaixo e corrija tudo que falhar **nesta** tarefa; não deixe para "depois".
> 7. Atualize o `README.md` (seção do Hub) com um parágrafo curto do modo Big Picture (como entrar, configurar controle, sair) e liste a nova migração `'1.4.0'` onde as outras são citadas.

**Critérios de aceitação:**
- [ ] Desconectar o controle no meio da navegação → aviso aparece na hora; reconectar → aviso some e o controle volta a funcionar (mesmo modelo: silencioso; outro modelo: aviso de rótulos)
- [ ] Nenhum estado zumbi ao sair/reentrar 5× seguidas; memória estável no devtools
- [ ] Layout impecável em 1280×800, 1920×1080 e 3840×2160 (sem scroll horizontal, alvos ≥ 48 px)
- [ ] Navegação completa por gamepad com o **controle fisicamente desconectado**: impossível; com mouse: tudo funciona
- [ ] Contraste/foco/aria verificados (axe DevTools ou inspeção manual guiada)
- [ ] README atualizado; build + `tsc` + `npm test` ok

**Validação:** sessão de 30 min simulando uso real de TV: 2 controles diferentes, desconexões durante transição/navegação/setup, resize da janela entre os extremos, navegação 100% gamepad e 100% mouse, e mix das duas. Rodar `npm run lint` também.

---

## Riscos e armadilhas conhecidas (leia antes de começar)

- **Gamepad API é poll-based:** não há evento "botão pressionado" confiável — tudo sai do loop rAF. Não registre handlers de input duplicados por tela; centralize no `useGamepad` e consuma por contexto.
- **`Gamepad.id` varia por SO/driver:** Windows/Chromium costuma incluir `Vendor: 045e Product: 028e`, mas há drivers que só emitem o hex Mozilla (`030000005e…`) — por isso as duas estratégias de parse na T1. Nunca exija match exato de string.
- **Switch Pro com troca de botões:** o perfil `switch` troca `confirm`/`back` (1/0) para respeitar a convenção Nintendo (A físico = confirmar). Se um usuário de Switch preferir o padrão Xbox, o ajuste manual resolve — documentar na UI.
- **Botão Guide/Home (índice 16):** muitos drivers não o reportam ou o capturam (abre o menu do sistema/Xbox) — por isso ele é **excluído** do mapeamento (T2 rejeita índice 16).
- **Conflito de mapeamento:** substituir vs. bloquear — a T5 escolhe substituir/limpar com aviso; pular essa validação gera "dois comandos no mesmo botão" silencioso, bug clássico.
- **`setFullScreen` ≠ maximize:** não use `maximize()`; fullscreen muda o frame e o cursor default. Teste Alt+F4 e a restauração do tamanho/posição da janela (o Electron guarda bounds? Não — anote `getBounds()` antes e restaure no sair se alguma aresta aparecer).
- **Performance da animação (T7):** se o canvas + mask CSS ainda engasgar em 4K, reduza DPR do canvas para 1 no transição e/ou número de partículas. Nunca deixe a transição depender de `setState` por frame.
- **Máscara CSS `mask-image` radial:** animar `mask-image` diretamente com rAF via variável CSS é OK; **não** anime `background` grandão nem `filter: blur` em elementos fullscreen — caro.
- **Foco espacial:** `getBoundingClientRect()` por frame é caro se chamado em massa — compute só quando a direção é pressionada (e no mount/resize), não a cada frame.
- **electron-store + ajv:** chave `gamepad: null` exige `type: ['object','null']` no schema; um `type: 'object'` simples quebra a leitura quando o valor é null. Migração `'1.4.0'` é obrigatória — store 1.3.0 sem ela abriria sem defaults em instalações antigas.
- **Preload duplo:** qualquer método novo precisa existir **e** ser tipado nos dois arquivos (`index.ts` e `index.d.ts`) — erro clássico de `window.api.xxx is not a function`.
- **`?first-run=1`:** o Big Picture não pode aparecer nem antes nem durante a 1ª execução (P12).
- **Escopo:** não mexa em `kloud-games`, Mark LVI, winget, tray ou no fluxo de `firstRun`. Não criar `Page` nova (`'bigpicture'`) — o Big Picture é takeover, não página.

---

## Critérios de aceitação globais (o modo inteiro)

- [ ] Todo o modo Big Picture utilizável **apenas com gamepad** (entrar, navegar, lançar jogos/ferramentas, abrir configuração, sair)
- [ ] Todas as funcionalidades continuam operáveis por **mouse** (clique, hover, foco visível)
- [ ] O **mapeamento automático** funciona ao pressionar qualquer botão inicial (detecta modelo e aplica perfil)
- [ ] Usuário **sem controle configurado** é redirecionado para a configuração antes da interface principal do Big Picture
- [ ] A **animação de transição** executa as 7 fases sem travamentos perceptíveis e conclui a entrada de forma fluida
- [ ] As configurações de controle **permanecem salvas entre sessões** (`electron-store`, migração `'1.4.0'`)
- [ ] Conexão/desconexão de controles **em tempo real** tratada com overlay e recuperação
- [ ] Compatibilidade verificada com **Xbox, PlayStation, Switch Pro e gamepads genéricos** (Gamepad API)
- [ ] Interface responsiva e legível em telas grandes (1280×800 → 3840×2160), acessível (contraste, foco, aria)
- [ ] Build + `tsc` (node e web) + `npm test` ok

---

## Validação final de entrega (smoke test)

Antes de considerar o conjunto concluído:

- [ ] `npm run build` limpo e `npx tsc --noEmit` nos dois projetos ok; `npm test` verde; `npm run lint` ok
- [ ] 1ª execução intacta (`?first-run=1`): sem botão Big Picture, sem regressões
- [ ] Entrada no Big Picture com sons off/on; transição fluida; skip funciona; `prefers-reduced-motion` ok
- [ ] Gate completo num perfil limpo (store sem `gamepad`): entrar → setup → auto-mapping por botão → home → sair → reentrar (desta vez direto)
- [ ] Troca de controle em tempo real (desconectar no meio do caminho; reconectar outro modelo)
- [ ] Apagar config pelas Configurações → reentrar → gate de novo; ajustar manualmente um botão; conflito tratado
- [ ] Lançar 1 jogo (via `games:get`/`games:launch`) e 1 ferramenta de dentro do Big Picture; contador de apps ativos do Hub inalterado ao sair
- [ ] `git status` sem arquivos fora do escopo; README atualizado

---

## Histórico

- **v1 (este arquivo)** — task criada a partir do spec do modo Big Picture (Steam Big Picture-like): shell fullscreen, navegação espacial por gamepad com repetição e SFX, seção "Big Picture" nas Configurações, mapeamento manual + automático por "pressione qualquer botão" (perfis Xbox/PlayStation/Switch/genérico), gate de primeira execução para usuários sem controle, persistência `electron-store` (`gamepad`/`bigPicture`, migração `'1.4.0'`), hot connect/disconnect, animação cinematográfica de entrada em 7 fases, e checklist de validação final.
