# Licenças e cadeia de suprimentos

Documento da task 13 (T7). Registra as dependências diretas, as licenças, a
auditoria do `npm` e as pendências conhecidas. Data da auditoria: **2026-11-26**.
Ambiente: Windows x64, Node **26.13.1**, npm **11.20.0**, lockfile **v3**.

O `package-lock.json` é a fonte fixa das versões; `npm ci` recria
`node_modules` a partir dele. Nenhuma dependência nova foi adicionada nesta
task além de `@axe-core/playwright` (dev, autorizada na T9).

## 1. Dependências de runtime

| Pacote           | Versão  | Licença    | Uso no Absolem                          |
| ---------------- | ------- | ---------- | --------------------------------------- |
| `@google/genai`  | 3.6.1   | Apache-2.0 | SDK do Gemini (texto, grounding e Live) |
| `better-sqlite3` | 11.10.0 | MIT        | Banco local da memória e turnos         |
| `electron-store` | 8.2.0   | MIT        | `config.json` e migrações versionadas   |
| `linkedom`       | 0.18.15 | ISC        | Extração de HTML sem executar script    |
| `react`          | 18.3.1  | MIT        | UI do renderer                          |
| `react-dom`      | 18.3.1  | MIT        | UI do renderer                          |
| `three`          | 0.187.0 | MIT        | Avatar holográfico (WebGL)              |

## 2. Dependências de desenvolvimento principais

| Pacote                      | Versão      | Licença    | Uso                                       |
| --------------------------- | ----------- | ---------- | ----------------------------------------- |
| `electron`                  | 28.3.3      | MIT        | Runtime desktop                           |
| `electron-builder`          | 24.13.3     | MIT        | Build `win-unpacked` do Absolem           |
| `electron-vite`             | 2.3.0       | MIT        | Build main/preload/renderer               |
| `@playwright/test`          | 1.65.1      | Apache-2.0 | E2E do app empacotado                     |
| `@axe-core/playwright`      | 4.14.1 (T9) | MPL-2.0    | Auditoria de acessibilidade no Playwright |
| `vitest`                    | 2.1.9       | MIT        | Testes unitários e de integração          |
| `@vitest/coverage-v8`       | 2.1.9       | MIT        | Cobertura                                 |
| `typescript`                | 5.9.3       | Apache-2.0 | Tipagem                                   |
| `eslint`                    | 10.15.0     | MIT        | Lint                                      |
| `prettier`                  | 3.10.1      | MIT        | Formatação                                |
| `tailwindcss`               | 3.4.19      | MIT        | Estilo do renderer                        |
| `jsdom`                     | 25.0.1      | MIT        | Testes de UI em Node                      |
| `@vitejs/plugin-react`      | 4.7.0       | MIT        | JSX no build                              |
| `typescript-eslint`         | 8.74.0      | MIT        | Regras TS                                 |
| `eslint-plugin-jsx-a11y`    | 6.10.2      | MIT        | Regras de acessibilidade                  |
| `eslint-plugin-react-hooks` | 7.1.1       | MIT        | Regras de hooks                           |
| `eslint-config-prettier`    | 10.1.8      | MIT        | Compatibilidade de lint                   |
| `@eslint/js`                | 10.0.1      | MIT        | Config base do ESLint                     |
| `autoprefixer`              | 10.7.0      | MIT        | CSS                                       |
| `postcss`                   | 8.5.33      | MIT        | CSS                                       |
| `prebuild-install`          | 7.1.3       | MIT        | Baixa o prebuild do `better-sqlite3`      |
| `@types/react`              | 18.3.32     | MIT        | Tipos                                     |
| `@types/react-dom`          | 18.3.7      | MIT        | Tipos                                     |
| `@types/three`              | 0.187.0     | MIT        | Tipos                                     |

A única devDependency adicionada na task 13 é `@axe-core/playwright` (T9). A
justificativa é objetiva: a auditoria automática roda dentro do Playwright que
já existe, cobre todas as telas e falha no gate de acessibilidade; uma varredura
manual de regras WCAG não escala nem é repetível. Nenhuma dependência de
runtime foi adicionada.

## 3. Transitivas relevantes

| Pacote       | Licença      | Observação                                                                                 |
| ------------ | ------------ | ------------------------------------------------------------------------------------------ |
| `protobufjs` | BSD-3-Clause | Dependência do SDK Gemini; `postinstall` bloqueado pelo npm (só confere esquema de versão) |
| `tar`        | MIT          | Transitiva do `electron-builder`; ver auditoria abaixo                                     |
| `tinypool`   | MIT          | Transitiva do `vitest`; ver auditoria abaixo                                               |
| `minimatch`  | ISC          | Transitiva de ferramentas de teste/build                                                   |

