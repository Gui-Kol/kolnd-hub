# Aparência do avatar - fundação do look de 1951

Documento da task 14. Registra a infraestrutura de aparência criada antes das
tasks 15-23: papéis de material, paleta nomeada, dois acabamentos, grupos de
parte e orçamento de malha. A comparação visual com a referência do usuário é a
task 23; este documento não declara semelhança.

## 1. Escopo

Dentro do escopo: apenas o personagem - corpo, barriga, cabeça, rosto, braços,
mãos, pés, turbante, roupas e adereços que ele segura.

Fora do escopo: cenário (cogumelo, cortinas, fundo e base do narguilé). O
overlay continua transparente, sem fundo pintado.

Esta task não mudou silhueta, pose, geometria, iluminação, sombra, contorno,
câmera, expressões, lip-sync nem o schema do tema. A iluminação do acabamento
ilustrado é a task 19; o tema v2 e as Configurações são a task 21.

## 2. Papéis de material

`CATERPILLAR_MATERIAL_ROLES` em `src/renderer/src/overlay/avatar/caterpillar.ts`
é uma lista fechada e ordenada. Cada papel existe nos dois acabamentos:

| Papel          | Uso previsto                                |
| -------------- | ------------------------------------------- |
| `body`         | segmentos do corpo                          |
| `belly`        | placas claras da barriga                    |
| `head`         | cabeça                                      |
| `eyelid`       | pálpebra pesada                             |
| `brow`         | sobrancelha                                 |
| `sclera`       | branco do olho                              |
| `iris`         | íris                                        |
| `pupil`        | pupila                                      |
| `highlight`    | brilho do olho                              |
| `lip`          | lábio                                       |
| `mouth`        | interior da boca                            |
| `tongue`       | língua                                      |
| `antenna`      | antenas                                     |
| `mandible`     | mandíbulas                                  |
| `hand`         | mãos                                        |
| `sleeve`       | manga do braço                              |
| `claw`         | garras                                      |
| `turban`       | turbante                                    |
| `turbanStripe` | listras do turbante                         |
| `pipe`         | cachimbo                                    |
| `hose`         | mangueira do cachimbo                       |
| `smoke`        | fumaça                                      |
| `outfit`       | roupa herdada (cachecol, gola, viseira)     |
| `accessory`    | acessórios herdados (brilho, espinhos, HUD) |

O antigo papel `eye` virou `sclera`. Nenhum outro nome de malha ou grupo
existente mudou nesta task.

## 3. As duas paletas

### 3.1 Paleta do acabamento `storybook`

`ABSOLEM_1951_PALETTE` em `src/renderer/src/overlay/avatar/palettes.ts`. Os
valores são provisórios e serão ajustados nas tasks 15-19. Toda role tem uma
entrada; `normalizePalette` aceita entrada parcial ou inválida e devolve um
objeto completo, sem lançar.

| Papel          | Hex provisório |
| -------------- | -------------- |
| `body`         | `#4a6fa5`      |
| `belly`        | `#d9e6d3`      |
| `head`         | `#5478b0`      |
| `eyelid`       | `#6c5a8a`      |
| `brow`         | `#2c3e5c`      |
| `sclera`       | `#f2ead8`      |
| `iris`         | `#2f5d8a`      |
| `pupil`        | `#121826`      |
| `highlight`    | `#ffffff`      |
| `lip`          | `#c96f7a`      |
| `mouth`        | `#3a1f2b`      |
| `tongue`       | `#d98a93`      |
| `antenna`      | `#6b8fc4`      |
| `mandible`     | `#e8dcc0`      |
| `hand`         | `#e8a0a8`      |
| `sleeve`       | `#4a6fa5`      |
| `claw`         | `#f0e6cf`      |
| `turban`       | `#5b4a86`      |
| `turbanStripe` | `#d9b45b`      |
| `pipe`         | `#b8863b`      |
| `hose`         | `#4a3b2f`      |
| `smoke`        | `#dfe8f0`      |
| `outfit`       | `#3f5f8f`      |
| `accessory`    | `#d9b45b`      |

### 3.2 Paleta do acabamento `holo`

Não é uma tabela fixa: vem do `ThemeConfig` pelo `themeAdapter` (único módulo
que lê os campos do tema). O holograma usa três cores:

| Campo do tema  | Uso no avatar                                     |
| -------------- | ------------------------------------------------- |
| `primaryColor` | cor do shader de holograma                        |
| `effectColor`  | partículas e efeitos                              |
| `shadow`       | pupilas e boca (material escuro, blending normal) |

Os presets atuais (`classic`, `neon`, `smoke`, `circuit`, `jade`, `amber`)
continuam valendo para o acabamento `holo`. Nenhum preset foi alterado.

## 4. Os dois acabamentos

O acabamento entra por `look` em `AvatarSceneOptions` e é resolvido por
`resolveAvatarLook` em `src/renderer/src/overlay/avatar/looks.ts`.

| Acabamento  | Material por papel                                                     | Estado nesta task                       |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------- |
| `holo`      | `holoMaterial` compartilhado; `pupil` e `mouth` usam o material escuro | reproduz o visual herdado da task 03    |
| `storybook` | `MeshBasicMaterial` opaco por papel, cor plana, `depthWrite: true`     | encanamento pronto, sem iluminação real |

`DEFAULT_AVATAR_LOOK = 'storybook'` por decisão de produto da task 14. Se o
usuário preferir o holograma como padrão, a troca é uma linha nesse arquivo.

A fábrica `createRoleMaterialFactory` é a única dona dos materiais que cria. O
`dispose` é idempotente e não descarta o `holoMaterial` nem o material escuro,
que pertencem à cena. `rebuildCaterpillar` e a degradação recriam a fábrica; o
`dispose` da cena libera a última.

## 5. Flags de desenvolvimento

Lidas do hash do overlay por `parseOverlayFlags`:

