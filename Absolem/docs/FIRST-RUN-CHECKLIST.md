# Checklist de primeira execucao - Absolem

Guia executavel para alguem que nunca viu o projeto. Faca os passos na ordem. Sem promessa
de custo gratuito, sem promessa de assinatura: leia o que fica salvo, onde, e como remover.

**Requisitos:** Windows 10/11 x64, conta Google com chave Gemini (Google AI Studio), microfone.
**Versao testada:** preencher. **Data:** preencher. **Hash SHA-256 do `.exe`:** preencher.
**Nao e necessario** Node.js, Visual Studio nem administrador para _usar_ o app instalado.

---

## 0. Antes de instalar (SHA-256 e SmartScreen)

- [ ] Baixe `Absolem Setup <versao>.exe` e o arquivo `Absolem Setup <versao>.exe.sha256`.
- [ ] **Confira o hash antes de instalar** (o app nao e assinado na v1; ver `docs/SIGNING.md`):
  ```powershell
  Get-FileHash -Algorithm SHA256 ".\Absolem Setup <versao>.exe"
  ```
  Compare com a primeira coluna do `.sha256` e com o `<hash>  <arquivo>`. **Divergiu? Nao instale.**
- [ ] Ao executar, o Windows pode mostrar **SmartScreen** ("Aplicativo nao reconhecido" /
      "Microsoft Defender SmartScreen impediu..."). Isso e esperado porque o executavel **nao e
      assinado**. So prossiga se o hash acima confere. Clique em "Mais informacoes" e depois
      "Executar assim mesmo". Nao ha publicacao automatica nem verificacao de reputacao.
- [ ] Confira que nao ha promessa de conta ou custo do app: **o custo do Gemini e da sua conta
      Google**; o app so mede tokens localmente e nao cobra nada por si.

## 1. Instalar

- [ ] Execute `Absolem Setup <versao>.exe`. Instalacao **por usuario**, **sem Administrador**
      (nao pede UAC). Destino: `%LOCALAPPDATA%\Programs\Absolem`.
- [ ] Instalador **guiado** (nao one-click); a pasta **nao** pode ser alterada
      (`allowToChangeInstallationDirectory: false`); `perMachine: false`.
- [ ] Sem atalho na Area de Trabalho; **atalho no Menu Iniciar** criado.
- [ ] Versao exibida na aba **Sobre** = `version` de `package.json`.

## 2. Abrir pela bandeja

- [ ] O app inicia **minimizado na bandeja** (system tray). Nenhuma janela rouba foco.
- [ ] Na bandeja: **clique esquerdo** alterna o overlay; **botao direito** -> **Abrir Overlay**,
      **Configuracoes**, **Sair**.
- [ ] Overlay aparece no **canto inferior esquerdo**, sempre no topo, sem roubar foco.
- [ ] Atalhos globais: `Control+Alt+A` (mostrar/ocultar overlay), `Control+Alt+P` (pausar acoes).
      Se um atalho nao registrar (conflito), o app avisa; nada quebra.

## 3. Chave do Gemini (a conversa nao funciona sem chave; nada e chamado antes da chave)

- [ ] **Conta Gemini**: precisa de uma **conta Google**. Crie uma chave de API no **Google AI
      Studio**: `https://aistudio.google.com/apikey`. (A chave nunca e exibida de volta, nunca vai
      para log, nunca atravessa para telas inseguras.)
- [ ] **Nada e enviado ao Gemini antes de haver chave.** Sem chave, `voice:start`/chat respondem
      com erro de autenticacao local; **nenhuma chamada de rede ao Gemini acontece** antes da chave.
- [ ] Na primeira execucao o app abre **Configuracoes > Chave e custo**. Cole a chave em
      **Chave do Gemini** e clique **Salvar chave**.
- [ ] **`safeStorage`:** a chave e cifrada pelo Windows (**DPAPI**), guardada em
      `%APPDATA%\absolem\secrets.bin`, **fora** do `config.json`. Nunca em texto plano. Se
      `safeStorage.isEncryptionAvailable()` for falso, a gravacao e **recusada**. O blob e amarrado
      ao usuario do Windows; trocar de conta/máquina exige **redigitar** a chave. Nao ha fallback
      para texto plano. (A app **nao** grava a chave em arquivo `.env`.)