## 4. Auditoria npm

Comando executado em 2026-11-26:

```powershell
npm audit --audit-level=high
```

Resultado real: **exit 1**, com **21 vulnerabilidades (9 moderate, 9 high, 3
critical)**. Todas estão em dependências de desenvolvimento ou transitivas de
ferramentas de build/teste:

- `tar` (<=7.5.20), via `electron-builder`: advisories de path traversal,
  symlink/hardlink e DoS. Corrigir exige `electron-builder@26` (breaking).
- `tinypool` (<=2.1.1), via `vitest`: prototype pollution/RCE no worker.
  Corrigir exige `vitest@5` (breaking).
- `minimatch` e `glob` transitivos de ferramentas de teste/build: advisories
  moderados.

Comando equivalente só para produção:

```powershell
npm audit --omit=dev --audit-level=high
```

Resultado real: **0 vulnerabilidades** em dependências de runtime.

Decisão: **não aplicar `npm audit fix --force`** nesta task. Isso trocaria
`electron-builder` e `vitest` por versões maiores, fora do escopo e sem
aprovação; a task proíbe dependência nova/alteração de stack sem decisão. As
vulnerabilidades ficam registradas como **pendência de manutenção** para uma
task futura de atualização controlada. Nenhuma delas é executada pelo app
instalado: `tar` e `tinypool` só rodam no build/teste.

## 5. Lockfile e instalação limpa

- `package-lock.json` está versionado e fixa as versões (`lockfileVersion: 3`).
- `npm ci` foi executado em 2026-11-26 e terminou com **exit 0**, recriando
  `node_modules` a partir do lockfile e rodando o `postinstall`.
- Observação de ambiente (não é dependência): no npm 11.20.0 desta máquina, o
  `npm ci` terminou com exit 0 mas não extraiu o binário do Electron
  (`node_modules/electron/path.txt` ausente). O `postinstall` do projeto cobre
  o SQLite, não o Electron. O app/e2e só roda depois de extrair o cache
  `electron-v28.3.3-win32-x64.zip` para `node_modules/electron/dist` e criar
  `path.txt`; isso foi feito manualmente após o `npm ci`. Registrar no CI/VM
  limpa: validar `node -e "require('electron')"` depois do `npm ci`.
- `npm ls --all` não reportou `extraneous`, `invalid` nem `missing` de
  dependência obrigatória. As linhas `UNMET OPTIONAL DEPENDENCY` são opcionais
  de plataforma (Rollup para outros sistemas, `fsevents` de macOS, etc.).
- Não há dependência direta sem uso comprovado: todas as sete de runtime são
  importadas pelo código; as de desenvolvimento aparecem em build, teste, lint,
  formatação, tipos ou empacotamento.

## 6. Scripts de instalação

- `postinstall` do projeto: `node scripts/postinstall-sqlite.cjs &&
electron-builder install-app-deps`.
  - `postinstall-sqlite.cjs` baixa o prebuild `electron-v119-win32-x64` do
    `better-sqlite3` via `prebuild-install` e grava o marcador de ABI. Não
    compila, não executa código de terceiro e falha de propósito se o binário
    não existir.
  - `electron-builder install-app-deps` reconstrói apenas o módulo nativo para
    a ABI do Electron.
- `allowScripts` em `package.json`: `electron: true`, `esbuild: true`,
  `better-sqlite3: false` (o binário vem do `prebuild-install`, não do script do
  pacote).
- `protobufjs` (transitiva do SDK) tem `postinstall` apenas para conferir o
  esquema de versão; o npm o deixou **não coberto** por `allowScripts` e o
  script não roda. Não há efeito funcional conhecido; registrar se uma próxima
  instalação passar a exigir.

## 7. CI

O workflow de CI **não foi criado nem alterado** nesta task: `.github/` está
fora do escopo autorizado (T5 da task 12 continua pendente). A validação de
cadeia de suprimentos acima é local (`npm ci`, `npm ls`, `npm audit`). Quando o
CI for autorizado, ele deve repetir estes três comandos e publicar o resultado
do audit como artefato, sem bloquear por vulnerabilidade apenas de dev até a
task de atualização.

## 8. Licença do projeto

O Absolem é distribuído sob **MIT** (`package.json`, campo `license` e arquivo
`LICENSE` da fundação). As licenças de terceiros acima são compatíveis com uso
proprietário/MIT; `@google/genai` e Playwright são Apache-2.0, `linkedom` é ISC,
`protobufjs` é BSD-3-Clause e `@axe-core/playwright` é MPL-2.0 (uso como
ferramenta de desenvolvimento, sem modificação).
