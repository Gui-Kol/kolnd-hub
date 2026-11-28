# Modelo de ameaças do Absolem

Documento da task 13 (T1). Descreve ativos, adversários, superfícies de ataque,
mitigações implementadas e risco residual aceito. Cada mitigação aponta para a
task que a criou e para o teste ou checklist que a verifica. Não há item
genérico: quando não existe mitigação, a linha diz o que foi aceito e por quê.

Escopo: app Windows x64 empacotado, uso single-user, sem telemetria, sem
auto-update silencioso e sem cifragem do banco na v1. Pentest externo,
certificação formal e compatibilidade com macOS/Linux estão fora do escopo da
task 13.

## 1. Ativos

| Ativo                    | Onde vive                                                         | Impacto se vazar ou for alterado                         |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Chave Gemini             | `%APPDATA%\absolem\secrets.bin` cifrado por `safeStorage` (DPAPI) | Uso da conta Google do usuário, custo e acesso ao modelo |
| Memória de longo prazo   | `%APPDATA%\absolem\memory.sqlite` (WAL e SHM ao lado)             | Fatos, preferências e perfil pessoal                     |
| Áudio do microfone       | Memória do processo e stream TLS do Gemini Live                   | Conteúdo de fala em tempo real; não é gravado em disco   |
| Capturas de tela         | Memória do processo; nunca em disco                               | Conteúdo visível na tela, inclusive dados sensíveis      |
| Arquivos do usuário      | Caminhos escolhidos pelo usuário                                  | Leitura, escrita ou exclusão indevida                    |
| Controle do PC           | Processos, janelas e ações de energia                             | Abertura/fechamento de apps, cliques e desligamento      |
| Histórico e transcrições | `chat.turns` no `config.json` e `turns` no SQLite                 | Conteúdo das conversas                                   |
| Configuração             | `%APPDATA%\absolem\config.json`                                   | Tema, permissões, limites e preferências                 |
| Logs e auditoria         | `%APPDATA%\absolem\logs` e `audit`                                | Metadados de uso; nunca conteúdo                         |
| Artefato de instalação   | Instalador do Kolnd Hub (o Absolem vai embarcado)                 | Execução de binário adulterado                           |

## 2. Adversários

| Adversário               | Capacidade presumida                                             | Objetivo típico                                                          |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Conteúdo web hostil      | Página indexada ou aberta por `fetch_url` com texto de instrução | Prompt injection para fazer o agente agir, vazar contexto ou abrir links |
| Tela hostil              | Janela ou documento com texto que parece instrução               | Prompt injection por captura de tela; enganar o modelo                   |
| Renderer comprometido    | XSS ou dependência de UI maliciosa executando no renderer        | Chamar IPC privilegiado, ler chave, executar ferramentas, abrir janelas  |
| Outro usuário local      | Acesso ao mesmo perfil do Windows ou a uma cópia de `%APPDATA%`  | Ler banco, logs, configuração ou o blob da chave                         |
| Rede hostil              | DNS/proxy/TLS interceptado ou serviço Gemini indisponível        | Ler tráfego, forçar queda ou resposta forjada                            |
| Processo local malicioso | Outro programa na sessão do usuário                              | Ler arquivos do app, injetar teclas/cliques ou adulterar o instalador    |

Fora do modelo: administrador local/root comprometido, malware com o mesmo
token de integridade do usuário, ataque físico com desbloqueio do Windows e
engenharia social fora do app. Contra esses adversários não há garantia na v1.

## 3. Superfícies de ataque

| Superfície        | Entrada                                             | Regra de projeto                                                                                               |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| IPC               | `ipcRenderer.invoke`/`send` do renderer             | Allowlist fechada em `src/shared/ipc.ts`, handler único por canal, payload `unknown` validado, erro sanitizado |
| Navegação         | `window.open`, `location.href`, `webview`           | `setWindowOpenHandler` deny, `will-navigate` bloqueado, `will-attach-webview` negado, `webviewTag:false`       |
| Protocolos        | `file://` do app e `https://` do Gemini             | CSP restritiva, sem `unsafe-eval`, sem script inline, `connect-src 'self'`                                     |
| `spawn`/processos | Abertura e fechamento de apps                       | Catálogo/allowlist, confirmação para destrutivo, limite de 5 apps/min                                          |
| PowerShell        | Ações de energia e sistema                          | Comando fixo, sem interpolação de texto do modelo, confirmação                                                 |
| Banco SQLite      | Consultas da memória e importação JSON              | SQL parametrizado, validação de schema, limite de 16 MB no import                                              |
| Logs e auditoria  | Logger, `audit/actions.jsonl`, `audit/memory.jsonl` | Redação em `info+`, auditoria sem conteúdo, rotação e retenção                                                 |
| Rede              | Gemini Live Search e `fetch_url`                    | HTTPS, allowlist http/https, sem chave em URL/log, bloqueio sem teto                                           |
| Instalador        | Instalador do Kolnd Hub (Absolem embarcado)         | Assinatura/verificação do release da Hub                                                                       |

