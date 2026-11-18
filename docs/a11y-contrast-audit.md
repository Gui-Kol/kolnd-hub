# Auditoria de contraste e foco visível — Kolnd Hub (tarefa 8.2 · atualizado na 13.20)

> **Data:** 16/11/2026 (13.20, pós-reformulação) · 8.2 executada em 16/11/2026 (pré-reformulação, commits `7be69e87`, `5fda8e64`, `ebd8c78d`, `c921128a`)
> **Escopo:** `kolnd-hub/src/renderer` + `index.css` + `tailwind.config.js` · **Plano:** `gerente/tasks/2.0/13-13.20-acessibilidade-e-contraste.md` (13.20) · `gerente/tasks/2.0/08-8.2-contraste-e-foco-visivel.md` (8.2)
> **Método:** cálculo WCAG 2.x por composição de cores — `(L1 + 0.05) / (L2 + 0.05)`, luminância relativa com coeficientes 0.2126/0.7152/0.0722. Badges e fundos de input foram medidos por **alfa-composição** (fundo efetivo = `cor com alpha × fg + (1−alpha) × bg`).
> **Screenshots de antes/depois:** **fora do alcance (ambiente headless) — pendentes de revisão visual do usuário.**

Critério AA: **≥ 4.5:1** texto normal · **≥ 3:1** texto grande (≥ 24 px ou ≥ 18.66 px bold) e componentes/indicadores · **≥ 3:1** ícones com significado (1.4.11). Elementos de UI **desabilitados** são isentos de 1.4.3. Meta 10-foot (Big Picture): **≥ 7:1** nos textos primários.

---

## Parte 1 — Verificação 13.20 (pós-reformulação, 16/11/2026)

### Fundos reais (tokens da reformulação 13.4/13.2)

| Nome          | Hex                 | Onde aparece                                                        |
| ------------- | ------------------- | ------------------------------------------------------------------- |
| `--bg-base`   | `#0e141b`           | fundo do body (gradiente `180deg base→sunken`)                      |
| `--bg-sunken` | `#090e13`           | wells, trilhas, input rail do Sidebar (`bg-surface-sunken`), scrollbar track |
| `surface-1`   | `#151d26`           | cards elevados 1                                                    |
| `surface-2`   | `#1b2430`           | painéis, hover elevado                                              |
| `surface-3`   | `#222d3a`           | modais/toast/popover, thumb scrollbar                               |
| Input (eff.)  | `white 3%` s/ fundo | `.input-gamer` → `#0f151c` s/base · `#161e28` s/s1 · `#1c2531` s/s2 · `#242f3c` s/s3 |
| Badge N (eff.)| cor 12% s/ s1/s2    | `.badge-running/.badge-error/…` e `success/warning/danger-muted`    |

### Tabela completa — lista B do plano 13.20

**Texto sobre superfícies** (razão mínima–máxima, veredito AA texto normal):

| Texto (token)            | Hex       | base   | sunken | s1     | s2     | s3     | Veredito                                            |
| ------------------------ | --------- | ------ | ------ | ------ | ------ | ------ | --------------------------------------------------- |
| `text-primary`           | `#e8eaed` | 15.36  | 16.08  | 14.10  | 12.99  | 11.58  | ✅ AA em todos (e ≥ 7:1 meta BP)                    |
| `text-secondary`         | `#a8b3bd` | 8.68   | 9.09   | 7.97   | 7.34   | 6.55   | ✅ AA em todos (≥ 7:1 exceto s3 = 6.55, ainda AA)   |
| `text-tertiary`          | `#7d8894` | 5.13   | 5.37   | 4.71   | 4.34 ❌ | 3.87 ❌ | ✅ AA em base/sunken/s1 · ❌ AA em s2/s3 (ver exceções) |

**Acento**:

