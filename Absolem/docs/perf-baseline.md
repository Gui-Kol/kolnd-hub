# Baseline local do Absolem

Este roteiro mede somente o pacote construído (`npm run build`) com
`ABSOLEM_TEST_USERDATA` temporário e `ABSOLEM_TEST_TRANSPORT=fake`. Não há rede,
conta, chave, prompt real, áudio ou URL envolvidos. A sessão Live é substituída
pelo `FakeLiveTransport` (somente em processo não empacotado), então chat, voz e
captura respondem de forma determinística sem sair da máquina.

A captura sintética usa o caminho real do renderer (o overlay captura um frame
da tela e responde `capture:result`); o frame fica apenas em memória, é enviado
ao transporte fake e descartado — nada é gravado em disco nem enviado à rede.

## Repetição

```powershell
cd Absolem
npm run test:e2e -- tests/e2e/baseline.spec.ts
npm run test:e2e -- tests/e2e/baseline.spec.ts
# somente para repetir o artefato empacotado (quando ele abrir janela):
$env:ABSOLEM_BASELINE_PACKAGED='1'
npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/baseline.spec.ts
```

O teste imprime uma linha `BASELINE_JSON` com amostras, p50/p95, RSS, heap,
CPU agregada, FPS/frameMs do avatar e o custo de 50 ciclos. O relatório não
grava dados do perfil temporário.

## Cenários e método

| Cenário              | Método                                                        | Amostras                |
| -------------------- | ------------------------------------------------------------- | ----------------------- |
| Boot/primeira janela | janela do app buildado                                        | 1 por execução          |
| Primeiro overlay     | `overlay:show` + DOM do overlay                               | 1 por execução          |
| Primeiro áudio fake  | `voice:start` até estado `listening` (Live fake)              | 3 por execução          |
| Barge-in fake        | `voice:sendAudioChunk` + `voice:sendBargeIn` com sessão ativa | 5 por execução          |
| Primeiro token fake  | `chat:send` até `chat:done` (Live fake)                       | 3 por execução          |
| Captura fake         | `capture:ask` até `chat:done` (frame real + Live fake)        | 3 por execução          |
| Idle                 | processo main antes/depois                                    | 2 s                     |
| Ciclos longos        | `overlayHide`/`overlayShow`                                   | 50 ciclos + RSS/heap    |
| FPS                  | `window.__absolemAvatarMetrics()`                             | após 5 s de aquecimento |

O roteiro usa p50/p95 das amostras; os cenários de uma única ocorrência são
marcados como amostra única. As duas execuções consecutivas devem variar no
máximo 20% no cenário controlado (comparando o p50).

## Limites

Os limites de regressão seguem `docs/perf-budget.md`: CPU oculto < 1% de um
núcleo, CPU visível < 2%, RSS < 350 MB, FPS ≥ 60 e crescimento de RSS/heap após
os ciclos ≤ 20 MB. O tamanho do bundle é registrado pelo roteiro de build e
não é inferido a partir de um ambiente de desenvolvimento.

## Baseline registrado (27/11/2026)

Duas execuções consecutivas com o roteiro sintético em modo source
(`ABSOLEM_BASELINE_SOURCE=1`; o artefato empacotado não abriu janela em 90 s).
Estes números não substituem uma medição do artefato distribuído.

| Métrica (p50)             | Execução 1 | Execução 2 | Variação |
| ------------------------- | ---------: | ---------: | -------: |
| Boot/primeira janela (ms) |      921,7 |      955,9 |     3,7% |
| Primeiro overlay (ms)     |       91,7 |       95,7 |     4,4% |
| Primeiro áudio fake (ms)  |       35,9 |       36,4 |     1,4% |
| Barge-in fake (ms)        |        4,2 |        4,1 |     2,4% |
| Primeiro token fake (ms)  |       20,6 |       21,2 |     2,9% |
| Captura fake (ms)         |    1.559,5 |    1.599,3 |     2,6% |
| Ciclos overlay (50, ms)   |      805,8 |      859,7 |     6,7% |
| Idle RSS (MB)             |      110,3 |      108,2 |     1,9% |
| RSS após ciclos (MB)      |      205,4 |      205,2 |     0,1% |
| Avatar FPS / frame (ms)   |  165 / 6,1 |  165 / 6,1 |       0% |

Nenhum cenário variou mais de 20% entre as execuções. Ponto de atenção
registrado, não mascarado: o RSS após 50 ciclos de show/hide cresce ~95 MB
(110 → 205 MB), acima do limite de 20 MB de `docs/perf-budget.md`; a tarefa 02
(fluidez do overlay) deve tratar isso com perfil antes/depois.

| Métrica                   |      p50 |      p95 |                 Limite | Resultado     |
| ------------------------- | -------: | -------: | ---------------------: | ------------- |
| Boot/primeira janela (ms) |    938,8 |    955,9 |            informativo | source        |
| Primeiro overlay (ms)     |     93,7 |     95,7 |            informativo | source        |
| Primeiro token fake (ms)  |     20,9 |     22,8 |            informativo | fake          |
| Primeiro áudio fake (ms)  |     36,2 |     42,1 |            informativo | fake          |
| Barge-in fake (ms)        |      4,2 |      5,5 |               ≤ 120 ms | passa         |
| Captura fake (ms)         |  1.579,4 |  1.996,4 |            informativo | fake          |
| Idle CPU (% de um núcleo) |      0,0 |      0,0 |                   < 1% | passa*        |
| Idle RSS (MB)             |    109,3 |    110,3 |                  < 350 | passa         |
| RSS após ciclos (MB)      |    205,3 |    205,4 | ≤ 20 MB de crescimento | falha (95 MB) |
| Overlay FPS               |      165 |      165 |                   ≥ 60 | passa         |
| Bundle main (kB)          | 1.205,52 | 1.205,52 |              registrar | build         |

- A resolução observada de CPU foi 0,0%; não significa uso exatamente zero.
- O RSS de pico pode incluir memória do Chromium durante a captura real de
  tela; a série de 50 ciclos é a referência para regressão do overlay.

## Limitações manuais

Voz real com microfone, temperatura/throttling, bandeja humana, captura de tela
real com DPI/múltiplos monitores, Hub, instalação limpa e bundle distribuído
continuam pendentes. O transporte fake não prova latência de rede, modelo ou
dispositivo físico.
