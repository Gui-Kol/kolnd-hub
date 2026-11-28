# Aparência do avatar - bola procedural (task 27)

Documento vigente da aparência do Absolem. A lagarta e a cena 3D das tasks
14-23 foram **aposentadas** por decisão do usuário em 27/11/2026: o avatar agora
é uma bola 100% procedural desenhada em Canvas2D, sem `three`, sem WebGL, sem
asset externo e sem dependência nova. Nenhuma funcionalidade do projeto mudou:
estados, voz, clique = voz, tema, preview da aba Aparência, fallback estático,
harness de captura e gates continuam os mesmos.

## 1. Contrato que não muda

`src/renderer/src/overlay/avatar/index.ts` continua exportando `mountAvatar`,
`AvatarHandle`, `AvatarMetrics` e `AvatarSceneOptions`. O `AvatarHandle` mantém
`canvas`, `setState`, `setLevel`, `setTheme`, `applyTheme`, `setOutlineStrength`,
`setLook`, `setVisible`, `setReducedMotion`, `resize`, `dispose`, `getMetrics`,
`getState` e `isRunning`.

Campos de `AvatarSceneOptions` que não têm efeito na bola continuam tipados e são
aceitos sem erro: `style`, `outfit`, `seed`, `look`, `particleScale`,
`outlineStrength`, `slow`, `debug`, `onDegrade` e `theme.accent`. Eles existem só
para compatibilidade com o overlay e com a aba Aparência, que são protegidos e
não foram editados.

## 2. Estados e cores fixas

As cores do corpo são fixas por estado e **ignoram o tema** (decisão de
produto). O estado muda a cor; nada mais no tema altera a paleta da bola.

| Estado      | Cor       | Leitura             |
| ----------- | --------- | ------------------- |
| `idle`      | `#3b82f6` | azul em repouso     |
| `listening` | `#22c55e` | verde ouvindo       |
| `speaking`  | `#eab308` | amarela respondendo |
| `thinking`  | `#f59e0b` | âmbar pulsante      |
| `error`     | `#ef4444` | vermelha em erro    |

A paleta única mora em `ball.ts` (`BALL_COLORS`); `theme-boundary.test.ts`
garante que nenhum outro módulo do avatar declara essas cores e que ninguém além
de `themeAdapter.ts` lê campos de `ThemeConfig`.

## 3. Desenho

Tudo é Canvas2D no `canvas` existente (classe `overlay-canvas`, 100% x 100%,
`pointer-events: none`, fundo transparente). O desenho é composto por:

- **esfera** com gradiente radial: brilho deslocado para cima/esquerda (cor
  clareada ~38%), núcleo na cor do estado, borda escurecida (~16-26%);
- **brilho especular** suave no mesmo canto da luz;
- **glow externo** radial na cor do estado (~20-50% de alfa no centro, some nas
  pontas), mais forte em `thinking`/`speaking`;
- **aro** quase imperceptível para separar a bola de fundos claros.

O diâmetro em repouso é **46% do menor lado** do canvas multiplicado pela escala
do tema (clamp 0.8..1.5). No pior caso (escala 1.5) o diâmetro é 69% do menor
lado, sempre dentro da elipse de clique (86% x 90%). A elipse e o frame continuam
em `AvatarArea.tsx`; o CSS não mudou.

O canvas usa `devicePixelRatio` limitado a **2** (`pixelRatioCap` é respeitado; o
preview passa 1). O desenho é feito em CSS pixels com `setTransform`, então o
anti-aliasing é o natural do Canvas2D, sem MSAA próprio, shader ou pós-processo.

## 4. Movimento

O pulso é uma função pura do tempo (segundos), do nível 0..1 e do estado. O
nível vem do RMS real da voz pelo mesmo `setLevel` de antes.

| Estado      | Amplitude do diâmetro | Ritmo / regra                   |
| ----------- | --------------------- | ------------------------------- |
| `idle`      | ±2,5%                 | respiração em ~3,2 s            |
| `listening` | ±6%                   | pulso modulado pelo nível       |
| `speaking`  | ±14%                  | pulso forte modulado pelo nível |
| `thinking`  | ±8%                   | pulso próprio em ~1,4 s         |
| `error`     | 0                     | estável                         |