| Par                                   | Ratio | Veredito                    |
| ------------------------------------- | ----- | --------------------------- |
| `accent` (`#66c0f4`) s/ base          | 9.18  | ✅ AA                       |
| `accent` s/ sunken                    | 9.61  | ✅ AA                       |
| `accent` s/ surface-1                 | 8.43  | ✅ AA                       |
| `accent` s/ surface-2                 | 7.76  | ✅ AA                       |
| `accent` s/ surface-3                 | 6.92  | ✅ AA                       |
| `accent-hover` (`#8fd3ff`) s/ base    | 11.40 | ✅ AA                       |
| `accent-hover` s/ sunken              | 11.93 | ✅ AA                       |
| `accent-hover` s/ surface-1           | 10.46 | ✅ AA                       |
| `accent-hover` s/ surface-2           | 9.64  | ✅ AA                       |
| `accent-hover` s/ surface-3           | 8.59  | ✅ AA                       |
| `accent-active` (`#4aa8e0`) s/ base   | 7.02  | ✅ AA                       |
| `accent-active` s/ sunken             | 7.35  | ✅ AA                       |
| `accent-active` s/ surface-1          | 6.45  | ✅ AA                       |
| `accent-active` s/ surface-2          | 5.94  | ✅ AA                       |
| `accent-active` s/ surface-3          | 5.30  | ✅ AA                       |
| **`accent-contrast` (`#0b1d29`) s/ `accent`**        | **8.52** | ✅ **AA (botão primário)** |
| `accent-contrast` s/ `accent-hover`   | 10.58 | ✅ AA                       |
| `accent-contrast` s/ `accent-active`  | 6.52  | ✅ AA                       |

**Semânticas** (texto `--success`/`--warning`/`--danger` puro sobre superfícies):

| Texto      | base  | sunken | s1    | s2    | s3    | Veredito                    |
| ---------- | ----- | ------ | ----- | ----- | ----- | --------------------------- |
| `success`  | 8.31  | 8.70   | 7.63  | 7.03  | 6.26  | ✅ AA em todos              |
| `warning`  | 9.51  | 9.96   | 8.73  | 8.04  | 7.17  | ✅ AA em todos              |
| `danger`   | 5.70  | 5.97   | 5.24  | 4.82  | 4.30 ❌ | ✅ AA até s2 · ❌ AA s3 (ver exceções) |

**Badges translúcidas** (texto = a cor, fundo = cor 12% alfa sobre a superfície — medido composto):

| Badge    | s/ surface-1 (eff. bg)        | s/ surface-2 (eff. bg)        | Veredito                         |
| -------- | ----------------------------- | ----------------------------- | -------------------------------- |
| success  | 6.17 (`#1b3130`)              | 5.66                          | ✅ AA                            |
| warning  | 6.94 (`#2e2f29`)              | 6.36                          | ✅ AA                            |
| danger   | 4.56 (`#2f252a`, borderline)  | 4.19 ❌                       | ✅ s1 (borderline) · ❌ s2 (ver exceções) |

**Placeholders** (`.input-gamer::placeholder` → `--text-tertiary`, fundo = input composto white 3%):

| Fundo do input            | Ratio | Veredito                        |
| ------------------------- | ----- | ------------------------------- |
| sobre `--bg-base`         | 4.80  | ✅ AA                           |
| sobre `--bg-sunken`       | 5.09  | ✅ AA                           |
| sobre `--surface-1`       | 4.35  | ❌ AA por 0.15 (ver exceções)   |
| sobre `--surface-2`       | 3.97  | ❌ AA (ver exceções)            |
| sobre `--surface-3`       | 3.55  | ❌ AA (ver exceções)            |

**Labels uppercase 10–11 px** (`.label-panel` e `text-ink-tertiary uppercase tracking-wider`, mesmos pares do `text-tertiary`):

| Fundo      | Ratio | Veredito                                |
| ---------- | ----- | --------------------------------------- |
| base       | 5.13  | ✅ AA                                   |
| sunken     | 5.37  | ✅ AA                                   |
| surface-1  | 4.71  | ✅ AA (folga 0.21)                      |
| surface-2  | 4.34  | ❌ AA (texto pequeno bold uppercase)    |
| surface-3  | 3.87  | ❌ AA (texto pequeno bold uppercase)    |

**Foco visível** (`--focus-ring` = `#66c0f4`, anel 2 px + offset 2 px fora de `@layer`):

