# Medindo recursos do Kolnd Hub

Harness criado na task `00` de `gerente/tasks/otimizacao-recursos/`. Serve para
comparar **antes/depois** de qualquer otimização com o mesmo instrumento. Nada
aqui altera o app: os scripts são externos e os specs Playwright só leem o
renderer (FCP/marcos via `performance`, frames via `requestAnimationFrame`).

> Regra de ouro: número sem a carga da máquina ao lado não é baseline. Registre
> CPU total do sistema, processos pesados de outras sessões e a hora da medição.

## Pré-requisitos

- Windows 10/11, PowerShell 5.1 (os `.ps1` são ASCII puro de propósito).
- `kolnd-hub/` com dependências instaladas (`npm ci`).
- Build de produção atualizado **uma vez**:

```powershell
cd "C:\caminho\para\Kolnd Hub\kolnd-hub"
npm run build
```

Os specs e2e rodam o Electron real de `out/`. Sem build novo, você mede código
antigo.

## 1. CPU e RAM da árvore de processos

O Hub vive em vários processos (main, renderer, GPU, utility, filhos do
`hwmon`). Medir só o processo raiz esconde a maior parte do custo; o script
resolve a árvore inteira por `ParentProcessId`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\perf\measure-process.ps1 `
  -RootPid 12345 -Seconds 60 -OutFile .\out\perf\b1-dashboard.csv -Label b1-dashboard
```

Parâmetros:

| Parâmetro | Obrigatório | Descrição |
| --- | --- | --- |
| `-RootPid` | sim | PID do processo principal do app (`electron.exe` em dev, `Kolnd Hub.exe` no pacote). |
| `-Seconds` | não (60) | Duração em segundos de **parede** (amostras alinhadas ao relógio). |
| `-OutFile` | sim | CSV de saída (o diretório é criado se faltar). |
| `-Label` | não | Rótulo que entra na linha de resumo. |

Saída: cabeçalho `timestamp,pid,name,cpuPercent,workingsetMb,privateMb`, uma
linha por processo + uma linha `pid=0,name=TOTAL` por segundo. No fim, uma linha
`#SUMMARY,...` com `samples`, `cores`, `avgCpuPercent`, `p95CpuPercent`,
`maxCpuPercent`, `avgCpuPercentOfMachine`, `avgWorkingSetMb`, `p95WorkingSetMb`,
`avgPrivateMb`, `p95PrivateMb`.

Como ler:

- `cpuPercent` é **% de um núcleo** (o TOTAL pode passar de 100 em máquinas
  multi-core). Para comparar com o Gerenciador de Tarefas, use
  `avgCpuPercentOfMachine` (TOTAL ÷ núcleos lógicos).
- CPU vem do delta de `TotalProcessorTime` entre amostras — não depende de
  contadores localizados (`\Process(*)\% Processor Time`).
- `workingsetMb` é a memória residente; `privateMb` é o privado do processo.
- Linhas de processos novos usam o `TotalProcessorTime` inteiro na primeira
  amostra em que aparecem (é a única forma de não zerar filhos curtos).

Achar o PID raiz:

```powershell
# dev (electron-vite / e2e)
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -notmatch '--type=' } |
  Select-Object ProcessId, CommandLine

# instalado
Get-Process -Name 'Kolnd Hub' | Select-Object Id
```

## 2. Criação de processos (churn)

O ofensor nº 1 do relatório é o `hwmon`, que cria `powershell.exe`/`nvidia-smi`
a cada tick. Este script conta **PIDs novos** por nome.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\perf\count-spawns.ps1 `
  -RootPid 12345 -Seconds 30 -OutFile .\out\perf\b1-spawns.csv
```

Parâmetros:

| Parâmetro | Obrigatório | Descrição |
| --- | --- | --- |
| `-Seconds` | não (60) | Duração de parede. |
| `-OutFile` | sim | CSV de saída. |
| `-Names` | não | Lista separada por vírgula. Padrão: `powershell,nvidia-smi,winget,msiexec,node`. |
| `-RootPid` | não (0 = global) | Conta só descendentes deste PID. **Use sempre que possível**: o modo global captura atividade de outros apps. |

