# Baseline de bundle do renderer — Kolnd Hub

> **Data:** 16/11/2026 · **Máquina:** Windows (medição local) · **Node:** v26.13.0 · **npm:** 11.20.0
> **Ferramentas:** electron-vite 2 (vite 5.4.21, rollup 4.68.2) + `rollup-plugin-visualizer` 7.1.3 (treemap, `gzipSize` + `brotliSize`)
> **Status:** baseline histórica de 16/11/2026. A task `06` (26/11/2026) implementou
> code splitting do `App` e fontes só `woff2` — números atuais na seção
> [Atualização 26/11/2026](#atualização-26112026--task-06) e em
> `gerente/tasks/otimizacao-recursos/bundle-antes.md` / `bundle-depois.md`.

## Atualização 26/11/2026 — task 06

Medição local (Node v26.13.1, npm 11.20.0, `npm run build`) na branch `Dev` sobre a
base `bcf5496e`. Comparativo completo em
`gerente/tasks/otimizacao-recursos/bundle-depois.md`.

| Métrica | 16/11/2026 | 26/11/2026 (task 06) |
| --- | ---: | ---: |
| Entry JS (raw) | 929.557 B (907,8 KiB) | **236.178 B (230,6 KiB)** |
| Chunk `App-*.js` | — (tudo no entry) | 447.362 B (436,9 KiB), lazy |
| CSS global (raw) | 76.524 B (74,7 KiB) | 76.418 B (74,6 KiB) |
| Fontes no build | 16 arq. / 558.184 B (545,1 KiB) | **8 arq. / 240.272 B (234,6 KiB), só `.woff2`** |
| FCP (mediana) | 625,9 ms (T1 desta task) | 636,5 ms (+1,7%, dentro de 2%) |

- O `App` virou `React.lazy` no `main.tsx`; a janela do HUD carrega **só o entry**
  (236.178 B) + CSS + 6 faces de fonte — nenhuma requisição de `App-*.js`.
- Os 8 imports de `@fontsource/inter` viraram `styles/fonts.css` com os 8 `.woff2`
  (`latin` + `latin-ext` × 400/500/600/700). O `latin-ext` fica declarado **depois**
  do `latin` de propósito: sem `unicode-range` no pacote, a última face vence e era
  ela que renderizava o app — manter a ordem garante paridade visual exata (diff 0 no
  conteúdo e no HUD). O `latin` continua como fallback de glifos. Licença em
  `src/renderer/src/assets/fonts/OFL.txt`; dependência `@fontsource/inter` mantida.
- `manualChunks` (react/framer-motion) foi medido e **revertido**: fazia o HUD baixar
  +253 kB (framer-motion) e piorava o FCP em 2,4%.
- As recomendações abaixo (Big Picture lazy, enxugar framer-motion, etc.) continuam
  válidas, mas parte do item 1 já foi absorvida pelo code splitting existente.

## Como reproduzir

No PowerShell, em `kolnd-hub/`:

```powershell
$env:BUNDLE_ANALYZE='1'; npm run build
```

Isso gera `kolnd-hub/dist/bundle-report.html` (treemap interativo) e é o único caminho em que o plugin é carregado. O `.gitignore` do `kolnd-hub/` ignora `dist/` inteiro, então o relatório **não** aparece no `git status` (confirmado com `git check-ignore`). Sem a flag, o build é idêntico ao anterior (o plugin entra via spread condicional em `electron.vite.config.ts`, somente no entry `renderer`).

Build sem a flag: `npm run build`. Gate completo: `npm run verify`.

## Números medidos (16/11/2026)

### Assets em disco (`out/renderer/`)

| Arquivo | Raw | Gzip (nível 9) | Brotli (q11) |
| --- | --- | --- | --- |
| `assets/index-BTYAFq5i.js` | 929.557 B (907,8 KiB) | 191.944 B (187,5 KiB) | 156.196 B (152,5 KiB) |
| `assets/index-CUZJuqgp.css` | 76.524 B (74,7 KiB) | 12.216 B (11,9 KiB) | 9.859 B (9,6 KiB) |
| `index.html` | 704 B | 405 B | 276 B |
| **Total** | **1.006.785 B (983,4 KiB)** | **204.565 B (199,8 KiB)** | **166.331 B (162,4 KiB)** |

### Soma dos módulos JS parseados (visualizer, 371 módulos)

| Métrica | Valor |
| --- | --- |
| Raw parseado | 961.567 B (939,2 KiB) |
| Gzip (soma por módulo) | 282.732 B (276,1 KiB) |
| Brotli (soma por módulo) | 244.325 B (238,6 KiB) |

> A soma por módulo é **maior** que o gzip/brotli do arquivo único porque a compressão atua melhor no arquivo concatenado (redundância cruzada). Para "o que vai pela rede", use a tabela de assets; para atribuição por módulo, use a de baixo.

### Estrutura de chunks

**Um único chunk JS** (`index-*.js`) + **um CSS** + `index.html`. Não há code splitting: todo o app (todas as telas, inclusive Big Picture) está no entry.

### Top 10 módulos por tamanho raw (JS)

| # | Módulo | Raw | Gzip/mód. | Brotli/mód. |
| --- | --- | --- | --- | --- |
| 1 | `react-dom/cjs/react-dom.production.min.js` | 130,2 KB | 41,5 KB | 36,1 KB |
| 2 | `framer-motion/.../projection/node/create-projection-node.mjs` | 66,5 KB | 13,5 KB | 11,6 KB |
| 3 | `src/renderer/src/components/Biblioteca.tsx` | 46,2 KB | 7,9 KB | 7,0 KB |
| 4 | `src/renderer/src/components/GamepadSetup.tsx` | 32,1 KB | 6,2 KB | 5,5 KB |
| 5 | `src/renderer/src/components/UninstallKloudGamesModal.tsx` | 31,4 KB | 6,0 KB | 5,4 KB |
| 6 | `src/renderer/src/components/UninstallHubModal.tsx` | 28,1 KB | 5,5 KB | 4,9 KB |
| 7 | `src/renderer/src/components/Settings.tsx` | 27,4 KB | 5,0 KB | 4,5 KB |
| 8 | `src/renderer/src/components/Inicializacao.tsx` | 25,3 KB | 3,6 KB | 3,2 KB |
| 9 | `src/renderer/src/components/BigPicture.tsx` | 24,6 KB | 5,7 KB | 5,0 KB |
| 10 | `src/renderer/src/components/PcUpdates.tsx` | 23,9 KB | 4,8 KB | 4,3 KB |

### Participação por área (raw parseado, soma por módulo)

| Área | Raw | Gzip/mód. | Módulos | % do raw |
| --- | --- | --- | --- | --- |
| App (`src/renderer`) | 419,9 KB | 93,6 KB | 43 | ~44,7% |
| framer-motion (+ motion-dom/utils) | 345,3 KB | 116,2 KB | 246 | ~36,8% |
| react + react-dom + scheduler | 143,9 KB | 47,6 KB | 18 | ~15,3% |
| lucide-react | 29,9 KB | 18,7 KB | 64 | ~3,2% |
| Outros | ~0,3 KB | 0,3 KB | 2 | <0,1% |

Subtotal Big Picture (`BigPicture*.tsx`, 7 arquivos): **83,6 KB raw / 20,8 KB gz / 18,4 KB br**.
Top arquivos do app: Biblioteca 46,2 · GamepadSetup 32,1 · UninstallKloudGamesModal 31,4 · UninstallHubModal 28,1 · Settings 27,4 · Inicializacao 25,3 · PcUpdates 23,9 (KB raw) — somam ~214 KB.

## Achados dos imports (T3/T4)

### lucide-react — saudável

- **23 ocorrências em 22 arquivos** do renderer: 22 imports nomeados de valores + 1 `import type { LucideIcon }` (`LoadingScreen.tsx`).
- **0** `import * as ...`, **0** import default do pacote inteiro, **0** imports profundos (`lucide-react/dist/...`).
- Todos passam pelo barrel do pacote (`from 'lucide-react'`) — é o padrão correto. O tree-shaking do ESM está funcionando: **apenas 64 módulos / 29,9 KB raw (~3% do bundle)**, muito longe dos ~1 MB do pacote sem shaking.
- Os 64 módulos são basicamente os ícones usados + o componente `Icon` + helpers.

### framer-motion — peso alto, imports corretos

- **14 arquivos importam** do barrel `framer-motion`, todos com imports nomeados (`motion`, `AnimatePresence`).
- **0** `import * as`, **0** deep imports (`framer-motion/dist/...`), **0** imports default.
- O peso vem do próprio pacote (246 módulos / 345,3 KB raw / 116,2 KB gz ≈ **36% do JS parseado**); o maior módulo é `projection/node/create-projection-node.mjs` (66,5 KB raw) — projeção de layout (layoutId/layout animations), subsistema que o Hub usa pouco ou nada em telas comuns.

### Vazamento de Node/Electron para o renderer — nenhum

- Busca em `src/renderer` por `electron-store`, `tree-kill`, `child_process`, `node:fs`, `require(`, `from 'fs'/'path'/'electron'`: apenas **comentários e strings** (ex.: comentários citando a chave `electron-store`, `console.info` de migração). Nenhuma importação real.
- No bundle minificado, `electron-store` aparece 2× como texto (string de UI/log); `require(` aparece 1× dentro de `try/catch` do framer-motion (`require("@emotion/is-prop-valid")` — opcional, inerte no browser, cai no fallback interno); `conf`/`configAndProps` etc. são substrings de identificadores, não o pacote `conf`.
- `tree-kill`, `node:fs`, `child_process`: **ausentes** do bundle.

## Recomendações priorizadas (por ganho estimado — NÃO implementadas)

1. **Code-split do Big Picture via `React.lazy`** — *ganho alto · esforço médio*.
   Remove ~83,6 KB raw (~20,8 KB gz) e todo o código de gamepad exclusivo dele do chunk inicial. O Hub é "abrir e usar": Big Picture é modo secundário. (Arquivos: `BigPicture*.tsx`, 7 módulos; ponto de entrada em `App.tsx`.)
2. **Enxugar o framer-motion** — *ganho alto · esforço alto*.
   345 KB raw / 116 KB gz (~36%) para animações de fade/slide. Opções a avaliar em tarefa própria: (a) trocar animações triviais por CSS transitions; (b) migrar para o pacote `motion` (mesma API, ESM totalmente tree-shakable); (c) investigar uso real de `projection`/`layoutId` (66,5 KB só em `create-projection-node.mjs`). Depende de inventário de uso — decisão e execução em item próprio, com aprovação.
3. **`manualChunks` para vendor (react/react-dom/framer-motion)** — *ganho médio · esforço baixo*.
   Não reduz bytes, mas separa hash de vendor do app: releases que só mexem no app não invalidam o cache do Electron. Cuidado com ordem de carregamento e com o `index.html` gerado.
4. **Quebrar/lazy dos componentes grandes do app** — *ganho médio · esforço médio*.
   Biblioteca (46,2 KB), GamepadSetup (32,1), UninstallKloudGamesModal (31,4), UninstallHubModal (28,1), Settings (27,4), Inicializacao (25,3), PcUpdates (23,9) ≈ **214 KB raw** concentrados em telas modais/secundárias — candidatas a subcomponentes ou lazy por aba. Cruzar com 10-10.2 (memo) e com a divisão por rota.
5. **Auditar o CSS (74,7 KB raw / 11,9 KB gz)** — *ganho baixo-médio · esforço baixo*.
   Revisar `content` do `tailwind.config` e classes montadas dinamicamente; utilitários não alcançáveis pelo scanner inflam o arquivo. Só medir e aparar o que sobrar.
6. **Manter disciplina de imports lucide-react** — *ganho baixo · esforço baixo*.
   Estado atual é o correto; considerar `no-restricted-imports` para barrar `import * as`/default no futuro (regra de lint, não otimização).
7. **Compromisso de tamanho** — *ganho de governança · esforço nulo*.
   Proposta: JS do renderer **≤ 200 KB gzip** (arquivo único) e CSS **≤ 12 KB gzip** nas próximas releases enquanto as otimizações acima não forem aplicadas. Revisão a cada release (11.2).

## Fora de escopo / não feito

- Nenhuma otimização implementada (sem `React.lazy`, `memo`, code splitting, troca de dependências) — apenas medição e recomendação.
- Nenhuma dependência adicionada além de `rollup-plugin-visualizer` (devDependency, 7.1.3), nenhuma removida ou atualizada.
- `main`/`preload` não tocados (apenas o entry `renderer` do `electron.vite.config.ts`).
- `dist/bundle-report.html` permanece não-trackeado (gitignored).
