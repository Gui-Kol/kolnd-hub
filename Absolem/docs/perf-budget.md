# Orçamento de desempenho

Documento da task 13 (T10). Registra método e números medidos na máquina de
referência. Data: **2026-11-26**. Versão do app: **0.1.0**. Artefato:
`Absolem/dist/win-unpacked/Absolem.exe`, reconstruído com `npm run build` +
`npm run package:dir` nesta data.

## 1. Ambiente

| Item                | Valor                                                           |
| ------------------- | --------------------------------------------------------------- |
| Windows             | 10.0.26300 (x64)                                                |
| Núcleos lógicos     | 16                                                              |
| Node usado no build | 26.13.1                                                         |
| Electron            | 28.3.3                                                          |
| App                 | `dist/win-unpacked/Absolem.exe` (não assinado)                  |
| userData            | diretório temporário (`ABSOLEM_TEST_USERDATA`), sem dados reais |
| Chave Gemini        | nenhuma; o app abre a primeira configuração e fica utilizável   |
| Rede                | sem chamadas; nenhuma sessão de voz iniciada                    |

O app foi aberto pelo Playwright `_electron` apenas para ler
`process.cpuUsage()` e `process.memoryUsage()` do main e as janelas reais. Não
é `npm run dev`: é o binário empacotado.

## 2. Método

1. Iniciar o executável empacotado com userData temporário.
2. Fechar a janela de Configurações da primeira execução (o app fica na
   bandeja) e aguardar 2 s.
3. Amostra **oculta**: 60 s com o overlay escondido; ler
   `process.cpuUsage()` e `process.memoryUsage()` antes/depois.
4. Mostrar o overlay pelo mesmo caminho da segunda instância/bandeja e aguardar
   5 s de aquecimento.
5. Amostra **visível**: 60 s com o overlay ativo; mesmas leituras, mais
   `window.__absolemAvatarMetrics()` no renderer.
6. Ciclos: 50 vezes `overlayHide` -> 100 ms -> `overlayShow` -> 100 ms, depois
   2 s de estabilização; comparar RSS do main e heap do renderer.
7. Fórmula de CPU: `(cpuUsage.depois - cpuUsage.antes) / tempo / 1000` em % de
   **um núcleo**. Para % de todos os 16 núcleos, dividir por 16.

## 3. Números medidos

| Métrica                           | Oculto                               | Visível                                       | Meta                      | Resultado |
| --------------------------------- | ------------------------------------ | --------------------------------------------- | ------------------------- | --------- |
| CPU média                         | **0,3% de um núcleo** (0,02% dos 16) | **0,5-0,6% de um núcleo** (0,03-0,04% dos 16) | oculto < 1%; visível < 2% | Passa     |
| Memória de trabalho (RSS do main) | **102,7 MB**                         | **106,3-107,1 MB**                            | < 350 MB                  | Passa     |
| Heap do main                      | 9,1 MB                               | 9,6-9,7 MB                                    | informativo               | Passa     |
| Memória externa do main           | 2,3 MB                               | 2,3 MB                                        | informativo               | Passa     |
| FPS do avatar                     | -                                    | **165 fps**, frame 6,1 ms                     | 60 fps                    | Passa     |
| Draw calls / triângulos           | -                                    | 21 / 3.536                                    | informativo               | Passa     |
| Degradação do avatar              | -                                    | 0                                             | informativo               | Passa     |

Observação honesta: na amostra visível automatizada a janela de Configurações
também ficou aberta em alguns ciclos (o Playwright precisa de uma página para
comandar o overlay). Isso torna o número **conservador**: uma janela extra
visível não reduz o consumo. A amostra oculta foi feita com Configurações
fechada (somente bandeja).

## 4. Ciclos de mostrar/ocultar

| Medida           | Antes    | Depois de 50 ciclos | Variação    | Limite               |
| ---------------- | -------- | ------------------- | ----------- | -------------------- |
| RSS do main      | 120,6 MB | 113,2 MB            | **-7,4 MB** | crescimento <= 20 MB |
| Heap do main     | 11,5 MB  | 10,5 MB             | -1,0 MB     | informativo          |
| Heap do renderer | 10,0 MB  | 10,0 MB             | 0 MB        | crescimento <= 20 MB |

Não houve crescimento; o RSS até caiu após a estabilização. O teste usou o
mesmo caminho de `overlay:hide`/`overlay:show` do IPC, não um mock.

## 5. `process.memoryUsage()` do main

Registrado nas duas amostras e nos ciclos:

- oculto: RSS 102,7 MB, heap 9,1 MB, external 2,3 MB;
- visível: RSS 106,3 MB, heap 9,6 MB, external 2,3 MB;
- antes/depois de 50 ciclos: RSS 120,6 -> 113,2 MB, heap 11,5 -> 10,5 MB.

Não há vazamento monotônico nesse recorte.

## 6. Pendente manual (ambiente não disponível)

Os itens abaixo **não foram medidos** nesta execução e não são declarados
validados:

1. **10 sessões de voz curtas** com chave Gemini real e microfone: latência,
   CPU e memória durante o Live, incluindo barge-in.
2. **10 minutos com o overlay ativo** e medição térmica com HWiNFO ou Monitor
   de Desempenho: temperatura de CPU/GPU estável e ausência de throttling
   perceptível.
3. **50 ciclos pelo menu da bandeja em uma sessão de desktop real** (o teste
   automatizado usou o mesmo IPC, mas não o clique humano).
4. **Instalação limpa em VM sem Node** com o NSIS e abertura em primeiro uso
   real; isso também está no checklist de release.

Esses itens exigem chave, microfone e ferramenta de temperatura; não há número
inventado neste documento. Quando executados, atualizar a tabela com data,
versão e medição.

## 7. Como repetir

```powershell
cd Absolem
npm run build
npm run package:dir
# iniciar dist\win-unpacked\Absolem.exe com ABSOLEM_TEST_USERDATA apontando
# para uma pasta temporária e medir process.cpuUsage()/process.memoryUsage()
```

Não medir com `npm run dev`: o Vite/HMR e o DevTools distorcem CPU e memória.
Não usar o perfil real do usuário: sempre `ABSOLEM_TEST_USERDATA` temporário.
