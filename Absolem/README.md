# Absolem

**Assistente de IA para Windows** inspirado na lagarta azul de _Alice no Pais das Maravilhas_.
Nao e um app de janela com chat: e um agente presente na area de trabalho, que vive na
**bandeja do sistema** e, quando chamado, materializa um **avatar holografico** no canto
inferior esquerdo. Conversa por **voz em tempo real** (Gemini Live) com **barge-in**, com
**memoria de longo prazo** local e opcionais de **visao de tela**, **controle do computador**
e **pesquisa na internet com fontes**, sempre sob permissao explicita.

Distribuído junto com o **Kolnd Hub** (`kolnd-hub/resources/programs/Absolem`): o Absolem
**não tem versão, instalador, release ou updater próprios** — ele é atualizado quando a Hub é
instalada/atualizada. **Roda exclusivamente no Windows.** UI em **pt-BR**. Sem telemetria,
sem analytics, sem auto-update.

## Requisitos

- **Windows 10/11 x64.** (Sem build ARM64, Linux ou macOS na v1.)
- **Conta Gemini** (conta Google) com **chave de API** do **Google AI Studio**. O app nao
  funciona de conversa sem chave; **nada e enviado ao Gemini antes de haver chave**.
- **Microfone** para conversa por voz. Concedido com consentimento; pode ser negado.
- (Build local apenas) **Node.js >= 22** e **npm >= 10** e **Windows x64**. Visual Studio/
  MSVC **nao** e necessario para instalar; o modulo nativo `better-sqlite3` e baixado como
  **prebuild** para a ABI do Electron 28 (`postinstall-sqlite.cjs` + `electron-builder
install-app-deps`, `npmRebuild: true`). Nenhuma dependencia nova.

## Instalacao (via Kolnd Hub)

O Absolem **nao tem instalador proprio**. Ele e embarcado na pasta do **Kolnd Hub**
(`resources/programs/Absolem`) e inicia pelo card **Absolem** na Hub.

1. Instale/atualize o **Kolnd Hub** pelo instalador oficial. O Absolem vai junto: nao ha
   `.exe` separado, hash proprio nem release propria do Absolem.
2. Abra o Absolem pela Hub. O app roda direto da pasta da Hub; desinstalar a Hub remove o
   programa (os dados em `%APPDATA%\absolem` ficam).
3. Identidade: `appId` `com.kolnd.absolem`; `app.setAppUserModelId('com.kolnd.absolem')`.
   Instancia unica: reabrir foca o app.
4. A versao exibida em **Configuracoes > Sobre** e a **versao do Kolnd Hub** — o Absolem
   nao tem versao propria. Fora da Hub, o fallback e o placeholder mecanico `0.0.0`.

## Primeira configuracao

Na primeira execucao o app abre **Configuracoes > Chave e custo**. Resumo:

1. Crie a chave no Google AI Studio (`https://aistudio.google.com/apikey`) com sua conta Google.
2. Cole em **Chave do Gemini** e salve. **Testar conexao** e minimo e contabilizado.
3. Conceda **microfone**; abra o overlay e fale. Ouca a primeira resposta; barge-in ativo.
4. Revise **Permissoes**: instalações novas começam com microfone, visão sob demanda e
   categorias de ação liberados; ajuste ou pause conforme seu risco.
5. Confira **Memoria vazia**. Nada e importado.

**Chave Gemini:** cifrada pelo Windows com **`safeStorage` (DPAPI)**, em
`%APPDATA%\absolem\secrets.bin`, **fora** do `config.json`. Nunca em texto plano, nunca em log,
nunca exposta ao renderer. Sem `safeStorage.isEncryptionAvailable()` a gravacao e recusada.
Trocar conta/máquina exige redigitar. Sem fallback para texto plano. Nunca chamar Gemini antes
da chave.

**Custo:** a v1 **nao** promete nada gratuito. **A conta Gemini e a chave sao suas; o custo do
Gemini e cobrado pela sua conta Google**; precos definidos pelo Google. O app **nao** cobra;
**mede tokens** localmente (nunca moeda), mostra teto mensal `monthlyTokenCap` + aviso 80%.
**Permissoes minimas** e **pausa** (`Control+Alt+P`) para controle.

