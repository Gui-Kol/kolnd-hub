# Absolem

Assistente de IA para Windows. Este pacote contém a fundação do app: Electron 28 +
electron-vite 2 + React 18 + TypeScript 5 + Tailwind 3, com os processos main,
preload, renderer e shared separados.

Nesta task ainda não existe nenhuma funcionalidade de assistente: sem bandeja, sem
overlay, sem avatar, sem Gemini, sem microfone e sem memória. O que já funciona:

- janela mínima com a identidade e a versão do app;
- store persistente com schema e migrações;
- logger com redação de segredos e rotação;
- crash reporting local (nada sai da máquina);
- instância única;
- contrato IPC tipado e preload via `contextBridge`;
- chave de API cifrada com `safeStorage` (ainda sem canal de escrita na UI).

## Requisitos

- Windows 10/11.
- Node.js >= 22 e npm >= 10.
- Nenhuma dependência nativa, nenhum serviço externo.

## Comandos

```bash
npm install          # instala as dependências
npm run dev          # electron-vite dev (abre a janela)
npm run build        # gera out/main, out/preload e out/renderer
npm run typecheck    # tsc nos projetos node e web
npm run lint         # ESLint flat config
npm run format:check # Prettier
npm test             # Vitest (ambiente node)
npm run verify       # typecheck + lint + format:check + test
npm run verify:build # verify + build
npm run package      # build + electron-builder --win (NSIS)
```

Para gerar apenas a pasta não instalada:

```bash
npx electron-builder --dir
```

O executável fica em `dist/win-unpacked/Absolem.exe`.

## Estrutura

```
src/main      processo principal (Node): janela, store, logger, crash, IPC
src/preload   ponte contextBridge (sandbox), sem lógica de negócio
src/renderer  React puro, sem acesso ao Node
src/shared    contrato IPC e tipos compartilhados
tests/e2e     reservado para Playwright (task 11)
resources     buildResources do electron-builder
```

## Dados locais

O Electron resolve o `userData` a partir do nome do pacote. Nesta máquina foi
observado:

- configuracao: `C:\Users\<usuario>\AppData\Roaming\absolem\config.json`
- logs: `C:\Users\<usuario>\AppData\Roaming\absolem\logs\absolem.log`
- crash dumps: `C:\Users\<usuario>\AppData\Roaming\absolem\Crashpad`
- chave cifrada: `C:\Users\<usuario>\AppData\Roaming\absolem\secrets.bin`

Desinstalar preserva esse diretório (`deleteAppDataOnUninstall: false`).

## Chave de API

A chave fica cifrada com `safeStorage` (DPAPI no Windows), em `secrets.bin`, fora
do `config.json`. Ela nunca vai para log e nunca atravessa o IPC nesta task.

O blob é amarrado ao usuário do Windows que o criou. Se a conta do Windows mudar,
se o perfil for restaurado em outra máquina ou a proteção de credenciais do Windows
ficar indisponível, a chave **precisa ser redigitada**. Não existe fallback para
texto plano: sem `safeStorage.isEncryptionAvailable()` a gravação é recusada.

## Acessibilidade do overlay

O overlay do avatar usa `focusable: false` e `showInactive()` para nunca roubar o
foco de um jogo, vídeo ou campo de texto. Consequência: ele **não recebe
navegação por teclado**. O caminho acessível é a tela de configurações (task 11),
que ajusta posição, tamanho e atalho; enquanto ela não existe, a bandeja e o
atalho global `Control+Alt+A` continuam funcionando sem exigir foco na janela.

## Privacidade

Nada sai da máquina: crash reporting local com `uploadToServer: false`, sem
telemetria, sem analytics e sem upload de diagnóstico. O log padrão redige
`api_key`, `token`, `password` e `authorization`.

## Gates

`npm run verify` é o gate único. `npm run verify:build` é obrigatório quando o
build, o empacotamento ou uma dependência de runtime muda. Testes de main/preload
usam Vitest em ambiente `node` com `electron` mockado; nada abre uma janela real.

## Licença

MIT. Veja `LICENSE`.
