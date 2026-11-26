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

| Chave         | Grupo nesta task                      | Conteúdo futuro        |
| ------------- | ------------------------------------- | ---------------------- |
| `body`        | `caterpillar-body`                    | corpo e barriga        |
| `head`        | `caterpillar-head-group`              | cabeça e rosto         |
| `face`        | `caterpillar-face` (vazio)            | olhos, boca, expressão |
| `limbs`       | `caterpillar-limbs` (vazio)           | braços, mãos e pés     |
| `turban`      | `caterpillar-turban` (vazio)          | turbante e listras     |
| `pipe`        | `caterpillar-pipe` (vazio)            | cachimbo e mangueira   |
| `outfit`      | `caterpillar-outfit-<roupa>` ou vazio | roupa herdada          |
| `accessories` | `caterpillar-accessories`             | acessórios herdados    |

Os campos legados (`segments`, `head`, `eyeGroups`, `pupils`, `antennae`,
`mandibles`, `mouth`, `outfit`) continuam apontando para as meshes existentes.
Somente `scene.ts` e os testes conhecem `caterpillar.ts`; nenhum consumidor
externo importa `parts/*` diretamente.

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

O acabamento `storybook` cria um material por papel efetivamente usado. Nesta
task o número de materiais é pequeno porque `belly`, `eyelid`, `brow`, `iris`,
`highlight`, `lip`, `tongue`, `hand`, `sleeve`, `claw`, `turban`,
`turbanStripe`, `pipe`, `hose` e `smoke` ainda não têm geometria; os grupos
`face`, `limbs`, `turban` e `pipe` estão vazios. Isso é esperado: as tasks
15-18 preenchem as partes.

## 8. Direito autoral

A recriação é 100% procedural: nenhum asset, textura, modelo ou imagem oficial
entra no aplicativo, no repositorio ou no instalador. A imagem de referência
fornecida pelo usuário fica apenas em `gerente/tasks/Absolem/reference/`, pasta
ignorada pelo git, e não é usada por esta task. O personagem é uma interpretação
local para uso pessoal do usuário, não uma cópia de arquivo de produção.
