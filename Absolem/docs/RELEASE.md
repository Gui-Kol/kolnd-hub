# Release - Absolem

Processo de release do Absolem (v1). Fonte unica da versao: `version` em
`Absolem/package.json`. **Nada e publicado automaticamente**, **nada e commitado** pelo
subagente; nao ha `git tag`/`git push`/`gh release` aqui. Publicacao e decisao do usuario.

## Requisitos do build

- **Windows x64.**
- **Node.js >= 22** (`engines.node >=22`, `npm >= 10`, `engine-strict`), `npm ci`.
- electron-vite + electron-builder 24 (ja nas dependencias; **nenhuma nova**).
- `npmRebuild: true`; modulo nativo `better-sqlite3` em **prebuild** para Electron 28 ABI
  (`postinstall-sqlite.cjs` + `electron-builder install-app-deps`; sem recompilar sem
  necessidade; Visual Studio nao necessario).
- **App nao assinado na v1.** Sem assinatura no `electron-builder.yml`. Ver `docs/SIGNING.md`.

## Build

```powershell
cd Absolem
npm ci
npm run verify:build          # verify + build
npm run package               # electron-vite build && electron-builder --win
# -> dist\Absolem Setup <versao>.exe
npm run package:dir           # electron-builder --dir -> dist\win-unpacked
```

Icones por codigo (sem asset de terceiros): `node scripts/generate-icons.cjs`. Regenerar
**antes** do `npm run package`. `appId com.kolnd.absolem`; `productName Absolem`; NSIS
per-user `perMachine:false`; `deleteAppDataOnUninstall:false`; `artifactName Absolem Setup
${version}.exe`.

**Gate nativo:** `better_sqlite3.node` em
`dist\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3\build\Release`
(fora do `app.asar`); `better-sqlite3` **carrega** no app empacotado (smoke
`ABSOLEM_MEMORY_SMOKE=1`; `memory:stats ok`). Se nao carregar, **pare**. Nao trocar por
`sql.js` sem aprovacao. Nao adicionar dependencia.

## Versao unica

- `package.json.version`.
- `electron.vite.config.ts` -> `__APP_VERSION__`.
- UI Sobre -> `app.getVersion()` (== `__APP_VERSION__` == `package.json.version`).
- `electron-builder.yml` -> `artifactName ... ${version}`.
- Gate: `npx vitest run src/shared/version.test.ts` (`nenhuma versao hardcoded`, `__APP_VERSION__`
  vem do `package.json`, `artifactName` usa `${version}`). **Nada de `0.1.0` hardcoded em `src/`.**
- Para um release novo, bump `package.json.version` (e `package-lock`) e rebuild; nada em `src/`.

## Artefato + SHA-256

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\hash-artifact.ps1 -Path "dist\Absolem Setup <versao>.exe"
```

- Gera `dist\Absolem Setup <versao>.exe.sha256` (`Get-FileHash -Algorithm SHA256`; formato
  `<hash>  <arquivo>`, hash minusculo) ao lado do `.exe`.
- Gera `dist\release-notes.md` com **versao, data, requisitos, mudancas e hash**.
- `dist/` contem `.exe` + `.sha256`. Conferir:
  ```powershell
  Get-FileHash -Algorithm SHA256 "dist\Absolem Setup <versao>.exe"
  Select-String -Path dist\*.sha256 -Pattern "^[a-f0-9]{64}"
  ```
- **SHA-256 obrigatorio** (app nao assinado). Nao publicar sem hash conferido. Ver
  `docs/SIGNING.md`. **Assinar o artefato antes de gerar o checksum** (futuro).

## Release notes

`dist/release-notes.md` (gerado). Publicar notas com versao, data, requisitos, mudancas,
hash, **SmartScreen/nao assinado**, **desinstalacao/o que ficou**. Nao prometer o que tasks
00-11 nao entregam.

## Atualizacao manual na v1 (decisao fechada)

**Atualizacao manual.** Sem auto-update silencioso, sem delta update, sem canal beta, **sem
`electron-updater`**, sem download/execucao automatica, sem publicacao automatica. **Nada e
baixado pelo app.**

- **Botao "Verificar atualizacoes"** na aba **Sobre** (`AboutTab`) abre a **pagina de
  releases** no navegador padrao.
- **Canal IPC `app:open-updates`** (`appOpenUpdates`); preload `openUpdates`; handler
  `ipcMain.handle`; payload invalido rejeitado; `{ ok } / { ok:false, error }`.
- **`shell.openExternal` apenas `https`.** URL invalida/nao-https recusada.
- **URL de releases vem de `package.json.repository`.** `releasesUrl()` =
  `<repository normalizado>/releases`. Hoje `https://github.com/Gui-Kol/kolnd-hub/releases`.
  (`repository.url` sem `git+`/`.git`; `git@` scp-like -> `https`.)
- **Nao baixa nada.** Sem `fetch`, sem `net`, sem `downloadItem`, sem `electron-updater`.
  `src/main/updates.ts` + testes `src/main/updates.test.ts` (`abre apenas https`, `URL vem
do package.json`, `nao baixa nada`).
- **Atualizar:** baixar o novo `.exe` manualmente, **conferir SHA-256**, instalar por cima
  (NSIS per-user; mesma pasta `%LOCALAPPDATA%\Programs\Absolem`). `%APPDATA%\absolem`
  **preservado**. Reiniciar o app.
- Autostart: se ligado, a entrada por usuario permanece; app reinicia na versao nova.

## Desinstalacao

NSIS `deleteAppDataOnUninstall:false`. **Removido:** `%LOCALAPPDATA%\Programs\Absolem`.
**Preservado:** `%APPDATA%\absolem` (memoria `memory.db` - **nao cifrado**, `config.json`,
`secrets.bin` - chave Gemini cifrada `safeStorage`, logs, `Crashpad`). **Sem opcao que apague
dados.** Limpeza manual irreversivel documentada no `README.md`. Ver `docs/FIRST-RUN-CHECKLIST.md`.

## Assinatura

**Nao assinado na v1.** SmartScreen; conferir SHA-256. Nenhum passo de assinatura no
`electron-builder.yml`. Custo/processo futuro (OV/EV + timestamp) em `docs/SIGNING.md`.
**Nao implementar agora.**

## CI

**CI nao autorizada nesta task.** Nenhum workflow em `.github/`. Proposta (nao gravada) em
`docs/RELEASE.md` historico / relatorio; nao criar `.github/workflows/absolem-ci.yml` sem
autorizacao explicita do usuario.
