# Segurança, degradação e robustez (task 08)

Documento de apoio da task 08 do plano Absolem Otimização. Registra a matriz de
falhas, os achados da varredura com payloads sintéticos e o estado depois das
correções. Não substitui o modelo de ameaças (`docs/threat-model.md`); apenas
comprova que as barreiras existentes continuam válidas sob falha.

## 1. Matriz de falhas

| Domínio   | Falha simulada                                       | Barreira existente                                                        | Cobertura                                                            | Situação |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| SDK       | exceção crua, status 5xx, rede, timeout, abort       | `GeminiError` com `kind`/`retryable`; retry total 2; abort nunca repete   | `gemini/client.test.ts`, `gemini/errors.test.ts`                     | OK       |
| Live      | queda de socket, reconnect, erro em sessão aberta    | `LIVE_MAX_ATTEMPTS=2`; backoff; close idempotente; buffer limitado        | `gemini/live.test.ts`, `voice/concurrency.test.ts`                   | OK       |
| Áudio     | chunk gigante, dispositivo removido, silêncio        | permissão `media` só no overlay/consentimento; sessão curta; sem gravação | `permissions.test.ts`, `voice-timeouts.test.ts`                      | OK       |
| Captura   | frame acima do limite, região inválida, cancelamento | guarda de 8 MB; validação de região; cancelamento em 4 pontos             | `security/ipc.test.ts`, `capture/controller.test.ts`, `fuzz.test.ts` | OK       |
| SQLite    | banco corrompido, import inválido, disco cheio       | abertura com erro tipado; import atômico; validação de schema/16 MB       | `memory/persistence.test.ts`, `memory/exportImport.test.ts`          | OK       |
| Disco     | log/auditoria sem permissão de escrita               | escrita best-effort, nunca lança; rotação por tamanho                     | `logger.test.ts`, `audit/actions.test.ts`, `data-lifecycle.test.ts`  | OK       |
| Janela    | navegação/webview/popup                              | `will-navigate`/`setWindowOpenHandler`/`will-attach-webview` bloqueados   | `security/hardening.test.ts`, `navigation.test.ts`                   | OK       |
| Permissão | categoria inválida, pausa global, revogação          | validação fechada; pausa vira `deny`; microfone relido a cada pedido      | `permissions.test.ts`, `ipc/actions.test.ts`, `shared/permissions`   | OK       |
| IPC       | payload malformado, circular, acima do limite        | allowlist, limite de texto/binário, validação `unknown`, erro sanitizado  | `security/ipc.test.ts`, `security/fuzz.test.ts`                      | OK       |
| Processo  | segunda instância, shutdown, exceção não tratada     | instância única, hooks idempotentes, crash log local sem upload           | `singleInstance.test.ts`, `shutdown.test.ts`                         | OK       |
| Auditoria | argumentos circulares/profundos, retenção            | `safeArgs` restrito por chave; rotação 5 MB; retenção 90 dias             | `audit/actions.test.ts`, `fuzz.test.ts`                              | OK       |
| Logs      | segredo, token, transcrição, prompt, URL privada     | redação em todos os níveis; caminho de usuário mascarado                  | `logger.test.ts`, `security/redaction.test.ts`, `fuzz.test.ts`       | OK       |

## 2. Achados da varredura (antes das correções)

Varredura executada em 27/11/2026 com `npx vitest run
src/main/security/fuzz.test.ts`. Entradas sintéticas: `undefined`, `null`,
números não finitos, `BigInt`, `Symbol`, funções, objetos nulos, `Map`, `Set`,
`Date`, buffers, objeto circular, aninhamento de 40 níveis, texto de 70 KB,
JSON truncado/versão futura/nulo, 20 mil colchetes e argumentos circulares.

| #   | Achado                                                  | Evidência                                          | Risco                                      | Correção                                          |
| --- | ------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| 1   | `sanitizeIpcError` lança se `message` for getter hostil | `Error: getter hostil`                             | exceção crua escaparia do guarda de IPC    | leitura defensiva de `message`                    |
| 2   | Redação não cobre `file:///...` nem conteúdo sem aspas  | URL com `joao.silva` e transcrição/prompt visíveis | caminho pessoal e conteúdo no log          | redigir URL `file:` e conteúdo até o fim da linha |
| 3   | `sanitizeSafeArgs` estoura a pilha em array circular    | `RangeError: Maximum call stack size exceeded`     | auditoria perdida/erro em argumento hostil | limite de profundidade + `WeakSet`                |

Nenhum crash foi observado no roteador de ferramentas (o erro fica contido na
auditoria best-effort), no importador de memória nem no guarda de payload. Os
retries do SDK (2) e do Live (2) já são limitados; não houve alteração.

## 3. Estado depois das correções

- `sanitizeIpcError` sempre devolve string curta, sem stack, segredo ou caminho,
  inclusive para objetos hostis.
- Redação cobre `api_key`, `authorization`, `token`, `senha`, `chave`,
  `transcript`/`transcricao`, `prompt`, `resposta`/`response`, URLs `http(s)` e
  `file:///`, além de `C:\Users\<nome>`.
- `sanitizeSafeArgs` limita profundidade e ignora ciclos; a auditoria nunca
  perde o evento por causa de um argumento malformado.
- Testes negativos em `src/main/security/fuzz.test.ts`, `redaction.test.ts`,
  `ipc.test.ts`, `audit/actions.test.ts` e `actions/tools.test.ts`.

## 4. Validação manual pendente

Ambiente Windows real, fora do alcance dos testes em Node:

- UAC do instalador do Hub e elevação do Kloud Games.
- `safeStorage`/DPAPI: gravar, reiniciar, ler e revogar a chave na conta real.
- Revogação de categoria, pausa global (`Control+Alt+P`) e retomada.
- Disco cheio/removido, rede indisponível e dispositivo de áudio removido no app
  empacotado.