| Flag              | Efeito                                                      |
| ----------------- | ----------------------------------------------------------- |
| `?look=holo`      | usa o acabamento holográfico                                |
| `?look=storybook` | usa o acabamento ilustrado de cor plana                     |
| `?slow=1`         | percorre os três níveis de degradação em cerca de 2 s       |
| `?debug=1`        | mostra o HUD com fps, frame, draw calls, triângulos e nível |
| `?fakeVoice=1`    | gera amplitude falsa para a boca                            |

Qualquer outro valor de `look` é ignorado e a cena usa o default. Flags
booleanas só aceitam `1` ou `true`.

Exemplos: `#overlay?look=holo`, `#overlay?look=storybook&debug=1`.

## 6. Contrato de partes

`CaterpillarBuild.parts` expõe grupos estáveis com prefixo `caterpillar-`:

| Chave         | Grupo nesta task                      | Conteúdo futuro            |
| ------------- | ------------------------------------- | -------------------------- |
| `body`        | `caterpillar-body`                    | corpo e barriga            |
| `head`        | `caterpillar-head-group`              | cabeça e rosto             |
| `face`        | `caterpillar-face` (vazio)            | olhos, boca, expressão     |
| `limbs`       | `caterpillar-limbs`                   | braços, mãos, punhos e pés |
| `turban`      | `caterpillar-turban` (vazio)          | turbante e listras         |
| `pipe`        | `caterpillar-pipe` (vazio)            | cachimbo e mangueira       |
| `outfit`      | `caterpillar-outfit-<roupa>` ou vazio | roupa herdada              |
| `accessories` | `caterpillar-accessories`             | acessórios herdados        |

Na task 15, `parts.body` passou a conter, além dos 9 segmentos, os grupos
`caterpillar-belly` (placas claras) e `caterpillar-body-detail` (anéis de dobra
e cauda). `CaterpillarStats` ganhou `bodyBaseY`, o Y local do plano de apoio,
para a task 22 enquadrar o avatar sem flutuação (aplicando o scale da cena).

Na task 16, o rosto vive dentro de `parts.head` (`caterpillar-head-group`); o
grupo estável `parts.face` continua vazio, como o contrato de partes exige.
`CaterpillarBuild` ganhou `lids`, `brows`, `browLeft`, `browRight`, `jaw`,
`mouthCorners`, `nose` e `nostrils`, e o campo legado `mouth` passou de `Mesh`
para `Group` (o grupo da abertura). Os campos `eyeGroups`, `pupils`, `antennae`
e `mandibles` continuam existindo; `eyeGroups[].scale.y` não é mais usado para
piscar.

Os campos legados (`segments`, `head`, `eyeGroups`, `pupils`, `antennae`,
`mandibles`, `mouth`, `outfit`) continuam apontando para os nós existentes.
Somente `scene.ts` e os testes conhecem `caterpillar.ts`; nenhum consumidor
externo importa `parts/*` diretamente.

Na task 18, `turban` e `pipe` deixaram de nascer vazios: a calota, as faixas, o
nó e o pingente vivem em `caterpillar-turban`; a mangueira, a piteira e a
baforada vivem em `caterpillar-pipe`. `face` permanece reservado e vazio.

## 7. Orçamento

O teto de triângulos do personagem subiu de 12000 para **24000** porque o corpo
ilustrado cresce nas tasks 15-18. Números medidos antes desta task, no binário
empacotado da task 13 (ver `docs/perf-budget.md`):

| Recurso             | Limite / meta | Medido na task 13 | Observação                                     |
| ------------------- | ------------- | ----------------- | ---------------------------------------------- |
| Triângulos          | 24000         | 3536              | teto vale para o modo normal                   |
| Draw calls          | 24            | 21                | teto do modo normal; `minimal` reduz a malha   |
| FPS alvo            | 60            | 165               | máquina de referência da task 13               |
| Nível de degradação | 0 a 3         | 0                 | nível 3 reconstrói com 5 segmentos e sem ruído |

Estouro de orçamento **derruba a degradação**, não o teto: o teto é o contrato do
teste (`MAX_CATERPILLAR_TRIANGLES`), e o monitor de desempenho aplica os passos
da task 03. A degradação nível 3 usa `minimal: true`, que força 5 segmentos.

O acabamento `storybook` cria um material por papel efetivamente usado. Na
task 15 o corpo passou a usar `body` e `belly`; `eyelid`, `brow`, `iris`,
`highlight`, `lip`, `tongue`, `hand`, `sleeve`, `claw`, `turban`,
`turbanStripe`, `pipe`, `hose` e `smoke` continuam sem geometria; os grupos
`face`, `limbs`, `turban` e `pipe` seguem vazios. Isso é esperado: as tasks
16-18 preenchem as partes.

## 8. Direito autoral

A recriação é 100% procedural: nenhum asset, textura, modelo ou imagem oficial
entra no aplicativo, no repositorio ou no instalador. A imagem de referência
fornecida pelo usuário fica apenas em `gerente/tasks/Absolem/reference/`, pasta
ignorada pelo git, e não é usada por esta task. O personagem é uma interpretação
local para uso pessoal do usuário, não uma cópia de arquivo de produção.

## 9. Task 15 - corpo sentado

A geometria do corpo saiu de `parts/body.ts`, que passou a ser a dona da curva,
dos segmentos, dos anéis, da barriga, da cauda e da base. O compositor continua
montando `parts.body` e `scene.ts` continua girando `caterpillar.body` no laço.

### 9.1 Ancoragens

`parts/skeleton.ts` é puro e depende só do raio unitário `u` (`u = 1` equivale
ao `PartContext.radius`). A origem é `(0, 0, 0)` no centro do corpo, Y para
cima e Z para a câmera. As 14 âncoras (`hips`, `bellyCenter`, `chest`, `neck`,
`head`, ombros, mãos, pés e `tailTip`) ficam em múltiplos de `u`; as outras
partes chamam `scaleSkeleton(radius)` e não repetem números mágicos.

### 9.2 Proporções do corpo

