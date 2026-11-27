# Absolem

**Assistente de IA para Windows** inspirado na lagarta azul de _Alice no Pais das Maravilhas_.
Nao e um app de janela com chat: e um agente presente na area de trabalho, que vive na
**bandeja do sistema** e, quando chamado, materializa um **avatar holografico** no canto
inferior esquerdo. Conversa por **voz em tempo real** (Gemini Live) com **barge-in**, com
**memoria de longo prazo** local e opcionais de **visao de tela**, **controle do computador**
e **pesquisa na internet com fontes**, sempre sob permissao explicita.

App **independente** no monorepo (`Absolem/`), sem dependencia do Kolnd Hub. **Roda
exclusivamente no Windows.** UI em **pt-BR**. Sem telemetria, sem analytics, sem auto-update
silencioso.

## Requisitos

- **Windows 10/11 x64.** (Sem build ARM64, Linux ou macOS na v1.)
- **Conta Gemini** (conta Google) com **chave de API** do **Google AI Studio**. O app nao
  funciona de conversa sem chave; **nada e enviado ao Gemini antes de haver chave**.
- **Microfone** para conversa por voz. Concedido com consentimento; pode ser negado.
- (Build local apenas) **Node.js >= 22** e **npm >= 10** e **Windows x64**. Visual Studio/
  MSVC **nao** e necessario para instalar; o modulo nativo `better-sqlite3` e baixado como
  **prebuild** para a ABI do Electron 28 (`postinstall-sqlite.cjs` + `electron-builder
install-app-deps`, `npmRebuild: true`). Nenhuma dependencia nova.

## Instalacao

1. Confira o **SHA-256** antes de instalar (app nao assinado na v1; ver abaixo e
   `docs/SIGNING.md`):
   ```powershell
   Get-FileHash -Algorithm SHA256 ".\Absolem Setup <versao>.exe"
   ```
   Compare com `Absolem Setup <versao>.exe.sha256` (formato `<hash>  <arquivo>`, minusculas).
   **Divergiu? Nao instale.**