`reducedMotion` (sistema ou tema) congela a animação: diâmetro em 1, pulso em 0,
tempo fixo. A troca de cor por estado continua funcionando normalmente.

## 5. Tema

`themeAdapter.ts` é enxuto e é o único leitor de `ThemeConfig` no avatar. Na bola
ele extrai somente:

- `scale` (0.8..1.5), que multiplica o diâmetro;
- `reducedMotion`, que desliga a animação.

Cores, `style`, `outfit`, `accessories`, `particleDensity`, `glowIntensity`,
`outlineStrength` e `look` são ignorados visualmente. `looks.ts` e seu teste
continuam existindo porque `overlayFlags.ts` e o schema do tema ainda usam
`AvatarLook`; `holo` e `storybook` viraram **apenas dados de compatibilidade**,
sem efeito na bola. A flag `?look=` continua sendo aceita e não muda o desenho.

## 6. Loop, visibilidade e métricas

O loop usa `requestAnimationFrame` e só roda quando o overlay está visível **e**
o documento não está oculto. Ao pausar/ocultar, o loop para e as métricas são
zeradas; `dispose` é idempotente e remove listeners.

Métricas expostas por `getMetrics()` e por `window.__absolemAvatarMetrics()`:

| Campo         | Valor na bola                                    |
| ------------- | ------------------------------------------------ |
| `fps`         | real, calculado das janelas do rAF (90 amostras) |
| `frameMs`     | média real do delta entre frames                 |
| `drawCalls`   | 1 por frame pintado; 0 com o loop parado         |
| `triangles`   | 0 (não há malha 3D)                              |
| `degradation` | 0 (não há degradação automática)                 |

O harness `waitForStableFrame` continua satisfeito: `frameMs > 0` e
`drawCalls > 0` em execução. Não existe monitor de performance, partículas,
outline, toon ramp, câmera nem renderizador WebGL.

## 7. Fallback estático

Se `getContext('2d')` falhar ou lançar, `mountAvatar` devolve o handle inerte
(todos os métodos seguros, métricas zeradas) e adiciona a classe
`overlay-avatar--fallback`, que esconde o canvas. O React então monta
`FallbackAvatar.tsx`: uma bola SVG inline (círculo + gradiente radial + halo +
aro) usando `colors.primary` do tema vigente, com os mesmos props, a mesma classe
`fallback-avatar` e `aria-hidden="true"`. Não há animação, `three`, arquivo
externo ou dependência nova.

## 8. Capturas e QA

O harness `scripts/visual/capture-avatar.cjs` continua sem edição: ele monta o
overlay real, aplica os cinco estados por IPC e grava **10 PNGs** (5 estados x
320x360 e 480x560) mais `metrics.json`/`done.json` em `%TEMP%\absolem-visual\`.
Cada captura deve reportar `draws=1`, `tris=0` e `deg=0`.

## 9. Aposentadoria da lagarta e da cena 3D

Foram removidos os módulos da lagarta e da cena: `caterpillar.ts`, `parts/**`,
`roleMaterials`, `toonGradient`, `outline`, `palettes`, `lookScene`, `framing`,
`particles`, `expressions`, `expressionMapping`, `facePose`, `lipSync`,
`restMotion`, `sceneTheme`, `holoMaterial`, `scene`, `perf`, `renderLoop` e todos
os testes deles. `parts-contract.test.ts` também foi removido; os testes
equivalentes da bola vivem em `ball.test.ts`.

O código do overlay não importa `three` (garantido por teste). A dependência
continua em `package.json` porque o arquivo está fora do escopo desta task; a
remoção fica como pendência futura. `fallback.ts` e `fallback.test.ts` foram
mantidos (com a edição mínima autorizada no teste para retirar o caso de
partículas), assim como `looks.ts`/`looks.test.ts`.

## 10. Direito autoral

O desenho é 100% procedural: nenhum asset, textura, modelo ou imagem oficial
entra no aplicativo, no repositório ou no instalador. A bola é uma forma
geométrica original; não há referência externa embutida.