**Modelos e voz:** o texto usa **`gemini-3.8-flash`** e a voz em tempo real usa o modelo
Live **`gemini-3.8-live`** com a voz pre-definida **Charon**. Os dois valores ficam em
`config.json`; campos legados de modelo são normalizados para
`gemini-3.8-live` e não selecionam outro modelo em runtime.

## Atalhos

- `Control+Alt+A` - mostrar/ocultar overlay (tambem `Control+Alt+Space` para voz, conforme
  configuracao de voz).
- `Control+Alt+P` - pausar/retomar acoes do computador.
- Bandeja: clique esquerdo alterna overlay; botao direito -> Abrir Overlay / Configuracoes /
  Sair. Fechar a janela **nao encerra**; **Sair** encerra. Autostart **opt-in** (por usuario,
  `--hidden`, so app instalado).

## Onde ficam os dados

`userData` = `%APPDATA%\absolem` (nome do pacote `absolem`; verificado). O programa roda da
pasta do Kolnd Hub (`resources/programs/Absolem`), nao de uma instalacao propria.

- `%APPDATA%\absolem\config.json` - configuracoes (electron-store).
- `%APPDATA%\absolem\memory.sqlite` - **memoria SQLite local** (+ FTS5). **O banco NAO e cifrado.**
- `%APPDATA%\absolem\secrets.bin` - **chave Gemini cifrada** (`safeStorage`/DPAPI). Nao em texto.
- `%APPDATA%\absolem\logs\absolem.log` - log com **redacao de segredos**.
- `%APPDATA%\absolem\Crashpad` - minidumps locais; `uploadToServer: false`.
- historico/auditoria locais. **Nada sai da maquina** sem acao sua ou chamada ao Gemini.

## Privacidade e custo

- **Permissões iniciais liberadas.** Instalações novas recebem microfone (`true`), visão sob
  demanda (`privacy.screen.mode='on'`) e categorias de ação (`allow`); `permissions.paused`
  começa `false`. Revise a aba Permissões: energia, arquivos e UI Automation podem ter impacto
  real. Cada categoria pode ser revogada para `ask` ou `deny`, e escolhas explícitas existentes
  são preservadas.
- **Elevação/UAC.** O executável solicita `requireAdministrator` no Windows e o UAC aparece a
  cada abertura. Isso amplia o impacto de ações; não há elevação silenciosa.
- **Sem promessa de custo gratuito.** O app nao cobra; **o Gemini cobra sua conta Google**.
  Medicao local em tokens; teto configuravel. Remover a chave desliga conversa sem apagar o
  resto. **Nada ao Gemini antes da chave.**

## Desinstalar

Desinstale/atualize pelo **Kolnd Hub** (Configuracoes > Aplicativos ou instalador da Hub).
O Absolem nao tem entrada propria em "Aplicativos". Feche o Absolem antes (pela bandeja,
**Sair**).

- **Removido:** a pasta do programa dentro da Hub (`resources/programs/Absolem`) e os
  atalhos/entrada de autostart do Absolem. Nao ha dados do programa fora da pasta da Hub.
- **Preservado:** `%APPDATA%\absolem` inteiro - **memoria** (`memory.sqlite`), `config.json`,
  `secrets.bin`, logs, `Crashpad`. **Nada de dados do usuario e apagado sem acao explicita.**
- **Limpeza manual (irreversivel):** feche, desinstale e **apague voce mesmo**
  `%APPDATA%\absolem`. **Faca backup antes.** Reinstalar reencontra os dados preservados.

## Limitacoes conhecidas (v1)

- **Atualizado junto com o Kolnd Hub:** sem instalador, release ou updater proprios. A versao
  exibida em **Configuracoes > Sobre** e a da Hub; reinstalar/atualizar a Hub traz o Absolem
  novo e preserva `%APPDATA%\absolem`.