2. Execute `Absolem Setup <versao>.exe`. Pode aparecer **SmartScreen** ("aplicativo nao
   reconhecido") porque **nao e assinado**; se o hash acima confere, escolha "Mais informacoes"
   -> "Executar assim mesmo". Nao ha reputacao de assinatura.
3. **Instalador NSIS guiado** (nao one-click). **Por usuario** (`perMachine: false`), **sem
   Administrador**; destino `%LOCALAPPDATA%\Programs\Absolem`. A pasta **nao** pode ser
   alterada. **Sem atalho na Area de Trabalho; atalho no Menu Iniciar.**
4. `appId` `com.kolnd.absolem`; `app.setAppUserModelId('com.kolnd.absolem')`. Instancia unica:
   reabrir foca o app.

## Primeira configuracao

Na primeira execucao o app abre **Configuracoes > Chave e custo**. Passo a passo em
`docs/FIRST-RUN-CHECKLIST.md`. Resumo:

1. Crie a chave no Google AI Studio (`https://aistudio.google.com/apikey`) com sua conta Google.
2. Cole em **Chave do Gemini** e salve. **Testar conexao** e minimo e contabilizado.
3. Conceda **microfone**; abra o overlay e fale. Ouca a primeira resposta; barge-in ativo.
4. Revise **Permissoes**: minimo; visao de tela opt-in; acao destrutiva com confirmacao; pausa.
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
`config.json` (`gemini.model` e `gemini.liveModel`); a migracao 1.12.0 troca apenas modelos
comprovadamente desligados e preserva modelos customizados.

## Atalhos

- `Control+Alt+A` - mostrar/ocultar overlay (tambem `Control+Alt+Space` para voz, conforme
  configuracao de voz).
- `Control+Alt+P` - pausar/retomar acoes do computador.
- Bandeja: clique esquerdo alterna overlay; botao direito -> Abrir Overlay / Configuracoes /
  Sair. Fechar a janela **nao encerra**; **Sair** encerra. Autostart **opt-in** (por usuario,
  `--hidden`, so app instalado).

## Onde ficam os dados

`userData` = `%APPDATA%\absolem` (nome do pacote `absolem`; verificado). App instalado em
`%LOCALAPPDATA%\Programs\Absolem`.

- `%APPDATA%\absolem\config.json` - configuracoes (electron-store).
- `%APPDATA%\absolem\memory.sqlite` - **memoria SQLite local** (+ FTS5). **O banco NAO e cifrado.**
- `%APPDATA%\absolem\secrets.bin` - **chave Gemini cifrada** (`safeStorage`/DPAPI). Nao em texto.
- `%APPDATA%\absolem\logs\absolem.log` - log com **redacao de segredos**.
- `%APPDATA%\absolem\Crashpad` - minidumps locais; `uploadToServer: false`.
- historico/auditoria locais. **Nada sai da maquina** sem acao sua ou chamada ao Gemini.

## Privacidade e custo

- **Privacidade por padrao.** Microfone/tela/arquivos/processos com consentimento; sem
  telemetria/analytics/upload remoto. Visao de tela opt-in; acoes com confirmacao + log.
- **Sem promessa de custo gratuito.** O app nao cobra; **o Gemini cobra sua conta Google**.
  Medicao local em tokens; teto configuravel. Remover a chave desliga conversa sem apagar o
  resto. **Nada ao Gemini antes da chave.**

## Desinstalar

**Configuracoes > Aplicativos > Absolem > Desinstalar** (per-user, sem admin; ou pelo Menu
Iniciar). **App fechado** antes (app aberto pode pedir para fechar; desinstalar com app aberto
nao e recomendado). NSIS `deleteAppDataOnUninstall: false`. **Sem opcao que apague dados.**

- **Removido:** `%LOCALAPPDATA%\Programs\Absolem` inteiro (app, `app.asar`, recursos,
  `better_sqlite3.node`, icones da bandeja, atalhos). Entrada de **autostart** removida.
- **Preservado:** `%APPDATA%\absolem` inteiro - **memoria** (`memory.sqlite`), `config.json`,
  `secrets.bin`, logs, `Crashpad`. **Nada de dados do usuario e apagado sem acao explicita.**
- **Limpeza manual (irreversivel):** feche, desinstale e **apague voce mesmo**
  `%APPDATA%\absolem`. **Faca backup antes.** Reinstalar reencontra os dados preservados.

## Limitacoes conhecidas (v1)

- **Nao assinado** + **SmartScreen**; conferir **SHA-256**. Ver `docs/SIGNING.md`.
- **Atualizacao manual** (nao auto-update silencioso; sem `electron-updater`). Botao
  **Verificar atualizacoes** abre a pagina de releases no navegador (`https`, nada baixado).
  Atualizar = instalar o novo `.exe` por cima (NSIS per-user); `%APPDATA%\absolem` preservado.
  Ver `docs/RELEASE.md`.
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
- **`dist/`** - saida do electron-builder (`directories.output=dist`, gitignored). `npm run
package` -> `dist/Absolem Setup <versao>.exe`. `dist/win-unpacked/Absolem.exe` (`package:dir`).
  `scripts/hash-artifact.ps1` gera `.exe.sha256` + `dist/release-notes.md`.
- NSIS per-user; sem assinatura; `artifactName: Absolem Setup ${version}.exe`; versao unica
  `package.json.version` (`__APP_VERSION__`, `app.getVersion()`, teste `src/shared/
version.test.ts`). `appId com.kolnd.absolem`; `productName Absolem`.
- SHA-256 verificar (acima). Hash **conferido** contra `Get-FileHash`. Ver `docs/RELEASE.md`.
- `resources` excluidos do app.asar exceto `extraResources`; `src`/`tests`/`docs`/configs fora;
  `LICENSE` (MIT) acompanha. `asar:true`; `asarUnpack` `**/node_modules/better-sqlite3/**` +
  `**/*.node` (`better_sqlite3.node` fora do asar). `npmRebuild:true`.

## Comandos (desenvolvimento e build)

Requisitos do build: **Node.js >= 22**, **Windows x64**, `npm >= 10`; `npm ci`. `npm run
package`/`electron-builder --win` produzem o NSIS; `electron-vite build`. Nada de nova dep.

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

# Empacotamento (NSIS por usuario)
npm run package          # electron-vite build && electron-builder --win
npm run package:dir      # electron-builder --dir -> dist/win-unpacked
npx electron-builder --dir
npx electron-builder install-app-deps   # rebuild nativo better-sqlite3 (Electron ABI)

# Icones por codigo (sem asset de terceiros)
node scripts/generate-icons.cjs

# SHA-256 + release-notes.md (PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\hash-artifact.ps1 -Path "dist\Absolem Setup <versao>.exe"
```

Gate nativo: `better_sqlite3.node` em `dist/win-unpacked/resources/app.asar.unpacked/...` fora
do `app.asar`; se `better-sqlite3` nao carregar no app empacotado, pare. Smoke opcional:
`ABSOLEM_MEMORY_SMOKE=1` no `dist/win-unpacked/Absolem.exe`.

## Docs

- `docs/FIRST-RUN-CHECKLIST.md` - checklist executavel de primeira execucao + registro T8.
- `docs/RELEASE.md` - release, hash SHA-256, **updater manual v1**, atualizacao/desinstalacao.
- `docs/SIGNING.md` - **nao assinado v1**, SmartScreen, SHA-256, futuro OV/EV + timestamp.
- `docs/` de capacidades (memoria, permissoes, voz, pesquisa, tela...) e `resources/CREDITS.md`.

## Licenca

**MIT.** Ver `LICENSE`. Icones obra propria (`resources/CREDITS.md`). Sem asset de terceiros.