| Elemento       | Regra na task 15                                                  |
| -------------- | ----------------------------------------------------------------- |
| Curva          | S vertical: quadril, abdômen à frente, tórax atrás, pescoço       |
| Segmentos      | 9 no normal; 5 em `minimal`; nomes `caterpillar-segment-N`        |
| Raio           | 1,30 u no quadril, 1,45 u no abdômen, 0,75 u no pescoço           |
| Achatamento    | 0,46 no eixo do corpo e 0,72 na profundidade (Z) no normal        |
| Anéis de dobra | 8 no normal; 0 em `minimal`; toro com raio menor que o segmento   |
| Barriga        | 5 placas claras (`belly`), em `caterpillar-belly`                 |
| Cauda          | Curva curta saindo de `hips`, enrolada para dentro, ponta redonda |
| Base           | Fundo do primeiro segmento cortado plano; `stats.bodyBaseY`       |

Os anéis e a cauda são concatenados em `caterpillar-body-detail`, uma única
malha com o material `body`. As placas da barriga usam uma `InstancedMesh`
(`caterpillar-belly-plates`) com o material `belly`. Essa divisão mantém a
silhueta e o orçamento de draw calls: os segmentos continuam sendo 9 meshes
independentes, como o contrato de `caterpillar.test.ts` exige.

### 9.3 Medições da task 15

Medido com `?debug=1` no binário buildado, overlay em 320x360, acabamento
`storybook` e `holo` (mesma geometria):

| Recurso    | Limite | Medido na task 15 | Observação                          |
| ---------- | ------ | ----------------- | ----------------------------------- |
| Triângulos | 24000  | 6820              | teto do modo normal                 |
| Draw calls | 24     | 24                | corpo 11 + cabeça 12 + partículas 1 |
| FPS        | 60     | 165               | máquina de desenvolvimento          |
| Degradação | 0 a 3  | 0 -> 3            | `?slow=1` aplicou os três passos    |

A captura em 320x360 confirma a silhueta sentada com barriga clara, anéis de
dobra e cauda enrolada. A captura isolada em 480x560 do harness de teste saiu
com o topo cortado porque a área CSS do avatar ainda é 64x64 (task 22); o
enquadramento final em 480x560 e a comparação visual com a referência ficam
para as tasks 22 e 23. Nenhuma imagem de referência foi embutida no app.

## 10. Task 16 - cabeça, rosto e olhos

A cabeça e o rosto saíram de `parts/head.ts`, com a cena aplicando a pose facial
por `facePose.ts`. O corpo continua em `parts/body.ts` e não foi reescrito. A
referência de 1951 guiou apenas proporções e leitura; nenhuma imagem, textura ou
modelo externo entrou no aplicativo.

### 10.1 Massa craniana, bochechas e papada

| Elemento   | Regra na task 16                                                    |
| ---------- | ------------------------------------------------------------------- |
| Crânio     | Elipsoide `caterpillar-head`, escala X 1.18, topo cortado em 0.84 R |
| Proporção  | Largura/altura do crânio entre 1.15 e 1.30 (medido 1.28)            |
| Topo plano | Vértices acima de 0.84 R achatados no mesmo plano                   |
| Bochechas  | `caterpillar-cheek-left/right`, volumes caídos à frente do crânio   |
| Papada     | `caterpillar-jowl`, abaixo do centro do queixo e à frente           |
| Âncora     | `neck` do corpo mais o delta de `SKELETON.head` (task 15)           |

As bochechas ultrapassam o plano frontal do crânio em Z, e a papada desce abaixo
do ponto mais baixo do crânio. Isso mantém a leitura de bochechas caídas e
papada sem depender de textura.

### 10.2 Sobrancelha e testa

Cada sobrancelha é um tubo sobre `CatmullRomCurve3` na cor `brow`, com um reforço
central que engrossa o arco. Os grupos `caterpillar-brow-left/right` são expostos
em `brows`, `browLeft` e `browRight` para a task 20 animar `browRaise`. A testa
visível fica entre a sobrancelha (0.55 R acima do centro) e o topo plano
(0.84 R), sem competir com a base do turbante da task 18.

### 10.3 Olhos e pálpebras

Cada olho tem `caterpillar-sclera`, `caterpillar-iris`, `caterpillar-pupil`,
`caterpillar-highlight` e uma pálpebra superior própria
(`caterpillar-eyelid`, com a casca `caterpillar-eyelid-shell`). A pálpebra é uma
calota esférica em um pivô: girar o pivô fecha o olho sem esmagar a pupila.

| Estado            | Rotação da pálpebra | Leitura                           |
| ----------------- | ------------------- | --------------------------------- |
| `listening` (1)   | -pi/2               | olho totalmente aberto            |
| `idle` (0.95)     | -0.32               | calota cobre cerca de 35% da área |
| `speaking` (0.88) | ~-0.18              | um pouco mais fechado que `idle`  |
| `error` (0.68)    | ~0.22               | pálpebra pesada, olhar cansado    |
| `thinking` (0.42) | ~0.74               | olhar sonolento/desviado          |
| piscada (0)       | +pi/2               | calota cobre o olho inteiro       |

`facePose.ts` converte `expression.eyeOpenness` em fechamento e aplica em
`lids`. `eyeGroups` continua no contrato, mas seu `scale.y` não é mais tocado;
`pupils` continua disponível para o desvio de olhar da task 20. A piscada segue
a curva existente de `expressions.ts`, abaixo de 3 Hz, e `prefers-reduced-motion`
continua congelando apenas o sway.

### 10.4 Nariz e narinas

O nariz é um elipsoide largo e achatado (`caterpillar-nose`, 1.35 x 0.55 x 0.55
do raio local) na cor `head`, com duas narinas escuras na cor `mouth` dentro de
`caterpillar-nostrils`. Ele fica entre a linha dos olhos e a boca.

Distâncias para a task 19 calibrar a sombra, em múltiplos do raio da cabeça R:

| Medida                                    | Valor aproximado |
| ----------------------------------------- | ---------------- |
| Frente do nariz                           | 1.051 R          |
| Frente do lábio superior                  | 1.035 R          |
| Nariz à frente do lábio em Z              | 0.016 R (~0.004) |
| Base do nariz acima do topo do lábio em Y | 0.054 R (~0.013) |

A folga vertical positiva é o que impede o focinho de cruzar o plano da boca. A
task 19 deve manter a luz suave nessa faixa para não projetar sombra dura no
lábio superior.

### 10.5 Boca, lábios, língua e queixo

A boca é um grupo (`caterpillar-mouth`) com lábio superior
(`caterpillar-lip-upper`), lábio inferior (`caterpillar-lip-lower`), interior
escuro (`caterpillar-mouth-interior`), língua (`caterpillar-tongue`) e dois
cantos (`caterpillar-mouth-corner-left/right`). O `jaw` é o pivô que abre o
queixo e leva o lábio inferior e a língua.

| Situação           | Regra                                                          |
| ------------------ | -------------------------------------------------------------- |
| Repouso            | Lábios se tocam, sem fresta, e os cantos ficam acima do centro |
| `mouthOpen` 0      | Queixo na posição de repouso; nenhum vão entre os lábios       |
| `mouthOpen` 1      | Queixo gira 1 rad; lábios se afastam pelo menos 0.06           |
| `mouthWidth`       | Escala X do grupo da boca move os dois cantos                  |
| `speaking`         | `lip.mouthOpen` articula; `lip.mouthWidth` alarga              |
| `listening`/`idle` | Boca fechada e sorridente                                      |

A cena continua consumindo `expression.eyeOpenness`, `lip.mouthOpen` e
`lip.mouthWidth`; `expressions.ts` e a interface de `lipSync.ts` não mudaram.

### 10.6 Cena e contrato

`applyFacePose(caterpillar, expression, lip)` em `facePose.ts` substitui os
laços antigos de `scene.ts`:

- pálpebras recebem `lidClosureFromOpenness(expression.eyeOpenness)`;
- antenas recebem `expression.antennaLift` e o laço tolera lista vazia;
- boca recebe `lip.mouthOpen` e `lip.mouthWidth` no `jaw` e no grupo `mouth`.

O teste `cena nao quebra com antennae vazio` cobre a lista vazia. O contrato de
`caterpillar.test.ts` passou a aceitar 0 ou 2 antenas, com a justificativa de que
o look novo pode escondê-las sob o turbante (task 18); a contagem de sementes,
vértices e o teto de triângulos não mudaram. `parts-contract.test.ts` continua
verificando todos os nós no root, agora incluindo pálpebras, sobrancelhas, jaw,
cantos e narinas.

### 10.7 Medições e checklist da task 16

Medido no binário buildado, overlay em 320x360, acabamento `storybook`, com
`?debug=1` e `?fakeVoice=1`:

| Recurso    | Limite / meta | Medido na task 16 | Observação                                     |
| ---------- | ------------- | ----------------- | ---------------------------------------------- |
| Triângulos | 24000         | 10328             | abaixo do teto                                 |
| Draw calls | 24 (task 14)  | 43                | rosto detalhado; acima do orçamento da task 14 |
| FPS        | 60            | 165               | máquina de desenvolvimento                     |
| Degradação | 0 a 3         | 0                 | `?slow=1` não foi necessário para esta medição |

O teto de triângulos continua verde. O orçamento de draw calls da task 14 (24)
foi excedido porque cada traço facial é um nó próprio para as tasks 19-20
(pálpebras, sobrancelhas, cantos, língua, narinas). A otimização por mesclagem
fica registrada como pendência para a task 19/23; não foi feita nesta task para
não perder os nós que a task 20 vai animar. **Desvio aprovado pelo usuário em
27/11/2026:** a task 16 segue com 43 draw calls documentados, e a mesclagem
controlada fica obrigatória nas tasks 19/23.

Checklist dos cinco estados, com troca por `window.absolem.avatar.setState`:

| Estado      | Leitura obtida sem a task 20                                     | Pendência                     |
| ----------- | ---------------------------------------------------------------- | ----------------------------- |
| `idle`      | pálpebra em ~35%, boca fechada e sorridente                      | -                             |
| `listening` | pálpebra totalmente aberta, sobrancelha neutra                   | -                             |
| `speaking`  | boca articulando via lip-sync falso; pálpebra um pouco pesada    | -                             |
| `thinking`  | pálpebra mais fechada, cabeça inclinada; pupilas ainda centradas | desvio de pupila: task 20     |
| `error`     | pálpebra pesada, inclinação e cor de alerta; sobrancelha neutra  | sobrancelha franzida: task 20 |

Os testes de `facePose.test.ts` confirmam cinco fechamentos distintos para os
alvos existentes e que `pupils`/`brows` aceitam deslocamento manual, mas a
animação real de pupila e sobrancelha é da task 20 e não foi inventada aqui. A
captura visual dos cinco estados ficou **PENDENTE manual**: o harness Playwright
leu as métricas e não registrou erro de console com `?fakeVoice=1`, mas
`webContents.capturePage()` e `page.screenshot()` expiraram na janela
transparente do overlay, então não há imagem para declarar comparação visual.
O enquadramento em 320x360 e 480x560 continua sendo a task 22.

## 11. Task 17 - braços, mãos e pés

Os membros saíram de `parts/limbs.ts`. O compositor continua montando um grupo
estável por parte; `parts.limbs` deixou de nascer vazio e passou a conter duas
mãos, dois braços, dois punhos e quatro pés. Nenhum membro é animado nesta task:
os grupos ficam prontos para a task 20. Nenhuma imagem, textura ou modelo externo
entrou no aplicativo; a referência de 1951 guiou só proporções e pose.

### 11.1 Mãos