Saída: linhas `#SPAWN,<timestamp>,<nome>,<pid>` (eventos, para depurar
cadência), depois o CSV `name,spawns,spawnsPerMinute` e a linha `TOTAL`.

Limitação: cada amostra é um `Get-CimInstance Win32_Process` que custa
~100 ms nesta máquina; na prática a cadência efetiva fica em ~100–200 ms e
processos que vivem menos que isso podem escapar. Para o `hwmon` (tick de
600 ms+) isso não é problema.

Validação rápida do contador:

```powershell
# em uma janela: inicia a contagem por 8 s
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\perf\count-spawns.ps1 `
  -Seconds 8 -OutFile .\out\perf\t2-check.csv -Names 'nvidia-smi'

# em outra, durante a contagem:
Start-Process nvidia-smi -Wait
# Resultado esperado: nvidia-smi,1
```

O exemplo usa o modo global (sem `-RootPid`): se outro programa também chamar
`nvidia-smi` no mesmo período, a contagem sobe. Para atribuir ao Hub, passe o PID
raiz.

## 3. Abertura, frames e cenários (Playwright)

Os specs ficam em `kolnd-hub/tests/e2e/perf-*.spec.ts` e **não** fazem parte do
`npm run verify` (são e2e). Eles são um harness **manual**: só rodam com
`KOLDND_HUB_PERF=1`. Sem a flag os testes são **skipped** (a suíte normal do
`npm run test:e2e` segue rápida, sem os ~10–12 min de medição). Rode um por vez,
com contexto isolado:

```powershell
cd "C:\caminho\para\Kolnd Hub\kolnd-hub"

$env:KOLDND_HUB_PERF = '1'
$env:KOLDND_HUB_E2E_CONTEXT = Join-Path $env:TEMP 'kolnd-e2e-perf.json'
Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue

$env:KOLDND_HUB_PERF='1'; npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/perf-startup.spec.ts
$env:KOLDND_HUB_PERF='1'; npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/perf-frames.spec.ts
$env:KOLDND_HUB_PERF='1'; npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/perf-scenarios.spec.ts
```

`KOLDND_HUB_E2E_CONTEXT` precisa apontar para um **arquivo** `.json` (o global
setup escreve o contexto ali). Sem ele, o default é
`%TEMP%\kolnd-hub-e2e-context.json` e você pode colidir com outra sessão.

### O que cada spec mede

| Spec | Cenário | O que sai |
| --- | --- | --- |
| `perf-startup.spec.ts` | T3: 3 aberturas (1 warm-up descartado) | FCP, first paint, `domContentLoaded`, `load`, `responseEnd`, tempos de parede até a janela/heading. JSON em `out/perf/startup-*.json`. |
| `perf-startup.spec.ts` | B7: abrir com HUD ligado | FCP, primeiro `hud:update` (via `capturedAt` do main), spawns dos primeiros 10 s. JSON em `out/perf/b7-*.json`. |
| `perf-frames.spec.ts` | T4: Dashboard por 60 s | frame gap p50/p95/máx, gaps > 100 ms, long tasks (`PerformanceObserver`). JSON em `out/perf/frames-dashboard-*.json`. |
| `perf-frames.spec.ts` | B6: Big Picture com 40 jogos por 60 s | os mesmos números na grade virtualizada. JSON em `out/perf/frames-big-picture-*.json`. |
| `perf-scenarios.spec.ts` | B1–B5 | CSV de CPU/RAM (60 s) + spawns (30 s) + cadência do `hwmon` (B4) + invocações de `winget` no `stubs.log` (B5). JSON em `out/perf/scenario-*.json`. |

Cada teste cria o próprio `userData` em `%TEMP%` (flag de first-run semeada,
HUD desligado por padrão). O contexto e2e global só empresta o diretório de
stubs (`winget.exe`/`msiexec.exe`), necessário no B5.

### Cenários do baseline

| Cenário | Como o spec monta |
| --- | --- |
| B1 | Dashboard visível, após 3 s de acomodação. |
| B2 | Fecha a janela pelo X (`BrowserWindow.close()`), o app oculta para a bandeja; HUD desligado. |
| B3 | `window.api.hudSetVisible(true)` no renderer, espera a janela `#hud` visível, depois fecha a principal (bandeja). |
| B4 | Meu PC → aba Monitor; `window.api.hwmonSetInterval(500)`; mede também a cadência real dos pushes (`onHwMonitorUpdate`). |
| B5 | Meu PC → aba Atualizações, conta linhas `winget` no `stubs.log`; o stub responde `--version` e JSON em `--output json` (1 item), então a 1ª ativação faz 2 invocações e a 2ª, em < 10 min, deve ser 0 (cache do main); sai para Ferramentas e volta a Meu PC para reativar. |
| B6 | 40 jogos semeados no `config.json`, entra no Big Picture pela UI. |
| B7 | `config.json` com `hud.visible = true`; mede abertura + spawns dos 10 s iniciais. |