## 4. Mitigações por ativo

### 4.1 Chave Gemini

| Ameaça                        | Mitigação                                                                                   | Cobertura                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Chave em texto plano no disco | `safeStorage` (DPAPI) em `secrets.bin`; gravação recusada sem criptografia disponível       | task 05; `src/main/secrets.test.ts`                                                         |
| Chave exposta ao renderer     | `gemini:set-key` é write-only; nenhum canal devolve a chave; status só informa `configured` | task 05/11; `src/main/ipc/chat.test.ts`, `src/main/gemini/guard.test.ts`                    |
| Chave em log ou diagnóstico   | Redação de `api[-_]?key`, `authorization`, `token`; diagnóstico monta apenas metadados      | task 13/T4; `src/main/security/redaction.test.ts`, `src/main/ipc/diagnostics.test.ts`       |
| Chave em URL ou endpoint      | SDK encapsulado em `gemini/sdk.ts`; nenhum endpoint ou import de rede fora dele             | task 05; `src/main/gemini/guard.test.ts`                                                    |
| Chave em captura de tela      | Campo de chave é `type=password`; captura é opt-in e respeita blocklist                     | task 07/11; `src/main/capture/privacy.test.ts`, `src/renderer/src/settings/KeyTab.test.tsx` |

Risco residual aceito: outro usuário com acesso ao perfil Windows pode decifrar o
blob via DPAPI do próprio usuário. A proteção é a ACL da conta, não segredo
extra. Registrado em `docs/memory.md` e no gate de privacidade da task 09.

### 4.2 Memória e transcrições

| Ameaça                                    | Mitigação                                                                            | Cobertura                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Conteúdo sensível extraído para a memória | Filtro descarta candidato com aparência de chave, token, senha ou cartão             | task 09; `src/main/memory/extract.test.ts`                                                |
| Transcrição gravada sem consentimento     | `memory.enabled=false` interrompe gravação, recuperação e extração; pausar não apaga | task 09; `src/main/memory/privacy.test.ts`, `src/main/ipc/memory.test.ts`                 |
| Exclusão incompleta                       | `removeAll` reconstrói FTS, roda `VACUUM` e pode apagar turnos/sessões               | task 09/13; `src/main/memory/privacy.test.ts`, `src/main/security/data-lifecycle.test.ts` |
| Importação maliciosa                      | Valida `app`, `kind`, versão, cada linha e limite de 16 MB; não sobrescreve por `id` | task 09; `src/main/memory/exportImport.test.ts`                                           |
| SQL injection                             | Consultas parametrizadas no repositório; nenhum SQL montado com conteúdo             | task 09; `src/main/memory/repository.test.ts`                                             |
| Leitura por outro usuário                 | ACL do perfil Windows; banco não cifrado na v1                                       | task 09; risco aceito documentado em `docs/memory.md`                                     |

Risco residual aceito: o banco não usa SQLCipher. Quem copiar
`memory.sqlite`, `-wal` e `-shm` com o usuário desbloqueado lê o conteúdo.
Cifragem fica para decisão futura; não é promessa da v1.

### 4.3 Áudio e microfone

| Ameaça                              | Mitigação                                                                                     | Cobertura                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Microfone aberto sem consentimento  | Permissão `media` só no overlay e só com `permissions.microphone=true`; checada a cada pedido | task 06; `src/main/permissions.test.ts`                                       |
| Áudio enviado sem intenção          | Sessão só inicia por clique/atalho; ocultar o overlay encerra a captura                       | task 06; `src/main/voice-toggle.test.ts`, `src/main/voice-timeouts.test.ts`   |
| Áudio gravado em disco              | Nenhum caminho grava PCM; teste garante que o chunk não é persistido                          | task 06; `src/main/voice/controller.ts`, `src/renderer/src/audio/pcm.test.ts` |
| Sessão aberta indefinidamente       | Limite de 15 min e silêncio de 20 s encerram a sessão                                         | task 06; `src/main/voice-timeouts.test.ts`                                    |
| Dispositivo trocado no meio da fala | Troca de dispositivo encerra a sessão antes de aplicar                                        | task 06; `src/main/voice-toggle.test.ts`                                      |