| Elemento  | Regra na task 17                                                         |
| --------- | ------------------------------------------------------------------------ |
| Unidade   | `h = 0,22 R`; a palma tem cerca de 2,5 `h` de largura                    |
| Palma     | Esfera achatada em Z, material `hand`, nó `caterpillar-hand`             |
| Dedos     | 3 cápsulas (`CapsuleGeometry`, 4/5) com material `hand`                  |
| Garras    | 3 cones na ponta dos dedos, material `claw`                              |
| Aperto    | Esquerda 0,16 rad (aberta); direita 1,02 rad (levemente fechada)         |
| `minimal` | 2 dedos por mão e nenhuma garra                                          |
| Nomes     | `caterpillar-hand-left/right`, `-finger-N`, `-finger-N-shaft`, `-claw-N` |

Cada mão é um `Group` próprio (`hands: Group[]` em `CaterpillarBuild`) com o
pivô no punho. A direita fica na altura da boca para receber o cachimbo da task
18; a esquerda fica aberta, com a palma de frente e os dedos caídos sobre a
barriga.

### 11.2 Braços e punhos

| Elemento | Regra na task 17                                              |
| -------- | ------------------------------------------------------------- |
| Curva    | `CatmullRomCurve3` de `shoulder*` até `hand*`, tensão 0,45    |
| Tubo     | Malha manual com quadro de Frenet, 16 anéis por 6 radiais     |
| Raio     | Decrescente de 0,16 R no ombro para 0,085 R no punho          |
| Material | Braço em `hand`; punho `TorusGeometry` fino em `sleeve`       |
| Nomes    | `caterpillar-arm-left/right` e `caterpillar-wrist-left/right` |
| Esquerdo | Desce pela lateral e termina sobre a barriga                  |
| Direito  | Sobe pela lateral do rosto e termina acima da linha do ombro  |

O tubo não usa `TubeGeometry` porque ele só aceita raio constante; a geração
manual evita `BufferGeometryUtils` e qualquer addon novo. O primeiro ponto da
curva fica dentro do tronco, como um encaixe de ombro, e a curva sai para a
lateral antes de descer ou subir. O teste de folga amostra a curva e exige que
o centro do braço fique fora dos elipsoides do corpo inflados pelo raio do tubo
mais 0,02.

As âncoras de `skeleton.ts` foram ajustadas: `handLeft = (-1,05, -1,35, 1,92)`
e `handRight = (1,45, 2,50, 1,55)`, ainda em múltiplos do raio. As duas mantêm
`z > bellyCenter.z`, como o teste de esqueleto exige.

### 11.3 Pés

| Elemento   | Regra na task 17                                                    |
| ---------- | ------------------------------------------------------------------- |
| Quantidade | 4: dois traseiros e dois dianteiros                                 |
| Sapato     | Esfera achatada, escala (1; 0,6; 1,5), raio 0,22 R, material `hand` |
| Ponta      | Arco de toro enrolado (`claw`) na frente do sapato                  |
| Apoio      | Fundo do sapato em `stats.bodyBaseY`, tolerância 0,02               |
| Largura    | Caixa de cada pé dentro da caixa do primeiro segmento (quadril)     |
| Nomes      | `caterpillar-foot-back-left/right` e `-front-left/right`            |
| `minimal`  | Sem a garra enrolada; o sapato permanece                            |

A altura do grupo é `bodyBaseY + 0,6 * raio do pé`, então a sola coincide com a
linha de apoio do corpo. Os pés usam X e Z das âncoras `foot*`; o Y da âncora
não é usado para não duplicar a conta da base.

### 11.4 Contrato, degradação e descarte

- `CaterpillarBuild` ganhou `hands: Group[]` e `feet: Group[]`; `parts.limbs`
  contém os quatro grupos de pé e as duas mãos.
- `parts-contract.test.ts` passou a exigir `parts.limbs` com filhos e a aceitar
  `face`, `turban` e `pipe` ainda vazios. Os campos legados continuam válidos.
- `createPartDispose` libera as geometrias dos membros uma única vez; o
  `dispose` do compositor é idempotente e o rebuild troca a instância de
  `parts.limbs`.
- `minimal` reduz a 2 dedos por mão e remove as garras das mãos e dos pés.
- A cena não mudou: nenhum gesto, rotação ou `facePose` novo. A task 20 pode
  animar `hands`, `feet` e os grupos de dedos sem tocar no compositor.

### 11.5 Medições da task 17

Medido no binário buildado, com a cena real em WebGL, canvas 640x720, acabamento
`storybook`, seed padrão e `?debug=1`:

| Recurso    | Limite / meta | Medido na task 17 | Observação                                      |
| ---------- | ------------- | ----------------- | ----------------------------------------------- |
| Triângulos | 24000         | 12608             | abaixo do teto                                  |
| Draw calls | 24 (task 14)  | 69                | 26 membros + 43 herdados da task 16             |
| FPS        | 60            | 165               | máquina de desenvolvimento                      |
| Degradação | 0 a 3         | 0                 | `minimal` mediu 53 draw calls e 9376 triângulos |

O teto de triângulos continua verde. O orçamento de draw calls **não** foi
cumprido: a task 16 já tinha 43 e os membros acrescentaram 26 (14 de mãos, 2
braços, 2 punhos e 8 de pés). Cada dedo, garra e sapato é um nó próprio para a
task 20 e para os nomes pedidos na task 17. A mesclagem por mão/grupo continua
obrigatória nas tasks 19/23, junto com a otimização já aprovada para o rosto.
**Desvio aprovado pelo usuário em 27/11/2026:** a task 17 segue com 69 draw
calls documentados, e a mesclagem controlada permanece obrigatória nas tasks
19/23. Não há declaração de orçamento cumprido.

### 11.6 Checklist manual da task 17

A captura foi feita em 480x560 pelo harness Playwright na janela opaca de
Configurações, porque a janela transparente do overlay continua expirando no
`page.screenshot()` (mesma limitação registrada na task 16). A imagem confirma:

- mãos rosadas com garras claras; a direita erguida perto da boca e a esquerda
  aberta sobre a barriga;
- quatro pés rosados apoiados na base, dois traseiros e dois dianteiros;
- braços saindo pela lateral, sem atravessar o tronco;
- nenhuma dependência nova, nenhum asset externo e nenhuma imagem de referência
  embutida.

O enquadramento final em 320x360, a comparação lado a lado com a referência e a
otimização de draw calls continuam nas tasks 22, 23 e 19.

## 12. Task 18 - turbante e cachimbo

O turbante saiu de `parts/turban.ts` e o cachimbo de `parts/pipe.ts`. O gate de
produto foi respondido pelo usuário em 27/11/2026: a mangueira, a piteira e a
baforada **entram** no personagem; a base do narguilé, o cogumelo, as cortinas e
o cenário continuam fora. Nenhuma imagem, textura, modelo externo ou
dependência nova entrou no aplicativo. A referência de 1951 guiou só a leitura
do pano enrolado, do nó e da mangueira.

### 12.1 Turbante

| Elemento     | Regra na task 18                                                     |
| ------------ | -------------------------------------------------------------------- |
| Calota       | Esfera parcial achatada, `caterpillar-turban-cap`, material `turban` |
| Raio         | 1,26 R da cabeça, acima da meia-largura do crânio e abaixo de 1,35 R |
| Inclinação   | 12 graus para a direita (`rotation.z` negativa)                      |
| Assentamento | Base desce 0,06 R sobre o topo plano; sem fresta                     |
| Faixas       | 5 arcos parciais de toro em `caterpillar-turban-wraps`               |
| Listras      | Alternância `turban` / `turbanStripe`, espessura mínima 0,03 R       |
| Nó           | 2 lóbulos achatados + dobra + ponto de luz, à direita da testa       |
| Pingente     | `caterpillar-turban-tassel`, 2 esferas, filho do nó                  |
| Antenas      | Continuam no contrato, mas ficam invisíveis sob o pano               |

A calota usa `thetaLength` maior que meia esfera para envolver a borda do topo
plano da task 16. As faixas são toros com arco parcial e rotações diferentes;
não há anéis inteiros flutuando ao redor da cabeça. Os cinco arcos ficam acima
da linha dos olhos e as listras mais finas têm o dobro do tubo acima de 0,03 R,
o que mantém a leitura em 320x360. O nó fica acima da sobrancelha esquerda e à
direita dela, então nunca cobre o arco.

Em `minimal` (degradação nível 3), as faixas somem e restam calota, nó e
pingente. As antenas são escondidas pelo próprio turbante em todos os
acabamentos; `antenna_glow` continua posicionando o brilho herdado.

### 12.2 Mangueira, piteira e baforada

| Elemento  | Regra na task 18                                                     |
| --------- | -------------------------------------------------------------------- |
| Curva     | `CatmullRomCurve3` com 6 pontos, tensão 0,42                         |
| Tubo      | `TubeGeometry` 40 x 6, raio 0,05 R, material `hose`                  |
| Piteira   | Cilindro escuro em `pipe`, ponta a menos de 0,08 do canto direito    |
| Cabeça    | Nenhum ponto da curva entra no bounding box do crânio ou do turbante |
| Baforada  | `Points` com 16 motes, cor `smoke`, opacidade 0,3                    |
| Força     | `setStrength(0..1)`, padrão discreto de 0,45                         |
| Acessível | `setReducedMotion(true)` deixa o draw range em 0                     |
| Descarte  | `dispose` idempotente da mangueira, piteira e baforada               |

A mangueira sai da âncora `handRight`, sobe em laço solto à frente do rosto e
termina no bocal perto da boca. A piteira é a única mesh `pipe` do conjunto; não
existe base de narguilé, água, fumaça de fundo ou cenário. A baforada é um
sistema pequeno e separado das partículas de energia, exposto em
`CaterpillarBuild.smoke` e dentro de `parts.pipe` como
`caterpillar-pipe-smoke`. A cena só aplica movimento reduzido nesta task; a
animação da força e do tempo fica para a task 20.

### 12.3 Contrato e cena

- `CaterpillarBuild` ganhou `turbanTassel` (o pingente que a task 20 move pelo
  canal `antennaLift`) e `smoke` (a API da baforada).
- `parts.turban` e `parts.pipe` agora têm filhos; `parts.face` continua vazio.
- `rebuildCaterpillar` reconstrói turbante e cachimbo junto com o resto. O
  `dispose` do compositor libera as duas partes e a baforada uma única vez.
- `?look=holo` mantém turbante e cachimbo visíveis: o look troca o material,
  não a presença. As medições abaixo são idênticas nos dois acabamentos.
- `?look=storybook` e `?look=holo` abriram sem erro no binário buildado; o HUD
  `?debug=1` leu as métricas reais.

### 12.4 Medições da task 18

Medido no binário buildado, overlay em 320x360, `?debug=1`, seed padrão, com a
janela visível (a sonda de tela cheia do ambiente de teste oculta o overlay
depois de alguns segundos; a leitura foi feita antes disso):

| Recurso    | Limite / meta | Task 17 | Task 18 | Observação                               |
| ---------- | ------------- | ------- | ------- | ---------------------------------------- |
| Triângulos | 24000         | 12608   | 15056   | +2448; abaixo do teto                    |
| Draw calls | 24 (task 14)  | 69      | 80      | +11; orçamento segue excedido            |
| FPS        | 60            | 165     | 165     | máquina de desenvolvimento               |
| Reduzido   | -             | -       | 0 motes | `setReducedMotion(true)` zera a baforada |

O saldo de draw calls é +15 malhas novas (12 do turbante, 2 do cachimbo e 1 da
baforada) menos 4 malhas de antena que deixaram de ser desenhadas: 69 - 4 + 15 = 80. O teto de triângulos continua verde. O orçamento de draw calls **não** foi
cumprido; a mesclagem controlada das tasks 19/23 continua obrigatória e agora
inclui calota, faixas, nó, pingente, mangueira, piteira e baforada. Nenhuma
declaração de orçamento cumprido.