### Limitações conhecidas

- **Primeira execução é warm-up.** O `perf-startup` já descarta uma abertura;
  nos scripts, rode uma vez e descarte antes de comparar.
- **Sampling de 1 Hz** (T1) pode perder filhos que vivem menos de 1 s; o CPU de
  um PID novo é atribuído ao primeiro intervalo em que ele aparece.
- **`count-spawns` pesa** (~100 ms de CIM por amostra). Por isso os specs rodam
  CPU/RAM primeiro e spawns **depois**, nunca ao mesmo tempo.
- **FCP/marcos** vêm de `performance.getEntriesByType('paint'|'navigation')`:
  é o que o Chromium expõe, sem `performance.mark` no código de produção.
- **Primeiro `hud:update`**: o spec anexa a sonda assim que a janela `#hud`
  existe; o instante reportado é o `capturedAt` do primeiro update que chegou
  depois do attach. Se a sonda anexar tarde, o número é o próximo push (≤ 1 s).
- **Spawns do B7**: o `count-spawns` começa ~0,5–1 s depois do launch (startup
  do PowerShell); a janela de 10 s não inclui esses primeiros instantes.
- **Frames**: `requestAnimationFrame` pausa com a janela oculta. Os testes B6/T4
  mantêm a janela visível; não meça frames na bandeja. Se o Chromium throttlar a
  janela (oclusão), a sonda coleta menos de 300 frames em 60 s — o spec foca a
  janela pelo main (`show`/`focus`/`moveTop`) e repete uma vez; a tentativa
  inválida não entra no resumo.
- **HUD com atalho ocupado**: `Shift+Insert` pode estar em uso por outro app. A
  visibilidade não depende do atalho; o spec usa o IPC, então a medição segue
  válida.
- **Carga externa**: outro `npm run dev`, jogo aberto ou sessão paralela de e2e
  muda o número. Registre a carga (`Get-CimInstance Win32_Processor`) e a hora.
- **Máquina de referência do baseline (26/11/2026):** Ryzen 7 5700X (8C/16T),
  23,9 GB RAM, RTX 5060 Ti 8 GB, Windows 11 Pro 10.0.26300; medições feitas com
  outra instância em `npm run dev` ativa e gravação de tela (carga de 16–43%).
  Os números brutos
  daquela sessão estão em `gerente/tasks/otimizacao-recursos/baseline-2026-11-26.md`.

## 4. Consolidando repetições

Depois de rodar cada cenário 3×:

```powershell
node .\scripts\perf\summarize.mjs
# ou: node .\scripts\perf\summarize.mjs --dir .\out\perf
```

Ele lê todos os JSONs de `out/perf/` e imprime medianas + faixa (min..max) de
CPU/RAM/spawns por cenário, FCP das aberturas, frames e B7. Sem dependências.

## 5. Onde ficam os artefatos

- `kolnd-hub/out/perf/*.csv` e `*.json` — brutos, ignorados pelo git.
- `gerente/tasks/otimizacao-recursos/baseline-2026-11-26.md` — tabela
  consolidada (a pasta `gerente/tasks/` é ignorada).
- Nada em `out/perf/` deve ser commitado.