- **Sem assinatura/reputacao propria:** o binario entregue ao usuario e o do release da Hub.
- **UAC:** cada abertura do executável pode exibir o aviso do Windows por exigir administrador.
- **Tela cheia exclusiva:** overlay pode ficar oculto; atalhos/indicadores podem nao aparecer.
- **Banco local nao cifrado** (`memory.sqlite`); so a chave Gemini e cifrada (`safeStorage`).
- Sem wake word na v1; sem temas claros; sem marketplace; sem multiplas conversas; sem
  auto-update; sem telemetria. Nao promete cumprir o que tasks 00-11 nao entregam.
- Custo de API e da sua conta Gemini; v1 mede tokens, nao moeda.

## Empacotamento (dist/, resources/)

- **`resources/`** - recursos de build (`buildResources`): `icon.ico` (256,128,64,48,32,16),
  `icon.png` 512, `tray-icon.png` 32, `tray-icon@2x.png` 64, `CREDITS.md`. **Obra propria,
  gerada por codigo** (`node scripts/generate-icons.cjs`, Node builtins, sem asset de
  terceiros). `tray-icon.png` -> `<resources>/tray-icon.png` no pacote. `app.setAppUserModelId(
'com.kolnd.absolem')`.
- **`dist/`** - saida do electron-builder (`directories.output=dist`, gitignored).
  `npm run package:dir` -> `dist/win-unpacked/Absolem.exe`. **Nao ha instalador proprio nem
  nome de artefato versionado:** a Hub copia `win-unpacked` para
  `kolnd-hub/resources/programs/Absolem` (`kolnd-hub/scripts/build-absolem.ps1`,
  `robocopy /MIR`).
- Versao unica do produto = **versao do Kolnd Hub** (variavel `ABSOLEM_HUB_VERSION` no
  launch). `package.json.version` e apenas o placeholder `0.0.0` exigido pelo Electron.
- `appId com.kolnd.absolem`; `productName Absolem`; `electron-builder.yml` só empacota
  `win-unpacked` (sem `target` de instalador), com `requestedExecutionLevel:
requireAdministrator`.
- `resources` excluidos do app.asar exceto `extraResources`; `src`/`tests`/`docs`/configs fora;
  `LICENSE` (MIT) acompanha. `asar:true`; `asarUnpack` `**/node_modules/better-sqlite3/**` +
  `**/*.node` (`better_sqlite3.node` fora do asar). `npmRebuild:true`.

## Comandos (desenvolvimento e build)

Requisitos do build: **Node.js >= 22**, **Windows x64**, `npm >= 10`; `npm ci`. O build usado
pela Hub e `electron-vite build` + `electron-builder --dir` (`win-unpacked`). Nada de nova dep.

```powershell
cd Absolem
npm ci
npm run dev          # electron-vite dev
npm run build        # electron-vite build -> out/main, out/preload, out/renderer
npm run typecheck    # tsc -p tsconfig.node.json && tsc -p tsconfig.web.json
npm run lint         # ESLint flat config
npm run format:check # Prettier
npm test             # Vitest
npm run verify       # typecheck + lint + format:check + test
npm run verify:build # verify + build
npm run test:e2e     # build + Playwright (duas vezes no release)

# Empacotamento (sem instalador: apenas win-unpacked para o bundle da Hub)
npm run package:dir      # electron-builder --dir -> dist/win-unpacked
npx electron-builder --dir
npx electron-builder install-app-deps   # rebuild nativo better-sqlite3 (Electron ABI)

# Icones por codigo (sem asset de terceiros)
node scripts/generate-icons.cjs
```

Gate nativo: `better_sqlite3.node` em `dist/win-unpacked/resources/app.asar.unpacked/...` fora
do `app.asar`; se `better-sqlite3` nao carregar no app empacotado, pare. Smoke opcional:
`ABSOLEM_MEMORY_SMOKE=1` no `dist/win-unpacked/Absolem.exe`.

## Docs

- `docs/` de capacidades (memoria, permissoes, voz, pesquisa, tela, ameacas, desempenho...),
  `docs/test-matrix.md` e `resources/CREDITS.md`.
- Distribuicao, release e atualizacao do Absolem sao as do **Kolnd Hub** (nao ha docs de
  release proprios do Absolem).

## Licenca

**MIT.** Ver `LICENSE`. Icones obra propria (`resources/CREDITS.md`). Sem asset de terceiros.