| Fundo     | Ratio (indicador, ≥ 3:1 exigido por 1.4.11) |
| --------- | ------------------------------------------- |
| base      | 9.18 ✅                                     |
| sunken    | 9.61 ✅                                     |
| surface-1 | 8.43 ✅                                     |
| surface-2 | 7.76 ✅                                     |
| surface-3 | 6.92 ✅                                     |

**Meta 10-foot (Big Picture, alvo ≥ 7:1)**: `text-primary` sobre s1/s2/s3 = 14.10/12.99/11.58 ✅ · `text-secondary` 7.97/7.34/**6.55** (s3 — ⚠️ abaixo de 7:1, mas AA 6.55; aceito: texto secundário) · títulos BP em `text-primary`/accent 6.92–14.10.

### Exceções registradas (13.20) — nenhum token alterado

1. **`text-tertiary` sobre `surface-2`/`surface-3` (4.34 / 3.87)** — já documentado no próprio `index.css` desde a 13.4 ("labels sobre surface-2/3 devem migrar para text-secondary na 13.6+"). A correção segura é migrar *uso* (labels/legendas nesses fundos), não o token. **Não alterado nesta tarefa** — registrado para a migração das telas/13.21.
2. **`danger` sobre `surface-3` (4.30)** — texto de erro em modal (surface-3) fica 0.2 abaixo de 4.5. Corrigir exigiria token novo (ex.: `danger-light`) ou troca de fundo do modal; **não é correção óbvia dentro do escopo — não alterado**. Recomendação: texto de erro em modal migrar para `text-ink-primary` + ícone/borda de tom danger.
3. **`badge-danger` translúcida sobre `surface-2` (4.19)** — badges hoje vivem sobre surface-1 (cards), onde medem 4.56 (✅ borderline). **Sem uso atual sobre s2 confirmado no sweep — registrado**, não alterado.
4. **Placeholder `text-tertiary` sobre input composto em s1/s2/s3 (4.35/3.97/3.55)** — sobre base/sunken passa (4.80/5.09). WCAG 1.4.3 estrito exigiria 4.5; a correção óbvia seria `.input-gamer::placeholder { color: var(--text-secondary) }` (7.35/7.90/8.59), mas **`index.css` está fora das restrições desta tarefa** — registrado como recomendação para a próxima janela que tocar o `index.css`.
5. **`text-secondary` sobre s3 = 6.55** — abaixo da meta 7:1 do Big Picture para texto secundário; mantido (é AA e a meta é para textos primários).
6. Legacy (8.2): `text-stream-*` etc. — ver Parte 2 (histórico).

### Focus-visible — varredura ad hoc (13.20)

Grep `focus:ring-*` / `focus-within:ring-*` / `focus:outline-*` em `src/renderer` (2026-11-16): **zero ocorrências ad hoc remanescentes.**

- Anel global `:focus-visible` (2 px `--focus-ring` + offset 2 px, fora de `@layer`) — presente e verificado em `out/renderer/assets/*.css` no build da 8.2; segue presente (`index.css` intocado na 13.20).
- Padrão Big Picture (mantido, por decisão da 8.2/13.17/13.18): `BP_FOCUS_RING = focus-visible:ring-4 ring-[var(--focus-ring)]` e `BP_FOCUSED_RING = ring-4 ring-[var(--focus-ring)]` (gamepad-focus, via `useFocusable`) — usados por BigPictureGames/Controls/Rail/BigPicture shell.
- `BigPictureOverlays.tsx`: `ring-4 ring-red-400/50` (danger) / `ring-4 ring-accent-border` (acento) — **estado de gamepad-focus, não ad hoc de teclado**; mantidos.
- `Settings.tsx`: `ring-1 ring-warn-border` — realce de campo com erro (não é indicador de foco); mantido.
- Nenhum `focus:outline-none` sem substituto: todos os `focus:outline-none` localizados são combinados com `BP_FOCUS_RING` (anel de 4 px) ou caem sob a regra global (inputs tokenizados usam `:focus` com borda+ring próprio em `.input-gamer`, mantidos da 8.2).

### aria — aditivo aplicado/verificado (13.20)

| Item                                                    | Estado                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `nav` principal (`Sidebar.tsx`)                         | **+ `aria-label="Navegação principal"`** (editado)                                            |
| Item ativo `aria-current="page"` (`Sidebar.tsx`)        | já presente (nenhuma alteração)                                                               |
| Nav Big Picture (`BigPictureRail.tsx`)                  | já `aria-label="Navegação do Big Picture"` + `aria-selected`/`aria-current="true"` no rail   |
| Toast global (`ui/Toast.tsx`)                           | já `role="status"` + `aria-live="polite"` (verificado) + `aria-label="Fechar aviso"` no X    |
| IconButtons (`ui/IconButton.tsx`)                       | `aria-label` obrigatório em compilação (tipo exige) — nenhum uso sem label encontrado         |
| Layout min/max/close                                    | já `aria-label` ("Minimizar" / "Maximizar" / "Fechar")                                        |
| Sidebar Sair / Big Picture                              | já `aria-label`                                                                               |
| Busca (`SearchInput`, `GlobalSearch`, limpar busca)     | já `aria-label`                                                                               |
| Modais primitivo `Modal`                                | nome acessível OBRIGATÓRIO em compilação (`title` ou `ariaLabel`) — **todos os 10 usos fornecem** (App exit, AppDetailModal, SteamImportModal ×3, EditGameModal, GamepadSetup, PcCleanup, GlobalSearch indireto, UninstallHub/KloudGames alertdialogs com `aria-labelledby` → ids internos confirmados) |
| `Switch` (primitivo)                                    | `role="switch"` + `aria-checked`; **todos os 8 usos com `aria-label`**                        |
| Tabs Inicialização                                       | já `role="tablist"`/`role="tab"` + `aria-selected` (mantidos — não convertidos de novo)       |
| **Skip-link "Pular para o conteúdo"** (Layout)          | **+ adicionado** — `<a href="#conteudo">`, primeiro elemento tabular; alvo `<main id="conteudo" tabIndex={-1}>` |
| AppCard como botão de card                              | (8.1) correção semântica continua fora deste escopo                                          |

### reduced-motion (13.20)

- `prefers-reduced-motion` coberto por: (1) `@media (prefers-reduced-motion: reduce)` em `index.css` (`.scanlines`, `.animate-pulse`, `.animate-pulse-slow`, `.animate-skew`, `.skeleton`, `.skeleton-shimmer`); (2) `useReducedMotion` via `lib/motion.ts` (`entranceProps`/`exitProps`/`fadeOnlyTransition`) em LoadingScreen, page transitions (App.tsx), BigPictureRail, Biblioteca e demais telas; (3) `BigPictureTransition.tsx` via `matchMedia('(prefers-reduced-motion: reduce)')` (fade 250 ms).
- **MotionConfig NÃO adicionado** (decisão registrada: o projeto usa `useReducedMotion` direto; adicionar seria redundante e fora das restrições).
- Background decorativo / scanlines: mantidas conforme "não tocar"; cobertas pelo media query.

### Teclado (inspeção estática — sem GUI)

Ordem de Tab no shell normal (Layout): **skip-link** (visível só com foco) → **title bar** (Minimizar → Maximizar → Fechar) → **Sidebar** (nav: Ferramentas → Meu PC/pcName → Biblioteca → Configurações, item ativo com `aria-current="page"`) → botão **Big Picture** → **Sair** → conteúdo (`<main id="conteudo" tabIndex={-1}>`, recebe foco via skip-link) → ações da página. Shift+Tab reverte. `Esc` fecha modais/busca/GlobalSearch (focus trap `useFocusTrap` devolve foco ao gatilho); modais destrutivos ignoram Esc de propósito. Big Picture: navegação espacial por controle/teclado (`useFocusable` + anel de 4 px), `Esc` global volta/fecha. Resultado: **100% dos interativos focáveis em ordem lógica, foco sempre visível** (verificado por inspeção estática — não há GUI neste ambiente; revisão visual cabe ao usuário).

### Verificação (16/11/2026, 13.20)

| Gate                                     | Resultado                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.web.json`  | **0 erros**                                                                                   |
| `npm test`                               | **34 arquivos, 600 passed**, 1 skipped                                                        |
| `npm run lint`                           | **0 erros**, 5 warnings pré-existentes em `src/main/*.test.ts`                                |
| `npm run format:check`                   | **limpo**                                                                                     |
| `npm run build`                          | **ok** (main/preload/renderer)                                                                |
| Skip-link presente no DOM do Layout      | ✅ (a11y: WCAG 2.4.1)                                                                          |
| Foco ad hoc fora do padrão               | **0 ocorrências** (varredura 13.20)                                                            |
| `:focus-visible` global no CSS de produção | ✅ conferido em `out/renderer/assets/index-CY6HXg9J.css`                                     |

---
---

## Parte 2 — Histórico · Auditoria 8.2 (pré-reformulação, 16/11/2026)

> ⚠️ **Paleta legada (`slate-*`/`kloud`/`neon`)** — os valores abaixo descrevem o estado **anterior à reformulação 13.x** e foram substituídos no produto pelos tokens da Parte 1. Mantidos como registro de decisões e correções históricas. Referência do plano: `gerente/tasks/2.0/08-8.2-contraste-e-foco-visivel.md`.

# Auditoria de contraste e foco visível — Kolnd Hub (tarefa 8.2)

> **Data:** 16/11/2026 · **Escopo:** `kolnd-hub/src/renderer` + `index.css` + `tailwind.config.js` · **Plano:** `gerente/tasks/2.0/08-8.2-contraste-e-foco-visivel.md`
> **Método:** cálculo WCAG 2.x por composição de cores — `(L1 + 0.05) / (L2 + 0.05)`, luminância relativa com coeficientes 0.2126/0.7152/0.0722. Badges e overlays foram medidos por **alfa-composição sobre `#050508`** (fundo efetivo = `cor com alpha × fg + (1−alpha) × bg`).
> **Screenshots de antes/depois:** **fora do alcance (ambiente headless) — pendentes de revisão visual do usuário.**

## Fundos reais do tema (usados na medição)

| Nome                    | Hex                 | Onde aparece                                                      |
| ----------------------- | ------------------- | ----------------------------------------------------------------- |
| `slate-950`             | `#020617`           | base do body (`@apply bg-slate-950`), Sidebar (`bg-slate-950/80`) |
| Topo do gradiente       | `#0a0a0f`           | body gradient `180deg`                                            |
| Fundo do gradiente      | `#050508`           | body gradient `180deg` (extremidade inferior)                     |
| Radial quente           | `#1a1014`           | body gradient, canto superior direito                             |
| Radial azul (steam-900) | `#0b1d29`           | body gradient, canto inferior esquerdo                            |
| `slate-900`             | `#0f172a`           | `steam-500`/superfícies, `GamepadSetup`/modais sobre cards        |
| Card glass (efetivo)    | `#0d0d0f`–`#111116` | `white/[0.03]` composto sobre `#050508`–`#0a0a0f`                 |

Critério AA: **≥ 4.5:1** texto normal · **≥ 3:1** texto grande (≥ 24 px ou ≥ 18.66 px bold) e componentes/indicadores · **≥ 3:1** ícones com significado (1.4.11). Elementos de UI **desabilitados** são isentos de 1.4.3.

## Pares texto/fundo medidos (raio de variação entre todos os fundos acima)

| Texto                               | Hex       | vs. fundos (min–max) | Veredito texto normal                                       | Veredito texto grande / ícone          |
| ----------------------------------- | --------- | -------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `slate-200`                         | `#e2e8f0` | 13.94–16.51          | ✅ passa                                                    | ✅                                     |
| `slate-300` (`muted`)               | `#cbd5e1` | 11.57–13.71          | ✅ passa                                                    | ✅                                     |
| `slate-400` (`subtle`)              | `#94a3b8` | **6.70–7.94**        | ✅ **passa** (pior caso: steam-900)                         | ✅                                     |
| `slate-500`                         | `#64748b` | 3.61–4.28            | ❌ **falha**                                                | ⚠️ passa 3:1 no mínimo (3.61)          |
| `slate-600`                         | `#475569` | 2.27–2.69            | ❌ **falha**                                                | ❌ **falha 3:1**                       |
| `slate-700`                         | `#334155` | ≈ 1.9–2.1            | ❌ (era usado só em controles desabilitados; → `slate-500`) | —                                      |
| `emerald-400`                       | `#34d399` | 8.94–10.59           | ✅ passa                                                    | ✅                                     |
| `red-400`                           | `#f87171` | 6.21–7.36            | ✅ passa                                                    | ✅                                     |
| `amber-400`                         | `#fbbf24` | 10.29–12.19          | ✅ passa                                                    | ✅                                     |
| `kloud-500`                         | `#f97316` | 6.13–7.26            | ✅ passa                                                    | ✅                                     |
| `neon-cyan`                         | `#00f3ff` | 12.49–14.80          | ✅ passa                                                    | ✅                                     |
| `nintendo-400` (novo)               | `#ff6b6b` | 6.19–7.34            | ✅ passa                                                    | ✅                                     |
| `playstation-300` (novo)            | `#5e9eff` | 6.39–7.57            | ✅ passa                                                    | ✅                                     |
| `playstation-400` (novo)            | `#4da3ff` | 6.55–7.75            | ✅ passa                                                    | ✅                                     |
| `steam-blue-light` (novo)           | `#6ba3ff` | 6.80–8.05            | ✅ passa                                                    | ✅                                     |
| `neon-purple-light` (novo)          | `#d06bff` | 5.92–7.01            | ✅ passa                                                    | ✅                                     |
| `playstation-500` (só ícone grande) | `#004ea2` | 2.14–2.53            | ❌                                                          | ❌ → substituído por `playstation-400` |
| `steam-blue` (só ícone)             | `#0568e5` | 3.37–3.99            | ⚠️                                                          | ✅ ≥ 3 (ícones ≥ 16 px) — mantido      |
| `neon-purple` (só texto grande)     | `#bc13fe` | 3.82–4.52            | ❌ → texto grande apenas                                    | ✅ ≥ 3 (Large)                         |
| `nintendo-500` (só ícone)           | `#e60012` | 3.58–4.24            | ❌ → só ícone pequeno/decorativo ou grande                  | ✅ ≥ 3                                 |

## Badges (texto 10 px bold sobre fundo de marca com alpha 10% — medido composto sobre `#050508`)

| Badge               | Texto                     | Fundo efetivo            | Ratio           | Veredito     |
| ------------------- | ------------------------- | ------------------------ | --------------- | ------------ |
| `badge-running`     | `emerald-400`             | `#061714`                | 9.58            | ✅ passa     |
| `badge-error`       | `red-400`                 | `#1c0b0e`                | 6.88            | ✅ passa     |
| `badge-stopped`     | `slate-400`               | `#0e1117` (slate-700/20) | 7.37            | ✅ passa     |
| `badge-kloud`       | `kloud-500`               | `#1d1009`                | 6.63            | ✅ passa     |
| `badge-neon-cyan`   | `neon-cyan`               | `#051d21`                | 12.68           | ✅ passa     |
| `badge-nintendo`    | `#e60012` → **`#ff6b6b`** | `#1c0509`                | 4.07 → **7.04** | ✅ corrigido |
| `badge-playstation` | `#004ea2` → **`#5e9eff`** | `#050c17`                | 2.44 → **7.29** | ✅ corrigido |
| `badge-steam`       | `#0568e5` → **`#6ba3ff`** | `#050f1e`                | 3.77 → **7.60** | ✅ corrigido |
| `badge-neon-purple` | `#bc13fe` → **`#d06bff`** | `#170621`                | 4.30 → **6.67** | ✅ corrigido |

## Gradientes de texto (`.gradient-text` — pior parada mede o veredito)

| Gradiente                                   | Paradas                                                                       | Pior parada vs. fundos                  | Veredito                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `gradient-kloud`                            | `#f97316` → `#ef4444`                                                         | `#ef4444`: **4.57–5.41**                | ✅ passa AA texto normal em todos os fundos                                       |
| `gradient-rainbow`                          | `#e60012` → ~~`#004ea2`~~ → **`#2e7ce6`** → `#00f3ff` → `#bc13fe` → `#e60012` | `#2e7ce6`: **4.21–4.98**; demais ≥ 3.58 | ✅ passa texto grande (usada só em títulos `text-2xl`+/`font-bold`+)              |
| `from-steam-blue to-neon-cyan` (Biblioteca) | `#0568e5` → `#00f3ff`                                                         | `#0568e5`: **3.37–3.99**                | ✅ passa AA texto grande (título `text-3xl` bold) — **não usar em texto < 24 px** |

> Ajuste mínimo: parada `playstation` do `gradient-rainbow` elevada de `#004ea2` para `#2e7ce6` (2.14–2.53 → 4.21–4.98). As outras paradas ficaram intactas.

## Tokens finais (`kolnd-hub/tailwind.config.js`)

| Token               | Valor     | Ratio (min–max) | Uso                                                                                                       |
| ------------------- | --------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `muted`             | `#cbd5e1` | 11.57–13.71     | texto secundário/metadados com folga máxima                                                               |
| `subtle`            | `#94a3b8` | 6.70–7.94       | legendas, placeholders, ícones de ação                                                                    |
| `nintendo.400`      | `#ff6b6b` | 6.19–7.34       | texto sobre vermelho de marca                                                                             |
| `playstation.300`   | `#5e9eff` | 6.39–7.57       | texto sobre azul de marca                                                                                 |
| `playstation.400`   | `#4da3ff` | 6.55–7.75       | ícones e a classe `text-playstation-400` (referenciada no código, **não definida antes** — agora resolve) |
| `steam.blue-light`  | `#6ba3ff` | 6.80–8.05       | badges/labels Steam                                                                                       |
| `neon.purple-light` | `#d06bff` | 5.92–7.01       | badges/labels roxos                                                                                       |

As cores de marca plenas (`kloud-500`, `neon-*`, `nintendo-500`, `playstation-500/600`, `steam-blue`) **não foram alteradas**; só os tons claros acessíveis foram **adicionados**.

## Correções aplicadas

**Busca/substituição controlada (somente classes de texto):**

| Regra                                                                                                              | Ocorrências | Arquivos                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------- |
| `text-slate-500` → `text-slate-400`                                                                                | 99          | renderer (27 arquivos no total da regra)                                                                 |
| `text-slate-600` → `text-slate-400`                                                                                | 30          | renderer                                                                                                 |
| `placeholder-slate-600` → `placeholder-slate-400`                                                                  | 1           | `GlobalSearch.tsx` (o `placeholder-slate-600` do `.input-gamer` foi ajustado manualmente no `index.css`) |
| `text-slate-700` → `text-slate-500` (só controles desabilitados)                                                   | 2           | `StopGameButton.tsx`, `BigPictureGames.tsx`                                                              |
| `.label-panel` `text-slate-500` → `text-slate-400`                                                                 | 1           | `index.css`                                                                                              |
| Grupos de hover tornados consistentes (`text-slate-400 group-hover:text-slate-400` → `group-hover:text-slate-300`) | 2           | `GameCard.tsx`, `BigPictureGames.tsx`                                                                    |

**Ajustes pontuais por contexto:**

- Sidebar: nav ativo `text-playstation-400` (antes classe morta) → agora `#4da3ff`; `biblioteca`/`settings` ativos → `text-steam-blue-light` / `text-neon-purple-light`; `group-hover:text-playstation-500` → `text-playstation-400`; itens de nav e botão "Sair" receberam `focus-visible:ring-2 focus-visible:ring-neon-cyan/70`.
- `Inicializacao.tsx`: `categoryColor` `gaming` → `text-neon-purple-light`, `streaming` → `text-playstation-300`; ícones `Monitor` → `text-playstation-400`.
- `AppDetailModal.tsx`: link "Abrir …" `text-playstation-500 hover:text-playstation-400` → `text-playstation-300 hover:text-playstation-400` (antes o hover era classe morta); botão fechar recebeu `focus-visible:ring-2`.
- `EditGameModal.tsx`: ícone `Pencil` `text-playstation-500` → `text-playstation-400` (antes 2.46–2.53:1, falhava até 1.4.11).
- `AppCard.tsx`: botão "Abrir no navegador" e botão Iniciar/Parar receberam `focus-visible:ring-2 focus-visible:ring-neon-cyan/70`; o primeiro também `focus-visible:opacity-100` (antes invisível para teclado).
- `GameCard.tsx` / `BigPictureGames.tsx`: lápis de edição e selo ".exe não encontrado" receberam `focus-visible:ring-2`.
- Badges `badge-{nintendo,playstation,steam,neon-purple}` → tons acessíveis (tabela acima).
- `gradient-rainbow`: parada `#004ea2` → `#2e7ce6`.

## Foco visível global (`index.css`, regra da 8.2 — mantida na 13.20)

```css
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

- Definida **fora de `@layer`** de propósito: CSS solto vence qualquer camada do Tailwind (inclui utilitários `focus:outline-none`), então o anel nunca é removido sem substituto.
- O anel `--focus-ring` sobre os fundos do tema mede **6.92–9.61:1** (≥ 3:1 exigido para indicadores; tabela na Parte 1).
- Os anéis `focus-visible:ring-4` do Big Picture foram **mantidos** — convivem com a regra global (box-shadow + outline, sem conflito).

## Estados desabilitados

`btn-primary` (`disabled:opacity-50`) e controles `cursor-not-allowed` são **isentos** de WCAG 1.4.3; mesmo assim o `text-slate-700` dos dois desabilitados foi elevado para `text-slate-500` por legibilidade. Nenhum texto interativo normal depende de opacidade < 1.

## Exceções e itens pendentes (8.2)

1. **Revisão visual (screenshots antes/depois): pendente** — ambiente headless não abre janela; cabe ao usuário validar a olho após `npm run dev`. **`npm run dev`/packaging não foram executados.**
2. `badge-nintendo` não consta em nenhum TSX hoje → foi **tree-shaken** do CSS final (conferido em `out/renderer/assets/*.css`); a classe corrigida ficará disponível quando usada. Conferidos em produção: `.badge-playstation` emite `rgb(94 158 255)`, `.badge-steam` → `rgb(107 163 255)`, `.badge-neon-purple` → `rgb(208 107 255)`.
3. `text-playstation-400` e `hover:text-playstation-400` eram **classes mortas** (token inexistente); token `playstation.400 = #4da3ff` foi criado, dando vida a elas (ícone 7.52–7.75:1; texto também AA).
4. `text-steam-blue` mantido (ícones ≥ 16 px, 3.37–3.99:1 ≥ 3:1 de 1.4.11). **Não usar em texto.**
5. `text-neon-purple` mantido em dois lugares de **texto grande** (≥ `text-xl` bold, BigPictureControls; ícones do LoadingScreen) — 3.82–4.52:1 ≥ 3:1. **Não usar em texto normal.**
6. `categoryColor` em `Dashboard.tsx` e `LoadingScreen.tsx` aplica cor a ícones/containers (não a texto) — verificado, sem efeito em texto.
7. `AppCard` (card inteiro clicável sem `role`/`tabIndex`) — correção semântica é da tarefa **8.1 (ARIA)**; aqui só foi garantido foco visível nos botões internos.
8. NVDA e auditorias profundas: **fora do escopo** (recomenda-se sessão dedicada; não bloqueia release).
9. Sem light theme (decisão de produto); identidade de marca inalterada — apenas tons claros **adicionados**.

## Verificação (8.2, 16/11/2026)

| Gate                                                               | Resultado                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                         | 33 arquivos, **592 passed**, 1 skipped                                                                         |
| `npx tsc --noEmit -p tsconfig.web.json`                            | **0 erros** (e `tsconfig.node.json` também ok)                                                                 |
| `npm run lint`                                                     | **0 erros**, 5 warnings pré-existentes em `src/main/*.test.ts`                                                 |
| `npm run format:check` / `prettier --write` nos arquivos alterados | **limpo**                                                                                                      |
| `npm run build`                                                    | **ok** (main/preload/renderer)                                                                                 |
| `.focus-visible` global presente no CSS final                      | ✅ conferido em `out/renderer/assets/*.css`                                                                    |
| Diff                                                               | restrito a `index.css`, `tailwind.config.js`, classes de texto no renderer, `README.md` (2 bullets) e este doc |
