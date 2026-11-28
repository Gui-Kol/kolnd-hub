# Matriz de consentimentos e revogação

Documento da task 13 (T2). Lista cada capacidade, o default aplicado, como o
usuário concede, onde revoga, o efeito de revogar no meio de uma ação e o que
fica registrado. A regra de interface é: toda revogação fica a no máximo dois
cliques a partir da aba correspondente em Configurações.

Legenda de cliques: "1 clique" é um único controle (checkbox, seletor ou botão)
na própria aba. "2 cliques" inclui uma confirmação obrigatória.

## 1. Resumo

A instalação começa liberada para ações e visão de tela. Cada categoria pode ser
revogada na aba Permissões; a pausa global bloqueia tudo imediatamente.

| Capacidade          | Default                                           | Concede em                                       | Revoga em                                           | Cliques para revogar |
| ------------------- | ------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | -------------------- |
| Microfone           | Ligado (`permissions.microphone=true`)            | Aba Voz ou primeira ativação da voz              | Aba Voz, botão "Revogar consentimento de microfone" | 1                    |
| Tela                | Sob demanda (`privacy.screen.mode='on'`)          | Aba Permissões, seletor "Visão de tela"          | Mesmo seletor em "Desligada"                        | 1                    |
| Leitura de arquivos | Liberada (`files.read='allow'`)                   | Aba Permissões, seletor da categoria             | Seletor em "Negar" ou "Perguntar"                   | 1                    |
| Escrita de arquivos | Liberada (`files.write='allow'`)                  | Aba Permissões, seletor da categoria             | Seletor em "Negar" ou "Perguntar"                   | 1                    |
| Abrir programas     | Liberada (`apps.launch='allow'`)                  | Aba Permissões, seletor da categoria             | Seletor em "Negar" ou "Perguntar"                   | 1                    |
| Fechar programas    | Liberada (`apps.close='allow'`)                   | Aba Permissões, seletor da categoria             | Seletor em "Negar" ou "Perguntar"                   | 1                    |
| Energia             | Liberada (`system.power='allow'`)                 | Aba Permissões, seletor da categoria             | Seletor em "Negar"                                  | 1                    |
| UIA                 | Liberada (`uia.control='allow'`)                  | Aba Permissões, seletor da categoria             | Seletor em "Negar"                                  | 1                    |
| Pesquisa web        | Ligada (`web.enabled=true`, `web.search='allow'`) | Aba Permissões, checkbox "Permitir pesquisa..."  | Desmarcar o checkbox ou negar a categoria           | 1                    |
| Memória             | Ligada (`memory.enabled=true`)                    | Aba Memória, checkbox "Memória ligada"           | Desmarcar "Memória ligada"                          | 1                    |
| Chave Gemini        | Ausente                                           | Aba Chave e custo, salvar chave                  | Aba Chave e custo, "Remover chave" + confirmar      | 2                    |
| Teto mensal interno | Ativo (`gemini.unlimitedUsage=false`)             | Aba Chave e custo, "Ativar uso ilimitado"        | Mesmo botão, "Desativar uso ilimitado"              | 1                    |
| Pausa global        | Desligada (`permissions.paused=false`)            | Aba Permissões, checkbox "Pausar todas as ações" | Desmarcar o checkbox                                | 1                    |

## 2. Detalhe por capacidade

### 2.1 Microfone

- **Default:** `permissions.microphone=true`. A sessão ainda só abre por ação explícita
  do usuário e o gate nativo de mídia permanece ativo.
- **Concessão:** o primeiro clique no avatar com a voz desligada abre um diálogo
  nativo com o padrão "Agora não". A aba Voz também tem o botão "Permitir
  microfone", que grava o consentimento sem abrir áudio.
- **Revogação:** aba Voz, botão "Revogar consentimento de microfone". O
  controlador encerra a sessão com o motivo `consentDenied` e coloca a voz em
  `error` com a mensagem de microfone não autorizado.
- **No meio da ação:** a revogação fecha a sessão Live imediatamente, descarta o
  buffer de transcrição em memória e não grava áudio. A conversa por texto
  segue funcionando.
- **Registro:** `permissions.microphone` no `config.json`; a sessão de voz
  registra o motivo no log de ciclo de vida, sem áudio nem transcrição.
- **Teste:** `src/main/voice-toggle.test.ts` (revogação encerra a sessão) e
  `src/renderer/src/settings/consent-revocation.test.tsx` (botão muda o estado).

### 2.2 Tela

- **Default:** `privacy.screen.mode='on'` sob demanda; `proactive=false`. Blocklist,
  limites e indicador continuam valendo para toda captura.
- **Concessão:** aba Permissões, seção "Visão de tela", seletor com "Perguntar a
  cada captura" ou "Ligada para o modo sob demanda". "Perguntar" ainda exige
  confirmação nativa por captura.