Risco residual aceito: o áudio trafega para o Gemini por TLS. O provedor vê o
conteúdo durante a sessão. Não há processamento local de STT/TTS na v1.

### 4.4 Capturas de tela

| Ameaça                    | Mitigação                                                                                                             | Cobertura                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Captura contínua          | Default `privacy.screen.mode='on'` é sob demanda; `proactive=false`, blocklist, limites e indicador permanecem ativos | task 07; `src/main/capture/controller.test.ts`, `docs/screen-capture-checklist.md` |
| Captura de app sensível   | Blocklist por substring em título e processo, antes de capturar                                                       | task 07; `src/main/capture/privacy.test.ts`                                        |
| Imagem em disco           | Buffer só em memória; nunca é escrito                                                                                 | task 07; `src/main/capture/controller.test.ts`, `docs/screen-capture-checklist.md` |
| Captura em excesso        | 20/h, proativa 1/60 s e somente com voz ouvindo; teto mensal antes dos pixels                                         | task 07; `src/main/capture/limits.test.ts`                                         |
| Prompt injection por tela | Envelope marca o conteúdo como não confiável e o sistema proíbe seguir instruções da tela                             | task 07; `src/main/capture/injection.test.ts`                                      |
| Frame gigante             | Limite de 8 MB e dimensões válidas no `capture:result`                                                                | task 07/13; `src/main/capture/controller.test.ts`, `src/main/security/ipc.test.ts` |

Risco residual aceito: uma tela hostil pode induzir o modelo a propor uma ação.
A execução continua sujeita a permissão, confirmação e limites da task 08.

### 4.5 Arquivos e controle do computador

| Ameaça                          | Mitigação                                                                                           | Cobertura                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ação destrutiva sem confirmação | Roteador exige decisão `allow` ou diálogo para `ask`; `deny` nunca executa                          | task 05/08; `src/main/gemini/tools/router.test.ts`                                             |
| Exclusão em massa               | Limite de 10 operações por pedido e confirmação explícita                                           | task 08; `src/main/actions/tools.test.ts`, `src/main/audit/actions.test.ts`                    |
| Path traversal                  | Caminhos normalizados e limitados às raízes permitidas; sem caminho livre vindo do renderer         | task 08; `src/main/actions/fileOps.test.ts`, `src/main/actions/readFile.test.ts`               |
| Abrir app arbitrário            | Catálogo e allowlist; 5 aberturas/min                                                               | task 08; `src/main/actions/appCatalog.test.ts`, `src/main/actions/processes.test.ts`           |
| Execução sem usuário presente   | Pausa global (`Control+Alt+P`) bloqueia todas as ferramentas antes da confirmação                   | task 08; `src/main/actions/tools.test.ts`, `src/renderer/src/settings/PermissionsTab.test.tsx` |
| UIA controlando outra janela    | Default `deny`; exige `allow` confirmado; 1 ação/2 s                                                | task 08; `src/main/actions/uia.test.ts`, `src/renderer/src/settings/PermissionsTab.test.tsx`   |
| Ação sem rastro                 | Auditoria JSONL com ferramenta, categoria, hash dos argumentos, decisão, ok e duração; sem conteúdo | task 08; `src/main/audit/actions.test.ts`                                                      |
| Falha no meio do plano          | Operações já feitas entram no journal; undo reverte o parcial; nada é sobrescrito                   | task 08; `src/main/actions/fileOps.test.ts`                                                    |

Risco residual aceito: o modelo pode propor uma ação permitida e o usuário
confirmar por engano. A confirmação mostra alvo, processo e motivo; não há
desfazer universal para exclusão de arquivo.

### 4.6 Pesquisa web e conteúdo hostil

