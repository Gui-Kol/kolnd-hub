# Base de conhecimento do Kolnd Hub

Documento da task 35. Explica como o Absolem responde dúvidas sobre o Kolnd Hub
sem inventar recurso, e como atualizar essa base quando o Hub mudar.

## O que é

São duas camadas, com custo de token controlado:

1. **Bloco compacto no prompt** — `buildHubOverview()` em
   `src/main/knowledge/hubKnowledge.ts`. Entra em `buildSystemPrompt()` e
   acompanha **todas** as chamadas (texto e voz), trazendo o mapa das telas, onde
   ficam os dados e as regras de resposta.
2. **Ferramenta `hub_help`** — `src/main/knowledge/hubTool.ts`. Recebe `topic`
   (1 a 120 caracteres), consulta a mesma base e devolve no máximo **2 seções**
   (até 1.500 caracteres de corpo no total), mais `overview` e `hubVersion`.
   Sem resultado, devolve o `overview` e a lista de tópicos disponíveis.

A versão do Hub no resultado vem de `resolveHubVersion(env, 'desconhecida')`
(`src/shared/version.ts`); o Hub injeta `ABSOLEM_HUB_VERSION` ao abrir o
Absolem. O ambiente é injetável para teste puro.

## Fontes da verdade

O conteúdo é copiado da documentação e das telas reais do repositório — nunca
deduzido:

- `README.md` (raiz): o que tem no Hub, programas gerenciados, acesso remoto,
  instalação, desinstalação e segurança/distribuição.
- `kolnd-hub/README.md`: comandos, primeira execução, UAC, Big Picture,
  desinstalação e solução de problemas.
- `docs/architecture.md`: processos, store, first-run, HUD, Big Picture e IPC.
- `CHANGELOG.md`: recursos das versões recentes.
- `kolnd-hub/src/renderer/src/components/Topbar.tsx` e `MegaMenu.tsx`: nomes das
  páginas e do Big Picture.
- `kolnd-hub/src/renderer/src/components/Settings.tsx`: seções reais de
  Configurações.
- `kolnd-hub/src/renderer/src/config/apps.ts`: cards padrão.

Se um assunto não estiver documentado, a resposta correta é dizer que **não está
documentado** e indicar em qual página do app conferir. Não complete a lacuna por
dedução.

## As 13 seções

`visao-geral`, `ferramentas`, `biblioteca`, `meu-pc`, `hud`, `big-picture`,
`acesso-remoto`, `primeira-execucao`, `configuracoes`, `desinstalacao`,
`privacidade-seguranca`, `problemas-comuns` e `limites`.

Cada seção tem `id`, `title`, `body` e `keywords` (estas só servem à busca e não
vão para o modelo). A busca normaliza maiúsculas e acentos, ignora artigos e
preposições comuns e pontua título, palavras-chave e corpo.

## Limites de tamanho

- `body` de cada seção: **até 600 caracteres**.
- Soma dos `body`: **até 8 KB** em UTF-8.
- `buildHubOverview()`: bloco compacto de **~1,2 a 1,8 KB**; o teste exige até
  1.800 bytes.
- `hub_help`: no máximo **2 seções** e **1.500 caracteres** de corpo somados.

Os limites são verificados em `hubKnowledge.test.ts` e `hubTool.test.ts`.

## Como atualizar

1. Confira a mudança na fonte (README, `docs/architecture.md`, CHANGELOG ou a
   tela real) antes de escrever qualquer coisa.
2. Edite a seção correspondente em `src/main/knowledge/hubKnowledge.ts`, mantendo
   o vocabulário exato das telas: **Ferramentas**, **Biblioteca**, **Chat**,
   **Meu PC**, **Configurações** e **Big Picture**; dentro de Meu PC:
   **Inicialização**, **Tela**, **Atualizações**, **Limpeza**, **Memória**,
   **Benchmark** e **Monitor**.
3. Ajuste as `keywords` se o tema mudou de nome.
4. Suba `HUB_KNOWLEDGE_VERSION` (SemVer da base, hoje `1.0.0`) sempre que o
   conteúdo mudar. Se o bloco do prompt ou as regras em
   `src/main/gemini/prompts.ts` mudarem, suba também `PROMPT_VERSION`.
5. Rode `npx vitest run src/main/knowledge src/main/gemini/prompts.test.ts` e,
   no fim, `npm run verify`.

## Regras de resposta (no prompt)

- Usar o bloco e o `hub_help` para perguntas sobre o Hub.
- Responder em passos curtos, no vocabulário das telas.
- Nunca inventar recurso, botão ou caminho; se não estiver na base, dizer que não
  está documentado e indicar onde ver no app.
- Não abrir telas nem alterar configurações por conta própria: é uma ação e
  exige pedido e confirmação do usuário.
- Sem emoji, sem segredo, sem caminho pessoal (`C:\Users\...`) e sem token no
  conteúdo.