- **Revogação:** o mesmo seletor em "Desligada". Um clique.
- **No meio da ação:** o controlador lê `privacy.screen` no início de cada
  captura. Uma captura já em andamento termina e é descartada da memória ao
  final; nenhuma nova captura começa. O indicador visível continua até o fim
  daquela captura.
- **Registro:** `privacy.screen` no `config.json`; a auditoria de captura grava
  metadados (tipo, alvo, motivo), nunca a imagem.
- **Teste:** `src/main/capture/controller.test.ts` (modo `off` recusa),
  `src/main/capture/privacy.test.ts` (blocklist) e
  `src/renderer/src/settings/consent-revocation.test.tsx` (seletor).

### 2.3 Leitura e escrita de arquivos

- **Default:** `files.read='allow'` e `files.write='allow'`. Salvaguardas próprias
  de planos destrutivos e auditoria continuam valendo.
- **Concessão:** já vem liberada; a aba Permissões permite revogar ou voltar para
  confirmação. Limites, journal/undo e auditoria continuam ativos.
- **Revogação:** seletor em "Negar" (nunca executa) ou "Perguntar" (volta a
  confirmar). Um clique.
- **No meio da ação:** uma operação já confirmada termina; o plano de arquivos
  tem journal para desfazer. A próxima chamada consulta a nova decisão.
- **Registro:** `permissions.categories` no `config.json`; cada ação vai para
  `audit/actions.jsonl` com `tool`, `category`, `argsHash`, `safeArgs`,
  `decision`, `ok` e `durationMs`. Conteúdo de arquivo não é registrado.
- **Teste:** `src/main/actions/fileOps.test.ts`, `src/main/actions/readFile.test.ts`,
  `src/main/gemini/tools/router.test.ts` e o teste de consentimentos.

### 2.4 Abrir e fechar programas

- **Default:** `apps.launch='allow'` e `apps.close='allow'`.
- **Concessão:** aba Permissões, seletor da categoria em "Permitir".
- **Revogação:** seletor em "Negar" ou "Perguntar". Um clique.
- **No meio da ação:** abrir ou fechar um app não é interrompido; a próxima
  chamada usa a nova decisão. Limites e catálogo continuam ativos.
- **Registro:** `audit/actions.jsonl` com pid ou nome do app em `safeArgs`,
  nunca a linha de comando completa.
- **Teste:** `src/main/actions/appCatalog.test.ts`,
  `src/main/actions/processes.test.ts`, `src/main/actions/tools.test.ts` e o
  teste de consentimentos.

### 2.5 Energia

- **Default:** `system.power='allow'`. Desligar, reiniciar, bloquear ou suspender
  pode executar; revogue a categoria ou pause globalmente quando necessário.
- **Concessão:** aba Permissões, seletor em "Permitir" e confirmação explícita
  no próprio painel (2 cliques no total).
- **Revogação:** seletor em "Negar". Um clique.
- **No meio da ação:** comandos de energia são atômicos e não têm cancelamento
  depois de disparados; a confirmação acontece antes. A próxima chamada é
  bloqueada.
- **Registro:** `audit/actions.jsonl` com categoria, decisão e resultado; a
  notificação da bandeja informa o efeito.
- **Teste:** `src/main/actions/system.test.ts`,
  `src/main/actions/tools.test.ts` e o teste de consentimentos.

### 2.6 UIA (controle de janelas e interface)

- **Default:** `uia.control='allow'`. Clique, digitação e leitura de árvore de
  acessibilidade podem acontecer; revise a permissão antes de usar.
- **Concessão:** aba Permissões, seletor em "Permitir" e confirmação explícita
  no painel (2 cliques no total).
- **Revogação:** seletor em "Negar". Um clique.
- **No meio da ação:** uma ação UIA já iniciada termina; o limite de 1 ação a
  cada 2 s reduz o impacto. A próxima chamada é bloqueada.
- **Registro:** `audit/actions.jsonl` com `safeArgs` (título de janela, papel,
  nome do controle) e sem texto digitado.
- **Teste:** `src/main/actions/uia.test.ts`, `src/main/gemini/tools/router.test.ts`
  e o teste de consentimentos.

### 2.7 Pesquisa web

- **Default:** `web.enabled=true` e `web.search='allow'`. A pesquisa é ligada
  por padrão, mas as páginas são dados não confiáveis e não executam nada.
- **Concessão:** aba Permissões, checkbox "Permitir pesquisa e abertura de
  páginas" ou seletor da categoria em "Permitir".
- **Revogação:** desmarcar o checkbox (remove as ferramentas do registro) ou
  negar a categoria. Um clique.
- **No meio da ação:** uma busca já iniciada termina; o cache em memória pode
  ser limpo por `search:clear-cache`. Nenhuma nova busca ou abertura começa.
- **Registro:** `web.enabled` e `web.search` no `config.json`; a auditoria de
  ações grava a consulta em `safeArgs` e a decisão, sem conteúdo de página.