| Ameaça                     | Mitigação                                                                                                | Cobertura                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Prompt injection em página | Regras de sistema tratam conteúdo web como dado; resposta cita fontes e não obedece instruções da página | task 10; `src/main/search/injection.test.ts`, `src/main/gemini/engine-web.test.ts` |
| SSRF                       | `fetch_url` só http/https, sem IP privado, localhost, link local ou esquema alternativo                  | task 10; `src/shared/search.test.ts`, `src/main/search/fetchPage.test.ts`          |
| Exfiltração por link       | `search:open-url` usa allowlist http/https e `shell.openExternal`                                        | task 10; `src/shared/search.test.ts`, `src/main/search/fetchTool.test.ts`          |
| Consumo sem limite         | 3 buscas, 5 aberturas e 30 s por turno; teto mensal em cada operação                                     | task 10; `src/main/search/limits.test.ts`                                          |
| Conteúdo remoto executando | Extração com `linkedom`, sem executar script; CSP e navegação bloqueadas                                 | task 10/13; `src/main/search/extract.test.ts`, `src/main/navigation.test.ts`       |

Risco residual aceito: mesmo com o envelope, o modelo pode resumir uma instrução
hostil como se fosse resposta. O usuário vê as fontes e nenhuma ação é executada
sem a camada de permissão da task 08.

### 4.7 IPC e renderer comprometido

| Ameaça                   | Mitigação                                                                                                 | Cobertura                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Canal não declarado      | Allowlist derivada de `IPC`; sem canal dinâmico                                                           | task 13/T6; `src/main/security/ipc.test.ts`                                          |
| Handler duplicado        | Um `ipcMain.handle` por canal nos módulos de `src/main/ipc`                                               | task 13/T6; `src/main/security/ipc.test.ts`                                          |
| Payload gigante          | Limite de 8 MB para imagem e 64 KB para texto no guarda central                                           | task 13/T6; `src/main/security/ipc.test.ts`                                          |
| Remetente estranho       | URL do `senderFrame` comparada com a origem do app (dev ou `renderer/index.html`)                         | task 13/T6; `src/main/security/ipc.test.ts`                                          |
| Stack do SDK no renderer | Erros classificados em `GeminiError`; guarda remove stack e caminhos                                      | task 05/13; `src/main/gemini/engine.test.ts`, `src/main/security/ipc.test.ts`        |
| Objeto de erro hostil    | `sanitizeIpcError` lê `message` sob `try/catch`; getter/`toString` hostil vira fallback pt-BR             | task 08; `src/main/security/fuzz.test.ts`                                            |
| XSS no renderer          | CSP sem `unsafe-eval` e sem script inline; `contextIsolation` e `sandbox` ligados                         | task 13/T5; `src/main/security/hardening.test.ts`, `Absolem/src/renderer/index.html` |
| Nova janela ou navegação | `setWindowOpenHandler` deny, `will-navigate` bloqueado, `webviewTag:false` e `will-attach-webview` negado | task 13/T5; `src/main/security/hardening.test.ts`, `src/main/navigation.test.ts`     |

Risco residual aceito: se o processo main for comprometido, o atacante tem os
mesmos privilégios do app. Não há sandbox de processo main no Electron.

### 4.8 Logs e auditoria

| Ameaça                 | Mitigação                                                                                   | Cobertura                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Chave ou token no log  | Redação em `info+` de `authorization`, `api_key`, `token`, `senha` e `chave`                | task 13/T4; `src/main/security/redaction.test.ts`, `src/main/security/fuzz.test.ts`      |
| Caminho pessoal no log | Máscara de `C:\Users\<nome>` (barra invertida ou normal) em `info+`                         | task 13/T4; `src/main/security/redaction.test.ts`, `src/main/security/fuzz.test.ts`      |
| Transcrição no log     | Redação de `transcript`/`transcricao` e proibição de `console.*` no main                    | task 13/T4; `src/main/security/redaction.test.ts`, regra ESLint `no-console`             |
| Conteúdo sem aspas     | `prompt`/`resposta`/`response`/`transcrição` redigidos até o fim da linha                   | task 08; `src/main/security/redaction.test.ts`, `src/main/security/fuzz.test.ts`         |
| URL privada no log     | `http(s)` e `file://` redigidos por inteiro; caminho de usuário mascarado                   | task 08; `src/main/security/redaction.test.ts`, `src/main/security/fuzz.test.ts`         |
| Argumento circular     | `sanitizeSafeArgs` limita profundidade e ignora ciclos; auditoria nunca perde o evento      | task 08; `src/main/security/fuzz.test.ts`, `src/main/audit/actions.test.ts`              |
| Auditoria com conteúdo | `actions.jsonl` guarda hash e `safeArgs`; `memory.jsonl` guarda apenas `{at, op, id, kind}` | task 08/09; `src/main/audit/actions.test.ts`, `src/main/memory/privacy.test.ts`          |
| Crescimento infinito   | Logs 5 MB x 2, auditoria 5 MB x 2 e retenção de 90 dias                                     | task 08/13; `src/main/audit/actions.test.ts`, `src/main/security/data-lifecycle.test.ts` |