### 12.5 Checklist manual da task 18

- turbante cobre o topo sem fresta, inclinado para a direita;
- cinco faixas com listras largas legíveis em 320x360;
- nó visível acima da testa, à direita, com pingente;
- mangueira na mão direita, piteira perto do canto direito da boca;
- baforada discreta, sem base de narguilé ou cenário;
- `?look=holo` e `?look=storybook` com a mesma presença de turbante/cachimbo.

A comparação visual com a referência e qualquer captura lado a lado continuam
**PENDENTES manuais** nas tasks 22 e 23. O harness leu as métricas do HUD, mas a
janela transparente do overlay continua sem `page.screenshot()` confiável; este
documento não declara semelhança visual.

## 13. Task 19 - materiais toon, iluminação e contorno

Acabamento ilustrado sem geometria nova: mudanças só de material, luz e
contorno. Nenhuma sombra projetada, SSAO, bloom, post-processing, HDRI ou
textura de pele. `castShadow = false`. `palettes.ts`, `ThemeConfig`, `store` e
UI não mudam; `outlineStrength` usa default fixo 0.7 (a task 21 expõe; sem novo
campo de tema). `MAX_CATERPILLAR_TRIANGLES = 24000` respeitado; nenhuma
geometria nova é criada pela cena (o contorno clona a geometria do próprio
mesh).

### 13.1 Tabela de materiais por papel

Módulo `src/renderer/src/overlay/avatar/roleMaterials.ts`. Um material por
papel em cache; mesma instância para o mesmo papel; `dispose` idempotente; só
os materiais criados pela fábrica são liberados (`holoMaterial`, `darkMaterial`
e a rampa da cena não).

No acabamento `storybook` (`look = storybook`):

| Grupo                                                                                                          | Material                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Papéis orgânicos: `body`, `belly`, `head`, `hand`, `sleeve`, `turban`, `turbanStripe`, `lip`, `brow`, `eyelid` | `MeshToonMaterial({ color, gradientMap })`, rampa toon 4 níveis, `NormalBlending`, `depthWrite: true` |
| `pupil`, `mouth`                                                                                               | `MeshBasicMaterial` escuro, não recebe luz                                                            |
| `pipe`, `hose`                                                                                                 | `MeshPhongMaterial`, `shininess` alto (96, > 40), `specular` claro, leitura metálica                  |
| `highlight`                                                                                                    | `MeshBasicMaterial`, não recebe luz                                                                   |
| Demais papéis (`sclera`, `iris`, `tongue`, `antenna`, `mandible`, `claw`, `smoke`, `outfit`, `accessory`, ...) | `MeshBasicMaterial` opaco da paleta                                                                   |

`MeshToonMaterial` sem `gradientMap` não vale: cai em lambertiano e apaga o
estilo. A cor vem da paleta `ABSOLEM_1951_PALETTE` (não alterada).

No acabamento `holo`, nada muda: material de holograma compartilhado para
tudo, exceto `pupil`/`mouth` no material escuro; nenhuma luz; contorno
removido.

### 13.2 Rampa toon de 4 níveis

`src/renderer/src/overlay/avatar/toonGradient.ts`, `createToonGradient()`:

- `DataTexture` nativo do three, 4x1 pixels, formato `RGBAFormat`, tipo
  `UnsignedByteType`, sem asset externo;
- 4 níveis em escala de cinza (tons `64`, `128`, `192`, `255`, alfa 255), do
  mais sombreado ao totalmente iluminado;
- `magFilter = minFilter = NearestFilter`; `generateMipmaps = false`;
  `needsUpdate = true` (no three r187, `needsUpdate` é setter que incrementa
  `version`);
- `gradientMap` para `MeshToonMaterial`; `dispose()` libera a textura, é
  idempotente; a cena é dona e a libera no `dispose`.

Fps em idle abaixo de 45 na máquina de referência reduziria a rampa para 3
níveis antes de cortar partes; não foi necessário (ver 13.9).

### 13.3 Iluminação

Só no look `storybook`; no `holo` nenhuma luz é adicionada (comportamento da
task 18). Decisão pura testável `shouldCreateStorybookLights(look)`.

| Luz                | Tipo               | Intensidade | Posição / direção                              | Sombra                            |
| ------------------ | ------------------ | ----------- | ---------------------------------------------- | --------------------------------- |
| `AmbientLight`     | `AmbientLight`     | 0.65        | -                                              | `false`                           |
| `DirectionalLight` | `DirectionalLight` | 1.0         | esquerda, acima e à frente: `(-1.2, 1.6, 1.8)` | `castShadow = false`, sem sombras |

Sem recriar renderer/câmera/loop. `dispose` remove as luzes e chama `dispose`.

### 13.4 Contorno (outline)

`src/renderer/src/overlay/avatar/outline.ts`, `createOutline(mesh, options)`.
Só no look `storybook`. Não recria renderer/câmera/loop; não anima contorno;
não mescla malhas.

- Clona a geometria do mesh; cria filho `Mesh` com
  `MeshBasicMaterial({ color, side: BackSide, depthWrite: true })`, material
  limpo (`depthWrite:false` herdado do holograma não vaza; `depthTest` ligado);
- escala uniforme do filho em 1.03-1.05 no eixo normal; filho acompanha
  transformações do pai; `renderOrder` um a menos; `frustumCulled` herdado;
- `outlineStrength` (default 0.7; 0 desliga; força >0 ajusta a escala dentro
  de 1.03-1.05); nome `caterpillar-outline`;
- `dispose()` remove o filho, libera a geometria clonada e o material;
  idempotente; `addOutlines` / `removeOutlines`; `clearOutlines` na cena.

