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

## Foco visível global (`index.css`)

```css
:focus-visible {
  outline: 2px solid #00f3ff; /* neon-cyan */
  outline-offset: 2px;
}
```

- Definida **fora de `@layer`** de propósito: CSS solto vence qualquer camada do Tailwind (inclui utilitários `focus:outline-none`), então o anel nunca é removido sem substituto.
- O anel neon-cyan sobre os fundos do tema mede **12.49–14.80:1** (≥ 3:1 exigido para indicadores).
- Os `focus-visible:ring-4 focus-visible:ring-neon-cyan/70` já existentes (Big Picture, Sidebar Big Picture) foram **mantidos** — convivem com a regra global (box-shadow + outline, sem conflito).
- Controles só com `hover:` que ficaram **cobertos pela regra global** (sem mudança extra, por economia de diff): botões de abas em `PcUpdates`/`Inicializacao`, ícones de limpar busca em `Settings`, botões "fechar aviso" em `Biblioteca`/`App.tsx`, ações de `PcCleanup`, entre outros.

## Estados desabilitados

`btn-primary` (`disabled:opacity-50`) e controles `cursor-not-allowed` são **isentos** de WCAG 1.4.3; mesmo assim o `text-slate-700` dos dois desabilitados foi elevado para `text-slate-500` por legibilidade. Nenhum texto interativo normal depende de opacidade < 1.

## Exceções e itens pendentes

1. **Revisão visual (screenshots antes/depois): pendente** — ambiente headless não abre janela; cabe ao usuário validar a olho após `npm run dev`. **`npm run dev`/packaging não foram executados.**
2. `badge-nintendo` não consta em nenhum TSX hoje → foi **tree-shaken** do CSS final (conferido em `out/renderer/assets/*.css`); a classe corrigida ficará disponível quando usada. Conferidos em produção: `.badge-playstation` emite `rgb(94 158 255)`, `.badge-steam` → `rgb(107 163 255)`, `.badge-neon-purple` → `rgb(208 107 255)`.
3. `text-playstation-400` e `hover:text-playstation-400` eram **classes mortas** (token inexistente); token `playstation.400 = #4da3ff` foi criado, dando vida a elas (ícone 7.52–7.75:1; texto também AA).
4. `text-steam-blue` mantido (ícones ≥ 16 px, 3.37–3.99:1 ≥ 3:1 de 1.4.11). **Não usar em texto.**
5. `text-neon-purple` mantido em dois lugares de **texto grande** (≥ `text-xl` bold, BigPictureControls; ícones do LoadingScreen) — 3.82–4.52:1 ≥ 3:1. **Não usar em texto normal.**
6. `categoryColor` em `Dashboard.tsx` e `LoadingScreen.tsx` aplica cor a ícones/containers (não a texto) — verificado, sem efeito em texto.
7. `AppCard` (card inteiro clicável sem `role`/`tabIndex`) — correção semântica é da tarefa **8.1 (ARIA)**; aqui só foi garantido foco visível nos botões internos.
8. NVDA, `aria-live` do Big Picture (8.3) e `prefers-reduced-motion` (8.4): **fora do escopo desta tarefa** (8.4 já consta em `index.css`, intocado).
9. Sem light theme (decisão de produto); identidade de marca inalterada — apenas tons claros **adicionados**.

## Verificação (16/11/2026)

| Gate                                                               | Resultado                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                         | 33 arquivos, **592 passed**, 1 skipped                                                                         |
| `npx tsc --noEmit -p tsconfig.web.json`                            | **0 erros** (e `tsconfig.node.json` também ok)                                                                 |
| `npm run lint`                                                     | **0 erros**, 5 warnings pré-existentes em `src/main/*.test.ts`                                                 |
| `npm run format:check` / `prettier --write` nos arquivos alterados | **limpo**                                                                                                      |
| `npm run build`                                                    | **ok** (main/preload/renderer)                                                                                 |
| `.focus-visible` global presente no CSS final                      | ✅ conferido em `out/renderer/assets/*.css`                                                                    |
| Diff                                                               | restrito a `index.css`, `tailwind.config.js`, classes de texto no renderer, `README.md` (2 bullets) e este doc |
