# Guia de release — Kolnd Hub

> **Status: EM REVISÃO DO USUÁRIO — NÃO é o processo oficial ainda.**
> Este documento foi redigido na tarefa 11-11.2 (13/11/2026) e cobre as etapas T1–T5.
> A etapa **T6 (revisão linha a linha com o usuário, para o checklist virar processo oficial) está PENDENTE — é decisão/ação exclusiva do usuário**. Enquanto isso não acontece, nenhum release deve ser executado como se este guia fosse o processo aprovado; ajustes de conteúdo são esperados.

Guia único e repetível do processo de release do Kolnd Hub, do bump de versão à publicação assinada com checksum. É a **fonte única** do processo: os READMEs (`README.md` na raiz e `kolnd-hub/README.md`) apenas linkam para cá — não duplicam o checklist.

Público-alvo: um mantenedor que **nunca** fez um release deste projeto. Siga as seções na ordem; cada passo tem critérios objetivos de sucesso/falha.

---

## Convenções e como usar este guia

- **Paths relativos** são sempre a partir da raiz do repositório (`C:\Users\TiffoDi\desenv\Kolnd Hub` na máquina de referência). `kolnd-hub/` é a pasta do app; a raiz contém `build-installer.bat`, `README.md` e este guia.
- **Caixas `- [ ]`**: marque `[x]` cada item ao executá-lo. Um release só é "go" quando todas as caixas obrigatórias estão marcadas (ver [Go / No-Go](#go--no-go)).
- **Comandos literais**: copie e cole. Onde houver placeholder `X.Y.Z`, substitua pela versão do release (ex.: `1.5.0`).
- **Decisão do usuário**: passos marcados como tal dependem de uma decisão explícita do dono do projeto (Kolnd). Não decida por ele — registre a dependência e pare.
- **Branch**: desenvolvimento na `Dev`; o `main` é estável e não recebe commits diretos (ver READMEs). Onde a branch de origem da tag de release é ambígua, o passo está marcado como decisão do usuário.
- PowerShell é o shell de referência no Windows; `cmd` é usado quando indicado (ex.: `.bat`).
- CI: todo push na `Dev` dispara `.github/workflows/ci.yml` (sem filtro de paths — docs também disparam) em `windows-latest`: `npm ci` → audit (informativo) → typecheck → lint → format:check → testes → build → `npm run package` com placeholder de `resources/programs/MarkLVI`.

## Pré-release técnico

Gate zero. **Nada** de release começa com este gate vermelho.

Todos os comandos abaixo rodam em `kolnd-hub/`:

```powershell
cd kolnd-hub
npm run verify        # == npm run typecheck && npm run lint && npm run format:check && npm test
npm run build         # electron-vite build (bundles em out/)
```

Ou em uma linha, na ordem exata exigida pelo processo:

```powershell
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Atalhos equivalentes já existentes no `package.json`:

- `npm run verify` — typecheck → lint → format:check → testes (gate único pré-commit);
- `npm run verify:build` — `verify` + `build` (gate completo antes de empacotar).

Checklist:

- [ ] `npm run verify:build` verde (equivale aos cinco comandos acima, na ordem).
- [ ] CI verde na `Dev` no commit que será liberado (aba Actions; o job empacota com placeholders e sobe `dist/Kolnd Hub Setup *.exe` como artifact por 7 dias).
- [ ] `npm audit --audit-level=high` executado e **revisado como informativo** (no CI ele é `continue-on-error: true` — não reprova o build). Cada high/critical encontrada vira item/issue próprio; **não** corrija no calor do release. Promover o step a bloqueante é decisão futura do usuário, só depois de zerar os highs atuais.
- [ ] `git status` limpo para os arquivos do release (nada inesperado; artefatos de build não são commitados — ver `.gitignore`: `dist/`, `out/`, `*.msi`, `*.exe`).

**Falha aqui = pare.** Não contorne gate vermelho com `--no-verify` nem desabilitando lint/format.

---

## Passo 1 — Bump de versão

Ordem obrigatória dos artefatos de versão. Fonte única da versão: **`version` em `kolnd-hub/package.json`** (referência em 15/11/2026: 1.4.0).

> Expectativa: o `CHANGELOG.md` da raiz acompanha o bump — a seção **[Não lançado]** vira a seção da versão nova (ver Passo 8 e "Como manter" no próprio arquivo). Toda mudança relevante deve entrar no changelog no commit/PR em que acontece.

### 1.1 `kolnd-hub/package.json` + `package-lock.json`

Forma recomendada (atualiza os dois de uma vez), em `kolnd-hub/`:

```powershell
cd kolnd-hub
npm version X.Y.Z --no-git-tag-version
```

Alternativa manual: editar `"version": "1.4.0"` em `kolnd-hub/package.json` e rodar `npm install --package-lock-only` para sincronizar o `"version"` do `kolnd-hub/package-lock.json`.

- [ ] `package.json` e `package-lock.json` com a mesma versão nova.

### 1.2 Rodapé da Sidebar — `kolnd-hub/src/renderer/src/components/Sidebar.tsx`

Desde a tarefa 02-2.5 (15/11/2026) o rodapé é **dinâmico**: renderiza `v{__APP_VERSION__} · Gamer Edition`, com `__APP_VERSION__` injetado via `define` no `electron.vite.config.ts` a partir do `version` do `package.json` (declarado em `src/renderer/src/env.d.ts`).

- [ ] Nada a atualizar no bump — a versão do rodapé acompanha `package.json` automaticamente. Apenas confirme que o define está presente no build (`__APP_VERSION__` substituído no bundle do renderer).
- [ ] **Decisão do usuário (item 2.5 / versionamento):** manter ou remover o sufixo `· Gamer Edition` — não decidido; registrar o que foi feito no release notes.

### 1.3 `build-installer.bat` (raiz)

Desde a tarefa 11-11.3 (concluída, commit `e7e9bf3b`) e a tarefa 02-2.5 (15/11/2026), o `.bat` **lê a versão de `kolnd-hub/package.json` em runtime** (`node -p "require('%HUB%/package.json').version"`) para exibir no resumo final — não há mais versão fixa no arquivo. Se o node falhar, o fallback é o genérico `*` (`Kolnd Hub Setup *.exe`), nunca uma versão velha.

- [ ] Nada a atualizar no `.bat` no bump — nenhuma versão literal permanece no fluxo. Se você encontrar outra versão literal, trate como bug da 02-2.5 e corrija citando a tarefa.

### 1.4 READMEs que citam a versão

Desde a tarefa 02-2.5 (15/11/2026), o `README.md` (raiz) cita o instalador como `Kolnd Hub Setup <versao>.exe` (placeholder) e aponta para `version` em `kolnd-hub/package.json` — não há versão literal nos dois lugares ("Instalação para o usuário final" e "Build do instalador").

- [ ] Nada a atualizar nos READMEs no bump — o placeholder é proposital. Só ajeitar se a política de nomenclatura mudar.
- [ ] `kolnd-hub/README.md`: hoje **não** cita o nome do instalador com versão. As menções a `'1.4.0'` que existem lá referem-se à **migração do schema do electron-store** — não são a versão do produto e **não** devem ser tocadas neste passo (ver 1.5).

### 1.5 `store.ts` / migração — só se o schema mudar

- [ ] Se (e somente se) o schema do `electron-store` mudou: adicionar a nova chave de migração em `kolnd-hub/src/main/store.ts` (`migrations: { ... }`) com a **mesma versão do produto** (ex.: `'1.5.0'`), atualizar o schema e os defaults, e **adicionar/ajustar os testes da cadeia de migrações** em `kolnd-hub/src/main/store.test.ts` (cadeia `1.0.0 → …`). Mudança de schema sem migração = dados de usuário corrompidos na atualização — é bloqueante.
- [ ] Se o schema não mudou: nada a fazer. Confirme apenas que `npm run verify` (pré-release técnico) continua verde.

### 1.6 `electron-builder.yml`

Desde a tarefa 02-2.5 (15/11/2026), `win.artifactName` está definido explicitamente como `Kolnd Hub Setup ${version}.exe` (macro resolvida a partir do `package.json`; o default do electron-builder 24.x já era esse padrão, aqui fixado para não depender de default). Não há versão literal no arquivo.

- [ ] Nada a fazer no bump — a macro `${version}` resolve a partir de `package.json`. Se uma versão literal for adicionada no futuro, ela entra nesta lista.

### 1.7 Varredura final por versões antigas

```powershell
git grep -n "1.4.0" -- README.md kolnd-hub/README.md kolnd-hub/src build-installer.bat kolnd-hub/electron-builder.yml
```

(substitua `1.4.0` pela versão anterior à do release)

- [ ] Nenhuma ocorrência da versão antiga fora de: lock files, `store.ts`/`store.test.ts` (migrações — intencionais), e `gerente/` (registro interno — não entra no commit de release).
- [ ] `npm run verify` verde após o bump (o bump de versão pode quebrar teste que afirme `version`).

**Falha:** qualquer artefato acima com versão antiga = release não pode prosseguir. **Sucesso:** `git diff` mostra apenas os pontos 1.1–1.7.

---

## Passo 2 — Teste em máquina limpa (VM/Sandbox)

> **Pendência registrada (item 2.2 do relatório):** a validação completa em máquina limpa **nunca foi executada**. O roteiro abaixo a formaliza. Executá-lo (ou aceitá-lo explicitamente como risco) é condição de go/no-go — ver [Go / No-Go](#go--no-go). Não marque o item como concluído sem ter executado de fato, e registre o resultado (data, VM, resultado por cenário) nas release notes ou na task 2.2.

**Ordem prática:** esta seção vem antes dos Passos 3–4 por exigência do processo, mas a **execução** usa o instalador produzido no Passo 4 e o MSI do Passo 3. Fluxo real: (a) prepare a VM e o snapshot **antes** do Passo 3; (b) depois do Passo 4, copie os artefatos para a VM e execute o roteiro de ponta a ponta; (c) registre os resultados.

### 2.1 Preparação do ambiente

- [ ] VM Windows 10/11 limpa (Hyper-V ou Windows Sandbox) **sem** Python, **sem** Kloud Games, **sem** Kolnd Hub, **sem** MSYS2. Snapshot/checkpoint tirado **antes** de qualquer instalação.
- [ ] Conta de usuário **padrão (sem admin)** criada na VM — é a conta do teste.
- [ ] Rede do teste: primeiro em rede simples (NAT); depois, se houver, atrás de **proxy corporativa** (cenário à parte — ver 2.4).
- [ ] Artefatos copiados para dentro da VM (pasta compartilhada ou mídia ISO): `Kolnd Hub Setup X.Y.Z.exe` e, opcionalmente, `KLOUD_GAMES.msi` separado.

### 2.2 Roteiro de instalação (na VM, como usuário sem admin)

1. [ ] Executar `Kolnd Hub Setup X.Y.Z.exe` → a instalação deve ser **per-user, sem prompt de UAC**, em `%LOCALAPPDATA%\Programs\Kolnd Hub`. Critério de falha: pedir admin ou falhar por permissão.
2. [ ] Abrir o Hub pela primeira vez → a tela de instalação com as etapas (Verificação de dependências → Python → Kloud Games → Programas → Finalização) aparece.
3. [ ] **Python via winget** (apenas se ausente): aceitar o UAC; ao final, `python --version` funciona em terminal novo. Critério de falha: winget falha silenciosamente ou o passo trava — registrar saída.
4. [ ] **Kloud Games via MSI embutido**: aceitar o UAC; validar depois: pasta `C:\Program Files\KLOUD_GAMES` existe; serviço `KLOUD_GAMESsvc` rodando (`services.msc`); regras de firewall criadas (`wf.msc`); autostart configurado. Critérios de falha: `msiexec` retorna código ≠ 0/3010/1641; serviço ausente. (Códigos **3010** e **1641** = reinício necessário — sucesso com aviso, não erro.)
5. [ ] **Programas + Finalização**: Mark LVI implantado em `<instalação>\resources\programs\MarkLVI`; flag criada em `%APPDATA%\kolnd-hub\first-run-complete.flag`; `config.json` presente em `%APPDATA%\kolnd-hub\`.
6. [ ] Segunda abertura do app → vai direto para o dashboard (sem a tela de instalação).
7. [ ] Fechar/reabrir uma vez e confirmar que nada pede UAC de novo (o MSI já está instalado).

### 2.3 Cenários de falha UAC (obrigatórios)

- [ ] **UAC negado no Kloud Games**: negar o prompt → o Hub **não** pode travar; deve registrar a falha e seguir (Kloud Games é opcional no primeiro uso). Confirmar que `<instalação>\resources\programs\kloud-games\KLOUD_GAMES.msi` permanece disponível para instalação manual posterior (`msiexec /i "<caminho>\KLOUD_GAMES.msi"` como administrador).
- [ ] **UAC negado no Python** (com Python ausente): negar → o Mark LVI fica inutilizável até o Python ser instalado, mas o Hub abre normalmente. Registrar comportamento observado.
- [ ] **Conta sem admin + política restritiva** (AppLocker / bloqueio de `powershell.exe -Verb RunAs`, se disponível na VM): o MSI pode não instalar na primeira execução — o Hub deve reportar o erro, e a saída documentada é instalar o MSI manualmente como administrador. Registrar resultado ou marcar como "não testado" explicitamente.

### 2.4 Rede com proxy (se aplicável)

- [ ] Testar winget atrás de proxy (ele usa as configurações de proxy do sistema/WinHTTP). Registrar: funcionou / falhou com a mensagem X / não testado (pendência 2.2 permanece aberta).

### 2.5 Registro do resultado

- [ ] Resultado por cenário registrado em algum lugar durável (task 2.2 no `gerente/tasks/2.0/`, release notes, ou issue), com: data, versão testada, configuração da VM, o que passou e o que falhou.
- [ ] Qualquer cenário falho = **no-go** (ou aceitação explícita e escrita do risco pelo usuário no go/no-go final).

---

## Passo 3 — Build do MSI do Kloud Games

Gera `kolnd-hub\resources\programs\kloud-games\KLOUD_GAMES.msi` (~53 MB), que é embutido no instalador do Hub.

Caminho completo (recomendado — compila o MSI **e** empacota o Hub):

```bat
build-installer.bat
```

(na raiz do repositório; CMD. O `.bat` garante Node no PATH, instala pré-requisitos via `winget` — Git, MSYS2 em `C:\msys64`, .NET SDK 8 — e chama o passo abaixo, depois `npm run package`.)

Só o MSI (PowerShell, ~30–60 min, MSYS2 UCRT64):

```powershell
powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-kloud-games.ps1
# opções: -SkipSubmodules (não mexe nos submódulos) · -SkipDeps (não atualiza deps do MSYS2)
```

O script cuida de: renomeações idempotentes do snapshot, submódulos (incluindo aninhados e o patch `scripts/patches/moonlight-stdatomic-guards.patch`), dependências ucrt64, `cmake + ninja` com gcc, `cpack -G WIX` e a cópia do MSI para `kolnd-hub\resources\programs\kloud-games\`.

- [ ] Build terminou sem erro (o `.bat` aborta com `[ERRO]` se o MSI falhar).
- [ ] MSI gerado/atualizado em `kolnd-hub\resources\programs\kloud-games\KLOUD_GAMES.msi` (conferir timestamp — deve ser de hoje).
- [ ] O MSI **não** foi commitado (`.gitignore` cobre `*.msi`; `resources/` não vai para o git).
- [ ] (Opcional) Mark LVI reconstruído antes do pacote: `powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-mark-lvi.ps1` — ou tudo de uma vez: `scripts\build-all.ps1` (`-SkipMarkLvi`, `-SkipKloudGames`, `-SkipPackage`).

**Falha:** MSI ausente ou com timestamp antigo = o instalador do Passo 4 sairia com o programa defasado. Pare e investigue.

---

## Passo 4 — `npm run package` (instalador NSIS do Hub)

Em `kolnd-hub/`:

```powershell
cd kolnd-hub
npm install
npm run package    # electron-vite build && electron-builder --win
```

O electron-builder (`electron-builder.yml`, alvo `nsis`, per-user, `oneClick: false`, `allowToChangeInstallationDirectory: false`, `deleteAppDataOnUninstall: false`) gera:

```
kolnd-hub\dist\Kolnd Hub Setup X.Y.Z.exe    (~360 MB)
```

- [ ] Arquivo gerado com a **versão certa** no nome (`Kolnd Hub Setup X.Y.Z.exe`) — conferir `kolnd-hub\dist\`.
- [ ] `resources/programs/MarkLVI` presente no pacote (o `extraResources` **falha o build** se a pasta não existir — em CI um placeholder é usado; localmente ela é produzida por `scripts/build-mark-lvi.ps1` e **não é commitada**).
- [ ] Segredos ausentes do pacote: `config/api_keys.json`, `config/certs/`, `config/whatsapp_web/`, `memory/` ficam fora pelo `filter` do `electron-builder.yml`. (Conferir o `.yml` se o empacotamento mudou.)
- [ ] Após rodar build de qualquer programa (MSI ou Mark LVI), rodar `npm run package` **de novo** para o instalador pegar a versão nova.

**Falha:** nome do `.exe` com versão errada = bump incompleto (Passo 1). Build quebrando por `extraResources` = Mark LVI não foi reconstruído/preparado.

> Depois deste passo, volte ao **Passo 2** e execute o roteiro de máquina limpa com o instalador recém-gerado. Só prossiga ao Passo 5 com o Passo 2 registrado.

---

## Passo 5 — Verificar desinstalação (preserva `%APPDATA%\kolnd-hub`)

> **Contexto factual (não contradizer):** o desinstalador NSIS tem `deleteAppDataOnUninstall: false` — `%APPDATA%\kolnd-hub` **inteiro é preservado**; o diretório de instalação (`%LOCALAPPDATA%\Programs\Kolnd Hub`) é **sempre removido**, **incluindo `resources\programs\MarkLVI`**, com os dados que a build atual do `MarkLVI.exe` grava ao lado do executável (`config\api_keys.json`, `memory\`). O que o Hub espelha (semear, sem apagar) em `%APPDATA%\kolnd-hub\mark-lvi` sobrevive; subpastas (`config\certs\`, `config\whatsapp_web\`) nunca são espelhadas. A opção irreversível "Apagar também meus dados e configurações" do botão do Hub é a única coisa que apaga `%APPDATA%\kolnd-hub`.

Roteiro de verificação (na **mesma VM limpa** do Passo 2, com o release instalado e a primeira execução concluída):

1. [ ] Confirmar que `%APPDATA%\kolnd-hub` está populado: `config.json`, `first-run-complete.flag`, `logs\kolnd-hub.log`, `kloud-games.paths.json` e — se houver — `mark-lvi\` e `game-icons\`.
2. [ ] Desinstalar pela "Zona de perigo" do Hub (**Configurações → fim da página → "Desinstalar Kolnd Hub"**, pede digitar `Kolnd Hub`; só funciona no app empacotado) **ou** pelo Windows (**Configurações → Aplicativos → Kolnd Hub**). Ambos equivalem. Códigos `msiexec` 3010/1641 = sucesso com aviso de reinício.
3. [ ] **Confirmar preservados** (`%APPDATA%\kolnd-hub`): `config.json`, `first-run-complete.flag`, `logs\kolnd-hub.log` e o que mais existia (`mark-lvi\`, `kloud-games.paths.json`, `game-icons\`).
4. [ ] **Confirmar removido** (`%LOCALAPPDATA%\Programs\Kolnd Hub`): pasta inteira, **incluindo `resources\programs\MarkLVI\`**.
5. [ ] **Registrar** (na release notes ou na task 2.2): "desinstalação verificada preservando %APPDATA%\kolnd-hub; `resources/programs/MarkLVI` apagado junto com a instalação (esperado na build atual do Mark LVI); chave de API/memória migradas sobrevivem no espelho `%APPDATA%\kolnd-hub\mark-lvi`; subpastas não espelhadas".
6. [ ] (Opcional, recomendado) Reinstalar o mesmo release e confirmar que o Hub abre direto no dashboard com as configurações preservadas (prova de ida e volta).
7. [ ] Backup manual pré-desinstalação (vale para usuários reais e para o teste): botão **"Fazer backup dos meus dados"** copia `%APPDATA%\kolnd-hub` para `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss` (nunca sobrescreve). Não cobre dados ao lado do `MarkLVI.exe`.

Critérios de falha: qualquer item de `%APPDATA%\kolnd-hub` apagado pelo desinstalador = **no-go** (regressão grave). `%LOCALAPPDATA%\Programs\Kolnd Hub` remanescente = investigar permissões/processo aberto.

---

## Passo 6 — Assinar o código

> **DECISÃO DO USUÁRIO (item 2.4 do relatório) — PENDENTE. Não decida por ele.**

Estado atual:

- O CI e o `electron-builder.yml` **não assinam** nada. Não existe certificado configurado no repositório.
- Sem assinatura, o SmartScreen **provavelmente** exibirá "aplicativo não reconhecido" na instalação do `.exe` (e heurísticas de antivírus tendem a sinalizar um `.exe` único que dispara outros instaladores, comportamento típico de dropper).
- Decisões em aberto (todas do usuário):
  - certificado **OV vs. EV** (EV reduz a fricção inicial do SmartScreen; OV constrói reputação);
  - **Azure Trusted Signing** (nuvem, sem token USB/HSM) vs. certificado tradicional;
  - o que assinar: instalador do Hub (`Kolnd Hub Setup X.Y.Z.exe`), o `KLOUD_GAMES.msi` (WiX), ou ambos — e quando (o pipeline de MSI/NSIS muda com a decisão).
- Custo/prazo/fornecedor: decisão à parte do usuário.

Checklist do passo (pré-decisão):

- [ ] Registrar na release notes que o release **não está assinado** e que o SmartScreen pode alertar (risco assumido conscientemente).
- [ ] Registrar na release notes o SHA-256 publicado (Passo 7) para conferência manual — mitigação parcial.

Checklist do passo (pós-decisão — executar só quando o usuário decidir):

- [ ] Certificado/Trusted Signing configurado no ambiente de release **fora do git** (segredos nunca commitados).
- [ ] Assinatura aplicada **antes** do Passo 7 (o checksum publicado deve ser do artefato assinado).
- [ ] Assinatura verificada: `Get-AuthenticodeSignature "Kolnd Hub Setup X.Y.Z.exe"` → `Status: Valid` (e, se aplicável, o mesmo para o `.msi`).

**Se o usuário ainda não decidiu na hora do release:** o release pode sair **sem assinatura** apenas com aceitação explícita do risco (registrada) no go/no-go — ver [Go / No-Go](#go--no-go). Não improvise uma solução de assinatura por conta própria.

---

## Passo 7 — Publicar + checksum SHA-256

Formato assumido (padrão de fato do projeto, pendente de confirmação do usuário): **GitHub Release com tag `vX.Y.Z` + arquivo de checksums SHA-256 anexado**.

> **Decisões do usuário em aberto:** (a) formato público de release — GitHub Release + checksums vs. outro (decisão nº 15 do relatório); distribuição pública vs. privada; (b) branch de origem da tag (`main` após merge da `Dev` — provável — vs. tag direto na `Dev`); (c) desenho completo de publicação/checksums é coberto em parte pelo item **2.7** do relatório — **referenciar, não duplicar nem decidir**; este passo assume o cenário mais simples.

### 7.1 Pré-requisitos

- [ ] Passos 1–6 (ou exceções aceitas por escrito) concluídos.
- [ ] Artefatos finais e **assinados (se decidido)** em mãos:
  - `kolnd-hub\dist\Kolnd Hub Setup X.Y.Z.exe`
  - `kolnd-hub\resources\programs\kloud-games\KLOUD_GAMES.msi`
- [ ] `gh` autenticado (nesta máquina: `"$env:ProgramFiles\GitHub CLI\gh.exe"`; em outros ambientes, `gh` no PATH). Repositório: `github.com/Gui-Kol/kolnd-hub` (público).

### 7.2 Gerar os checksums

```powershell
Get-FileHash -Algorithm SHA256 "kolnd-hub\dist\Kolnd Hub Setup X.Y.Z.exe" |
  ForEach-Object { "$($_.Hash.ToLower())  Kolnd Hub Setup X.Y.Z.exe" } |
  Out-File -Encoding ascii SHA256SUMS.txt
Get-FileHash -Algorithm SHA256 "kolnd-hub\resources\programs\kloud-games\KLOUD_GAMES.msi" |
  ForEach-Object { "$($_.Hash.ToLower())  KLOUD_GAMES.msi" } |
  Out-File -Append -Encoding ascii SHA256SUMS.txt
Get-Content SHA256SUMS.txt   # conferência visual
```

- [ ] `SHA256SUMS.txt` criado com as duas linhas e conferido.

### 7.3 Tag e publicação

```powershell
# tag no commit que está sendo liberado (branch: DECISÃO DO USUÁRIO — ver acima)
git tag -a vX.Y.Z -m "Kolnd Hub vX.Y.Z"
git push origin vX.Y.Z

# publicar a release com os artefatos (release-notes.md do Passo 8)
gh release create vX.Y.Z `
  "kolnd-hub\dist\Kolnd Hub Setup X.Y.Z.exe" `
  "kolnd-hub\resources\programs\kloud-games\KLOUD_GAMES.msi" `
  "SHA256SUMS.txt" `
  --title "Kolnd Hub vX.Y.Z" --notes-file release-notes.md
```

- [ ] Release criada em `https://github.com/Gui-Kol/kolnd-hub/releases/tag/vX.Y.Z` com os três anexos.
- [ ] Conferência pós-publicação: baixar o `.exe` pela página da release em outra máquina/VM e conferir o hash contra `SHA256SUMS.txt` (`Get-FileHash -Algorithm SHA256 <arquivo-baixado>`). Hash divergente = **no-go/rollback imediato**.
- [ ] `SHA256SUMS.txt` e `release-notes.md` são arquivos de trabalho — não commitar (ou apagá-los do diretório de trabalho depois).

---

## Passo 8 — Release notes

As notas do release partem do **`CHANGELOG.md`** (na raiz). A tarefa **11-11.4** criou o arquivo em 15/11/2026 (Keep a Changelog + SemVer, pt-BR); **a revisão do usuário (T4) ainda está pendente** — até lá, trate o conteúdo como rascunho fiel ao git, sujeito à aprovação do usuário.

Monte as notas copiando a seção da versão de `CHANGELOG.md` e completando o obrigatório abaixo. Se uma seção da versão estiver incompleta, complemente a partir do `git log --oneline --no-merges <anterior>..HEAD`:

Conteúdo obrigatório das notas:

- [ ] Versão, data e resumo (2–4 linhas) do que mudou.
- [ ] Destaques/notas por área (Hub, Kloud Games/MSI, Mark LVI, build/CI) a partir dos commits.
- [ ] **Bloco "Desinstalação e seus dados"** (sempre presente): `%APPDATA%\kolnd-hub` é preservado por padrão; o diretório de instalação é removido, **incluindo `resources\programs\MarkLVI`** e os dados ao lado do `MarkLVI.exe` ainda não espelhados; o espelho `%APPDATA%\kolnd-hub\mark-lvi\` sobrevive; subpastas (`certs\`, `whatsapp_web\`) não são espelhadas. (Texto de referência: seções "Desinstalação" do `README.md` raiz e do `kolnd-hub/README.md`.)
- [ ] **Riscos e pendências conhecidas**: assinatura pendente (2.4) / SmartScreen provável; máquina limpa executada ou pendente (2.2) com o resultado registrado; migração de schema (se houve) e o que ela faz.
- [ ] SHA-256 dos artefatos (ou referência ao `SHA256SUMS.txt` anexado).
- [ ] Instruções mínimas de atualização (instalar o novo por cima? desinstalar antes? — hoje: instalar por cima, que é o comportamento suportado pelo NSIS per-user).
- [ ] O `CHANGELOG.md` na raiz está atualizado: a seção **[Não lançado]** foi movida para `## [X.Y.Z] - AAAA-MM-DD` e a seção vazia foi recriada no topo (ver "Como manter" no próprio arquivo). Toda mudança relevante entra no changelog no commit/PR em que acontece, não no dia do release.

---

## Rollback — desfazer/republicar um release quebrado

Princípio: **nunca reutilize um número de versão já publicado** (artefatos em cache, checksums e notas divergem). Correção = nova versão `X.Y.Z+1`.

Se o problema for detectado **antes** da publicação (passos 1–7):

- [ ] Parar no passo com defeito; corrigir; refazer o passo e os seguintes (o checksum sempre reflete o artefato final).

Se o release **já foi publicado** e está quebrado:

1. **Contenção imediata**
   - [ ] Editar a release para avisar: `gh release edit vX.Y.Z --notes-file release-notes-com-aviso.md` (adicionar no topo: "⚠️ release quebrada — não instalar; correção em vX.Y.Z+1"). Se grave, `gh release edit vX.Y.Z --prerelease` para despriorizar na listagem.
2. **Remoção (opcional, só se o artefato for ativamente perigoso)**
   - [ ] `gh release delete vX.Y.Z --yes` e apagar a tag: `git tag -d vX.Y.Z` local e `git push origin :refs/tags/vX.Y.Z` remota. Registrar na release notes da correção que a versão anterior foi yanked.
3. **Correção e republicação**
   - [ ] Corrigir na `Dev` (`git revert` do commit causador ou fix forward — **nunca** `git push --force` em `main`/`Dev`).
   - [ ] Novo bump `X.Y.Z+1` (Passo 1) e repetir os Passos 2–8.
4. **Dados do usuário**
   - [ ] Se a versão quebrada corrompeu/apagou dados: orientar os usuários afetados a restaurar `%APPDATA%\kolnd-hub` a partir de `Documentos\KolndHub-Backup-AAAAMMDD-HHmmss` (se fizeram backup) e/ou do espelho `mark-lvi\`. A desinstalação preserva `%APPDATA%\kolnd-hub` — a recuperação quase sempre é possível.
5. **Pós-mortem curto**
   - [ ] Registrar: o que quebrou, por que o checklist não pegou, qual passo deste guia muda. Atualizar este guia (e a 11.4/2.7 quando existirem) com a lição aprendida.

Artefatos do CI (`kolnd-hub-setup`) ficam disponíveis por **7 dias** após o run — podem resgatar um binário bom para diagnóstico.

---

## Go / No-Go

**Quem aprova:** o **dono do projeto (Kolnd / usuário)**. O mantenedor que executa o release **não pode aprovar o próprio release**; na dúvida, é no-go até o usuário decidir. (Registrado como decisão do usuário; este guia não delega essa autoridade a ninguém.)

**Com base em quê** — tabela de decisão:

| Critério                                                                   | Obrigatório?                          | Fonte                       |
| -------------------------------------------------------------------------- | ------------------------------------- | --------------------------- |
| Pré-release técnico verde (`verify:build` + CI na `Dev`)                   | Sim — sem exceção                     | Passo "Pré-release técnico" |
| Bump completo e consistente (sem versão antiga vazando)                    | Sim                                   | Passo 1                     |
| Máquina limpa executada **ou** risco aceito por escrito pelo usuário (2.2) | Sim (execução ou aceitação explícita) | Passo 2                     |
| MSI do Kloud Games e instalador NSIS com versão correta                    | Sim                                   | Passos 3–4                  |
| Desinstalação verificada preservando `%APPDATA%\kolnd-hub`                 | Sim                                   | Passo 5                     |
| Assinatura (2.4) **ou** risco SmartScreen aceito por escrito pelo usuário  | Sim (uma das duas)                    | Passo 6                     |
| Checksums SHA-256 publicados e conferidos pós-download                     | Sim                                   | Passo 7                     |
| Release notes publicadas (com pendências e riscos declarados)              | Sim                                   | Passo 8                     |
| Rollback entendido e aplicável                                             | Sim (ciência do aprovador)            | Seção Rollback              |

**Regras:**

- Um único critério obrigatório não atendido (e não aceito por escrito pelo usuário) = **no-go**.
- "Aceito por escrito" = o usuário declarar a exceção no canal do release (ex.: release notes + mensagem registrada na task/PR), citando o risco. Silêncio não é aceitação.
- Após o go: acompanhar a release por alguns dias (issues, downloads, SmartScreen reports) e registrar no retro do próximo release.

---

## Pendências e decisões do usuário (cross-links)

Este guia **não decide** por nenhum destes itens — apenas os referencia:

| Item        | O quê                                                         | Dono                         | Estado                                                            |
| ----------- | ------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| 2.1         | Auto-update do app                                            | Usuário                      | Fora de escopo (tarefa própria)                                   |
| 2.2         | Validação em máquina limpa (roteiro no Passo 2)               | Usuário/execução             | **Pendente — nunca executada**                                    |
| 2.4         | Assinatura de código (OV/EV vs. Azure Trusted Signing)        | **Usuário — decisão**        | Pendente; release sai com risco SmartScreen se aceito por escrito |
| 2.5         | Versionamento/rodapé "Gamer Edition" (rodapé agora dinâmico via `__APP_VERSION__`) | Feito (02-2.5, 15/11/2026)  | Versão unificada no `package.json`; sufixo "Gamer Edition" permanece (decisão do usuário)     |
| 2.6         | Desinstalação preserva `%APPDATA%\kolnd-hub`                  | Feito                        | Documentado nos READMEs e na `electron-builder.yml`               |
| 2.7         | Checksums / formato de publicação                             | Usuário — decisão (em parte) | Passo 7 assume GitHub Release + SHA-256                           |
| 2.7 / nº 15 | Formato de release público                                    | **Usuário — decisão**        | Passo 7 assume GitHub Release; confirmar                          |
| 03-3.x      | CI (audit/CodeQL informativos)                                | Feito (runs verdes)          | Docs-only também dispara CI                                       |
| 11-11.3     | `build-installer.bat` lê versão do `package.json`             | Feito (`e7e9bf3b`)           | Passo 1.3                                                         |
| 11-11.4     | `CHANGELOG.md`                                                | Criado (15/11/2026); **revisão do usuário (T4) pendente** | Passo 8 referencia a seção da versão a copiar           |
| 11-11.5     | NOTICE no instalador (conformidade de licenças)               | Pendente                     | Candidato a entrar no release que o incluir                       |
| 01-1.9      | Rebuild Mark LVI com `MARK_LVI_HOME`                          | Pendente                     | Enquanto não sai, vale a regra da build atual no Passo 5          |

Itens exigem decisão/ação do **usuário**; nada aqui substitui essa decisão.

---

## Fontes e histórico

- Fontes de verdade usadas na redação (13/11/2026): `README.md` raiz (instalação, desinstalação, build, segurança), `kolnd-hub/README.md` (comandos, CI, desinstalação, primeira execução), `kolnd-hub/package.json` (scripts e versão 1.4.0), `kolnd-hub/electron-builder.yml` (NSIS per-user, `deleteAppDataOnUninstall: false`), `kolnd-hub/src/main/store.ts` (schema + migrações), `build-installer.bat` e `kolnd-hub/scripts/build-kloud-games.ps1` e `build-all.ps1`, `.github/workflows/ci.yml`.
- Este guia substitui, como **fonte única**, os recortes de processo que viviam nos READMEs ("Checklist de release: verificação da desinstalação" no README raiz; links em `build` nos dois READMEs).
- **13/11/2026** — criação (tarefa 11-11.2, T1–T5). **T6 (revisão linha a linha com o usuário) pendente.** Documento **não é o processo oficial** até o T6.