Risco residual aceito: logs `warn`/`error` podem conter mensagem de exceção de
biblioteca. O logger mascara segredos e caminhos, mas não inspeciona o conteúdo
semântico de toda mensagem de erro de terceiro.

### 4.9 Custo e disponibilidade

| Ameaça             | Mitigação                                                                 | Cobertura                                                                         |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Consumo sem teto   | Teto mensal em tokens, bloqueio antes do transporte, aviso em 80%         | task 05; `src/main/gemini/usage.test.ts`, `src/main/security/cost-limits.test.ts` |
| Dupla contagem     | Deduplicação opcional por `requestId` no medidor                          | task 13/T3; `src/main/security/cost-limits.test.ts`                               |
| Loop de retry caro | Erros classificados com `retryable` explícito; `quota`/`auth` não repetem | task 05; `src/main/gemini/engine.test.ts`                                         |
| Serviço fora do ar | Estado degradado com mensagem curta e recuperação; sem tela branca        | task 13/T12; `src/main/security/degraded.test.ts`                                 |

Risco residual aceito: o teto é local e em tokens. O provedor pode cobrar por
itens que não são tokens (por exemplo, imagem), e a estimativa por
caracteres/4 é aproximada; o valor cobrado é o da conta Google.

### 4.10 Distribuição

| Ameaça                          | Mitigação                                                                               | Cobertura                                            |
| ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Instalador adulterado           | Integridade do instalador do Kolnd Hub (Absolem embarcado nos resources)                | task 32; release da Hub                              |
| SmartScreen enganoso            | Distribuição via Hub; aviso de SmartScreen declarado no release da Hub                  | task 32; release da Hub                              |
| Dependência maliciosa           | Lockfile fixo, `npm ci`, `npm audit`, licenças inventariadas e revisão de `postinstall` | task 13/T7; `Absolem/docs/licenses.md`, checklist T7 |
| Dados apagados na desinstalação | Dados só saem por ação explícita do usuário (`%APPDATA%\absolem` preservado)            | task 32; `docs/data-lifecycle.md`                    |

Risco residual aceito: a v1 não é assinada. A integridade depende do SHA-256
publicado por um canal confiável e da conferência manual do usuário.

## 5. Riscos residuais aceitos (resumo)

| Risco                                    | Decisão                                                             | Onde está registrado                          |
| ---------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| Banco sem cifragem                       | Aceito na v1; ACL do Windows; SQLCipher é decisão futura            | `docs/memory.md`, task 09                     |
| Áudio e texto vão ao Gemini              | Necessário para o produto; TLS; sem STT/TTS local                   | `README.md`, task 06                          |
| Modelo pode sugerir ação errada          | Permissão + confirmação + pausa + auditoria; sem desfazer universal | task 08, `docs/computer-control-checklist.md` |
| Prompt injection pode alterar a resposta | Envelope + fontes + nenhuma execução automática                     | task 07/10, `docs/web-search-checklist.md`    |
| App não assinado                         | Distribuição via release do Kolnd Hub; aviso de SmartScreen         | release da Hub                                |
| Main comprometido                        | Sem sandbox de processo main; fora do modelo                        | este documento                                |
| Outro usuário no mesmo perfil            | ACL do Windows; DPAPI do usuário                                    | `docs/memory.md`                              |

## 6. Matriz de rastreabilidade