- **Teste:** `src/main/search/limits.test.ts`, `src/main/search/injection.test.ts`,
  `src/main/gemini/tools/web-tools.test.ts` e o teste de consentimentos.

### 2.8 Memória

- **Default:** `memory.enabled=true` e `memory.autoExtract=true`. A memória é
  local; a extração automática usa o Gemini e entra no teto de tokens.
- **Concessão:** aba Memória, checkbox "Memória ligada" e "Extração automática".
- **Revogação:** desmarcar "Memória ligada" pausa extração, recuperação e
  gravação de novos turnos sem apagar nada. Um clique. A extração automática
  pode ser desligada separadamente.
- **No meio da ação:** uma extração já em andamento pode concluir e gravar; a
  pausa vale a partir da próxima leitura de `memory.enabled`. O relatório de
  manutenção e a auditoria registram `pause`/`resume`.
- **Registro:** `memory.enabled` no `config.json`; `audit/memory.jsonl` com
  `{at, op, id, kind}` e nunca o conteúdo.
- **Teste:** `src/main/memory/privacy.test.ts`,
  `src/main/memory/consolidate.test.ts`,
  `src/renderer/src/settings/memory/MemoryPanel.test.tsx` e o teste de
  consentimentos.

### 2.9 Chave Gemini

- **Default:** ausente. Sem chave, a conversa fica indisponível e o app explica
  o caminho de recuperação.
- **Concessão:** aba Chave e custo, campo write-only e "Salvar chave".
- **Revogação:** "Remover chave" e "Confirmar remoção" (2 cliques). A chave
  cifrada é apagada; o restante dos dados permanece.
- **No meio da ação:** a próxima chamada falha com `auth` antes de qualquer
  rede. Uma chamada já em andamento pode concluir.
- **Registro:** nenhum valor de chave; o status só informa `configured`.
- **Teste:** `src/main/secrets.test.ts`, `src/renderer/src/settings/KeyTab.test.tsx`
  e o teste de consentimentos.

### 2.10 Teto mensal interno

- **Default:** ativo (`gemini.unlimitedUsage=false`), com teto configurável em
  `gemini.monthlyTokenCap`.
- **Concessão/revogação:** na aba Chave e custo, o botão alterna entre
  "Ativar uso ilimitado" e "Desativar uso ilimitado". A preferência é persistida
  sem gravar `Infinity`.
- **Efeito:** quando ativo, remove somente o bloqueio mensal interno de tokens
  para chat, voz, pesquisa e visão. O uso continua registrado.
- **Limites preservados:** chamadas por turno, capturas por hora, intervalo
  proativo, duração da sessão, tamanho de imagem/página e demais limites
  operacionais continuam valendo.
- **Limites do provedor:** quotas diárias/RPM/RPD, rate limits e indisponibilidade
  do Google continuam valendo, inclusive com API key gratuita.
- **Registro:** `gemini.unlimitedUsage` no `config.json`; nenhum segredo é
  envolvido.
- **Teste:** `src/main/gemini/usage.test.ts` e
  `src/renderer/src/settings/KeyTab.test.tsx`.

### 2.11 Pausa global

- **Default:** desligada.
- **Concessão/revogação:** checkbox "Pausar todas as ações" na aba Permissões,
  ou o atalho `Control+Alt+P`. A pausa vence qualquer categoria.
- **No meio da ação:** uma ação já confirmada termina; a próxima é recusada
  antes da confirmação.
- **Registro:** `permissions.paused` no `config.json`; a UI mostra o estado e o
  atalho.
- **Teste:** `src/main/actions/tools.test.ts`,
  `src/renderer/src/settings/PermissionsTab.test.tsx` e o teste de
  consentimentos.

## 3. Como a interface garante os dois cliques

- Aba Permissões: cada categoria tem um seletor único (`permission-<categoria>`)
  com "Permitir", "Perguntar" e "Negar"; a visão de tela tem o seletor
  `permissions-screen-mode`; a pesquisa web tem o checkbox `permissions-web`.
- Aba Voz: o botão de consentimento alterna entre "Permitir microfone" e
  "Revogar consentimento de microfone".
- Aba Memória: o checkbox `memory-enabled` pausa sem apagar.
- Aba Chave e custo: remover a chave exige a confirmação inline, total de dois
  cliques.
- Nenhuma revogação depende de editar `config.json` ou reiniciar o app.

## 4. Evidência automatizada

O teste `src/renderer/src/settings/consent-revocation.test.tsx` percorre as
capacidades acima com APIs falsas e confirma, para cada uma:

1. o estado exibido muda depois da revogação;
2. a decisão persistida/fake corresponde ao bloqueio esperado;
3. o caminho usado tem no máximo dois cliques.

A parte manual (app real, com microfone, tela e memória em uso) fica registrada
como pendência no `docs/test-matrix.md` quando não houver ambiente humano
para executá-la.