Aplica somente nos grupos de silhueta `parts.body`, `parts.head`, `parts.limbs`,
`parts.turban`. NUNCA em: listras finas (`turbanStripe`, `caterpillar-turban-wrap-*`),
pálpebras (`eyelid`), pupilas (`pupil`), olhos (`sclera`, `iris`), nariz
(`nose`, narinas), boca/lábios (`mouth`, `lip`, `tongue`, `jaw`, `mouthCorner`),
detalhes finos do nó do turbante (`knot-fold`, `knot-highlight`), pingente
(`tassel`), baforada (`smoke`), `pipe`, `hose`, `highlight`, `mouth`. Dentro de
`parts.head`, `parts.body`, `parts.limbs`, `parts.turban`, nós excluídos por
nome/`userData.materialRole` não recebem contorno. `parts.pipe`, `parts.face`,
`parts.outfit`, `parts.accessories` não recebem contorno.

### 13.5 Regra `holo` intacto vs `storybook`

`holoMaterial.ts` não é alterado; `holoMaterial.test.ts` não é editado e fica
verde. `?look=holo` idêntico à task 18:

- `AdditiveBlending`, `depthWrite: false`, `uNoise`, scanlines, `DoubleSide`,
  `depthTest`, `transparent`, `uTime`, `uColor`, `uIntensity`, `uScanlineSpeed`,
  `uFresnelPower`, shader inalterado; `computeHoloAlpha` intocado;
- `holo` sem luz, sem contorno; material escuro para `pupil`/`mouth`;
- `?look=holo` preserva presença de turbante/cachimbo (o look troca material,
  não presença).

`?look=storybook` (default) lê como personagem ilustrado. Troca de acabamento
ao vivo por `setLook` (`storybook <-> holo`) sem recriar renderer, câmera ou
loop e sem recriar `holoMaterial`; `applyLookToScene`. Ao trocar para `holo`,
luzes e contorno são removidos.

### 13.6 Tone mapping

`renderer.toneMapping`: `ACESFilmicToneMapping` só no look `storybook`;
`NoToneMapping` no `holo` (e restaurado ao trocar). Decisão pura
`resolveToneMapping(look)`. Sem mudança global de color space; `holo` nunca é
afetado. Sem `toneMapping` customizado fora disso.

### 13.7 Troca de tema sem recriar malha (T6)

`applyTheme` (troca de paleta/acabamento) não recria renderer/câmera/loop.

- Só a cor muda: atualiza cores dos materiais existentes (`setPalette` +
  `syncMaterialColors`; `holoMaterial.uColor`, `darkMaterial.color`) sem
  recriar a malha (`rebuildCaterpillar` não é chamado);
- reconstrói a malha quando mudam estilo, roupa ou acessórios;
- mudar a presença de contorno (`outlineStrength` 0 <-> >0; `setOutlineStrength`)
  reconstrói só o contorno, não a malha. Lógica pura em `sceneTheme.ts`
  (`applyThemeChange`); `smokeStrength` não é tocada aqui (task 20).

### 13.8 Degradação (T5)

`perf.ts`, três passos monotônicos; `applyDegradation`. Custo do contorno:
dobra os draw calls das partes com silhueta (um filho `caterpillar-outline`
por mesh), sem nova geometria procedural (clones só para o contorno).

| Nível | Ações (além das herdadas)                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `pixelRatio` fixo em 1                                                                                                                  |
| 2     | metade das partículas + remove contorno de partes pequenas (`removeSmallOutlines`)                                                      |
| 3     | 5 segmentos + sem ruído + remove todo o contorno + reduz direcional para ambiente apenas (`removeOutlines`, `directionalToAmbientOnly`) |

`degradationEffectsForLevel(level)`. No nível 3, `directionalLight` é removida;
`AmbientLight` permanece. Não afeta `holo`.

### 13.9 Medição honesta (T5)

Baseline da task 18 (commit `46979c81`, máquina de desenvolvimento, overlay
320x360, `?debug=1`, seed padrão): 80 draw calls / 15.056 triângulos / 165 fps.
Orçamento histórico de 24 draw calls NÃO está cumprido (já excedido nas tasks
16/17/18); mesclagem/otimização de draw calls fica para tasks 19/23 mas esta
task não adiciona geometria e não declara 24 cumprido.
`MAX_CATERPILLAR_TRIANGLES = 24000` respeitado para `caterpillar.stats`.

Medição analítica (Node, `buildCaterpillar({ seed: 1 })`, sem GPU, reproduzível;
conta `isMesh` + `index/position`; +1 `Points` da baforada; partículas de
energia não contadas aqui; baseline real usa `renderer.info`):

| Cenário (só lagarta)                          | Draw calls (meshes) | Triângulos |
| --------------------------------------------- | ------------------- | ---------- |
| Baseline sem contorno (tarefa 18 equivalente) | ~82 + 1 Points      | ~14.736    |
| Com contorno `storybook` (outlineStrength .7) | ~135 + 1 Points     | ~24.488    |
| Nível 3 (sem contorno, `minimal`)             | reduz               | reduz      |

A camada extra de contorno aproximadamente dobra as draw calls das partes com
silhueta; número exato final vem de `renderer.info` com `?debug=1`.

Pendência manual honesta: medição real com `?debug=1` no binário buildado na
máquina de referência (Windows 11, 4 núcleos, 16 GB, GPU integrada),
antes/depois (baseline task 18 80/15.056/165), 60 s em idle com overlay
visível, fps idle >= 45 (ou redução da rampa para 3 níveis), captura visual
(`?look=storybook` ilustrado: corpo azul, barriga clara, mãos rosas, turbante
listrado, cachimbo dourado, contorno uniforme sem vazamento pelos olhos;
`?look=holo` idêntico à task 18; contorno em 320x360 sem engrossar em 480x560;
troca de look ao vivo) e checklist manual da task ficam como pendência de
máquina/humano; não há captura confiável neste ambiente (janela transparente
sem `page.screenshot()`, GPU real indisponível) e nenhum número de fps foi
inventado. `smokeStrength` continua para a task 20.