| Item                              | Documento/teste que prova                                                 | Task   |
| --------------------------------- | ------------------------------------------------------------------------- | ------ |
| Chave write-only e cifrada        | `src/main/secrets.test.ts`, `src/main/ipc/chat.test.ts`                   | 05     |
| Chave fora de log e diagnóstico   | `src/main/security/redaction.test.ts`, `src/main/ipc/diagnostics.test.ts` | 05, 13 |
| Permissão de microfone            | `src/main/permissions.test.ts`, `src/main/voice-toggle.test.ts`           | 06     |
| Limites de sessão de voz          | `src/main/voice-timeouts.test.ts`                                         | 06     |
| Captura opt-in e blocklist        | `src/main/capture/controller.test.ts`, `src/main/capture/privacy.test.ts` | 07     |
| Limites de captura                | `src/main/capture/limits.test.ts`                                         | 07     |
| Injeção por tela                  | `src/main/capture/injection.test.ts`                                      | 07     |
| Confirmação e pausa de ações      | `src/main/gemini/tools/router.test.ts`, `src/main/actions/tools.test.ts`  | 05, 08 |
| Path traversal e arquivos         | `src/main/actions/fileOps.test.ts`, `src/main/actions/readFile.test.ts`   | 08     |
| UIA e energia                     | `src/main/actions/uia.test.ts`, `src/main/actions/system.test.ts`         | 08     |
| Auditoria sem conteúdo            | `src/main/audit/actions.test.ts`, `src/main/memory/privacy.test.ts`       | 08, 09 |
| Memória pausável e apagável       | `src/main/memory/privacy.test.ts`, `src/main/memory/exportImport.test.ts` | 09     |
| SSRF e allowlist de URL           | `src/shared/search.test.ts`, `src/main/search/fetchPage.test.ts`          | 10     |
| Injeção por web                   | `src/main/search/injection.test.ts`, `src/main/gemini/engine-web.test.ts` | 10     |
| Limites de pesquisa               | `src/main/search/limits.test.ts`                                          | 10     |
| Navegação bloqueada               | `src/main/navigation.test.ts`                                             | 00, 02 |
| CSP e webPreferences              | `src/main/security/hardening.test.ts`, `src/renderer/index.html`          | 13     |
| IPC allowlist, limite e remetente | `src/main/security/ipc.test.ts`                                           | 13     |
| Redação de logs                   | `src/main/security/redaction.test.ts`                                     | 13     |
| Custo e deduplicação              | `src/main/security/cost-limits.test.ts`                                   | 13     |
| Retenção e "apagar tudo"          | `src/main/security/data-lifecycle.test.ts`                                | 13     |
| Modos degradados                  | `src/main/security/degraded.test.ts`                                      | 13, 08 |
| Varredura de payloads malformados | `src/main/security/fuzz.test.ts`, `docs/security-robustness.md`           | 08     |
| Journal/undo em falha parcial     | `src/main/actions/fileOps.test.ts`                                        | 08     |
| Consentimentos e revogação        | `src/renderer/src/settings/consent-revocation.test.tsx`                   | 13     |
| Dependências e licenças           | `docs/licenses.md`                                                        | 13     |
| Release e hash                    | Release do Kolnd Hub (Absolem embarcado)                                  | 32     |

## 7. Revisão da task 08 (otimização, 27/11/2026)

A varredura com payloads sintéticos está em
`src/main/security/fuzz.test.ts`; a matriz de falhas e o antes/depois estão em
`docs/security-robustness.md`. Três correções foram feitas sem relaxar barreiras:

1. `sanitizeIpcError` lê `message` defensivamente (getter/`toString` hostil não
   escapa como exceção).
2. A redação de log passou a cobrir `file:///` e conteúdo sem aspas
   (`transcricao`, `prompt`, `resposta`, `response`) até o fim da linha.
3. `sanitizeSafeArgs` limita profundidade e ignora ciclos, sem perder o evento
   de auditoria.

Retry do cliente e do Live seguem limitados a 2 tentativas totais; nenhum
default de permissão, confirmação, SSRF, allowlist, CSP, sandbox ou
`safeStorage` mudou. Risco residual novo: nenhum identificado. Continua aceito
que logs `warn`/`error` possam conter mensagem de exceção de terceiro; a redação
cobre segredo, caminho pessoal, URL e conteúdo rotulado, não a semântica de
qualquer mensagem.

Validação manual ainda necessária: UAC do instalador, `safeStorage`/DPAPI na
conta real, revogação/pausa no app empacotado, disco cheio/removido, rede
indisponível e dispositivo de áudio removido.

## 8. Como revisar este documento

1. Toda mitigação citada precisa existir no código e ter teste ou checklist.
2. Toda linha de risco residual precisa dizer o motivo aceito e onde está
   registrado.
3. Uma nova superfície (novo canal IPC, nova ferramenta, novo download) obriga a
   atualizar este documento antes do release.
4. A validação de release do **Kolnd Hub** (que embarca o Absolem) atualiza este
   modelo na versão que está sendo publicada.