- [ ] Opcional e minimo: clique **Testar conexao**. O teste e **minimo e contabilizado** (uma
      chamada curta contra o Gemini); nao roda em laco. Falha de rede/autenticacao e exibida, nada
      e reenviado em segredo.
- [ ] **Custo:** a v1 **nao** promete nada gratuito. O Gemini cobra pela **sua conta Google**;
      precos sao definidos pelo Google. O app **mede tokens** localmente e mostra teto mensal
      (`monthlyTokenCap`, padrao 2.000.000) com aviso em 80%; **nao estima moeda**. Voce controla
      o teto e pode pausar acoes. Remover a chave (`Remover chave`) desliga a conversa sem apagar
      o resto.

## 4. Permissoes minimas

- [ ] **Microfone:** conceda apenas o consentimento de voz no app (`permissions.microphone`).
      O microfone **so abre com consentimento**; voce pode negar. Sem microfone, conversa por voz
      nao funciona, mas o resto do app segue.
- [ ] **Permissoes de sistema (tasks 07/08):** mantenha o minimo. Visao de tela **opt-in**
      (`privacy.screen.mode = off` por padrao); acoes (`apps.launch`, `apps.close`, `files.read`,
      `files.write`, `uia.control`) em **ask** ou **deny**; `system.power` **deny**; `web.search`
      **allow** apenas se quiser pesquisa com fontes. Ha **confirmacao obrigatoria** para acao
      destrutiva; **pausa global** `Control+Alt+P`; **log de auditoria**. No Windows, conceda o que
      o app pedir apenas se voce confia; nada sai da maquina sem acao sua ou chamada ao Gemini.
- [ ] Nada de telemetria, analytics ou upload remoto. Crash reporting local (`uploadToServer:
false`). Log padrao redige segredos.

## 5. Testar microfone e ouvir a primeira resposta

- [ ] Abra o overlay, conceda microfone e **clique no avatar** (ou `Control+Alt+A` + voz) para
      iniciar escuta. Fale uma frase curta ("Ola Absolem"). O app captura mic (16 kHz) e envia ao
      Gemini Live **com sua chave**.
- [ ] **Ouca a primeira resposta**: o Absolem responde por voz; ha transcricao ao vivo e balao
      de resposta. Se falar durante a resposta, a fala e **interrompida** (barge-in).
- [ ] Se nao ouvir: confira consentimento de microfone, dispositivo de entrada/saida
      (Configuracoes > Voz), volume, e se a chave esta salva e testada. Sem chave nao ha resposta.
- [ ] **Tela cheia exclusiva:** em jogos/apps em tela cheia exclusiva o overlay pode ficar
      oculto e atalhos/indicadores podem nao aparecer; e uma limitacao conhecida (`hideOnFullscreen`).

## 6. Conferir memoria vazia

- [ ] Numa instalacao nova (userData novo), **Configuracoes > Memoria** mostra **0 memorias**
      (fact/preference/profile/temporary zerados). Nada de memoria de terceiros.
- [ ] O banco e **SQLite local** em `%APPDATA%\absolem` (ex.: `memory.db`). **O banco nao e
      cifrado** (a chave Gemini e que e cifrada com `safeStorage`). Voce pode **ver, editar e
      apagar** cada memoria; apagar tudo e permitido. A memoria persiste entre sessoes apos reabrir.
- [ ] Confira que nenhuma chave Gemini aparece nas memorias/logs.

## 7. Desinstalar e verificar o que ficou

- [ ] **Desinstalar** por **Configuracoes > Aplicativos > Absolem > Desinstalar** (per-user, sem
      admin). Ha desinstalador no Menu Iniciar. O app deve estar **fechado** (desinstalacao com app
      aberto pode pedir para fechar).
- [ ] **Removido:** `%LOCALAPPDATA%\Programs\Absolem` inteiro (app + recursos + `app.asar` +
      `better_sqlite3.node` + icones da bandeja). O item de autostart no Windows (se ligado) e
      removido.
- [ ] **Preservado:** `%APPDATA%\absolem` **inteiro** - memoria (`memory.db`), `config.json`,
      logs, `Crashpad`, **chave cifrada** `secrets.bin`. `deleteAppDataOnUninstall: false`. **Nada
      de dados do usuario e apagado sem acao explicita.**
- [ ] **Limpeza manual (opcional, irreversivel):** para apagar tambem seus dados, feche o app,
      desinstale e **apague voce mesmo** `%APPDATA%\absolem`. Faca backup antes. Nao ha opcao no
      instalador que apague dados.
- [ ] **Autostart:** se ligado, desative antes de desinstalar; a entrada de inicializacao com
      Windows (por usuario) e removida. Confira em `Configuracoes > Aplicativos > Inicializar`.

---

## Registro de execucao (T8 - máquina limpa)

Preencha ao executar de fato numa **VM Windows 11 limpa (sem Node, sem Visual Studio)**.

| Campo                                                               | Valor                                   |
| ------------------------------------------------------------------- | --------------------------------------- |
| Data                                                                | (preencher)                             |
| Versao                                                              | (preencher; = `package.json.version`)   |
| Artefato                                                            | `Absolem Setup <versao>.exe`            |
| SHA-256                                                             | (preencher; conferido contra `.sha256`) |
| VM / conta sem admin                                                | (preencher)                             |
| Instalacao per-user                                                 | (ok / falhou)                           |
| Primeira execucao + chave Gemini                                    | (ok / falhou)                           |
| Microfone + primeira resposta                                       | (ok / falhou)                           |
| Memoria vazia                                                       | (ok / falhou)                           |
| `better_sqlite3.node` carregado (sem falha de modulo nativo no log) | (ok / falhou / nao verificado)          |
| Reinicio Windows + autostart                                        | (ok / falhou / nao testado)             |
| Atualizacao sobre versao anterior (mesma pasta)                     | (ok / falhou / nao testado)             |
| App aberto + desinstalacao                                          | (ok / falhou / nao testado)             |
| `%LOCALAPPDATA%\Programs\Absolem` removido                          | (ok / falhou)                           |
| `%APPDATA%\absolem` preservado                                      | (ok / falhou)                           |
| Resultado geral                                                     | (ok / falhou / PENDENTE)                |

---

## Registro de execucao (T8) - snapshot local

Este snapshot registra apenas verificacao **local** de artefatos; **nao** substitui VM limpa.

| Campo                                  | Valor                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data                                   | 2026-11-26                                                                                                                                                                             |
| Versao                                 | 0.1.0 (= `package.json.version`)                                                                                                                                                       |
| Artefato                               | `dist/Absolem Setup 0.1.0.exe` (`Absolem Setup 0.1.0.exe`)                                                                                                                             |
| SHA-256                                | `cdeaa2e9fe338d0e4fb1a101da3e944d4fa89873becceef7d252ea654d5069e5` (conferido vs `Get-FileHash` + `.sha256`)                                                                           |
| Artefatos verificados                  | `.exe` sim; `.sha256` sim; `better_sqlite3.node` fora do `app.asar` sim; `tray-icon.png` + `tray-icon@2x.png` em `resources/` sim; `docs/FIRST-RUN-CHECKLIST.md` sim                   |
| Smoke empacotado                       | `ABSOLEM_MEMORY_SMOKE=1` no `dist/win-unpacked/Absolem.exe` com `ABSOLEM_TEST_USERDATA` temporario; `memory:stats ok`; sem falha de modulo nativo no log real; memoria vazia (total 0) |
| Caminhos documentados                  | `%LOCALAPPDATA%\Programs\Absolem` (app); `%APPDATA%\absolem` (memoria/config/logs/chave); removido vs preservado; `deleteAppDataOnUninstall=false`                                     |
| Instalacao per-user (VM)               | **PENDENTE** (nao executado em VM Windows 11 limpa sem Node/Visual Studio)                                                                                                             |
| Reinicio + autostart (VM)              | **PENDENTE**                                                                                                                                                                           |
| Atualizacao sobre versao anterior (VM) | **PENDENTE**                                                                                                                                                                           |
| App aberto + desinstalacao (VM)        | **PENDENTE**                                                                                                                                                                           |
| Preservacao `%APPDATA%\absolem` (VM)   | **PENDENTE**                                                                                                                                                                           |
| Resultado T8                           | **PENDENTE - validacao em maquina limpa nao executada** (artefatos locais verificados nao substituem VM)                                                                               |
