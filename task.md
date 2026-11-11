# task.md — Kolnd Hub: .exe único com instalação automática na primeira execução

**Objetivo:** Gerar um único instalador `.exe` do Kolnd Hub que, na primeira vez que o usuário abre o app, rode automaticamente um script que instala/configura **todos os 3 programas** do ecossistema sem intervenção manual.

**Programas gerenciados pelo Hub (conforme README atual):**

| Programa | Comando padrão | Dependências |
|----------|---------------|--------------|
| Mark LVI / JARVIS | `py main.py` | Python 3.x + `requirements.txt` |
| Playnite | `Playnite.DesktopApp.exe` | Playnite instalado em `%LOCALAPPDATA%\Playnite` |
| Kloud Games | `kloud-games.exe` | Executável local do Kloud Games |

> **Nota:** O `README.md` original listava 5 programas (incluindo DeepSeek Harness e SteamGridDB Manager), mas a tabela atual mostra apenas 3. Se você adicionar programas novamente no futuro, atualize este `task.md` e as tarefas correspondentes.

---

## Estrutura das tarefas

Cada tarefa abaixo tem um ID, título, descrição, status e entregável esperado. Use isso como checklist de implementação.

---

### Fase 1 — Análise e preparação do ambiente

#### T-01: Auditar o projeto atual
- **Status:** Pendente
- **Descrição:** Revisar `kolnd-hub/package.json`, `electron-builder.yml`, `electron.vite.config.ts` e o código-fonte em `src/main/` para entender como os processos são lançados e como o build é gerado. Confirmar que o renderer salva configurações em `localStorage`.
- **Entregável:** Lista de arquivos que precisam ser modificados e confirmação de que `electron-builder` está funcionando (`npm run package` gera `dist/Kolnd Hub Setup 1.0.0.exe`).

#### T-02: Decidir estratégia de empacotamento dos 3 programas
- **Status:** Pendente
- **Descrição:** Escolher se os 3 programas (e seus pré-requisitos: Python, Playnite) serão:
  - **A)** Embutidos fisicamente dentro do `.exe` (instalador gigante, funciona offline).
  - **B)** Baixados sob demanda na primeira execução (instalador leve, requer internet).
  - **C)** Híbrida: bootstrapper leve + downloads opcionais.
- **Entregável:** Decisão documentada e impacto no tamanho do instalador estimado.

---

### Fase 2 — Detecção de primeira execução

#### T-03: Criar mecanismo de flag de primeira execução
- **Status:** Pendente
- **Descrição:** No processo principal do Electron (`src/main/index.ts`), verificar ao iniciar se existe um marcador (ex: arquivo `installed.flag` em `app.getPath('userData')` ou chave no `localStorage`).
- **Entregável:** Função `isFirstRun()` que retorna `true` se for a primeira abertura.

#### T-04: Criar tela de instalação (First Run UI)
- **Status:** Pendente
- **Descrição:** Criar página React (ex: `src/renderer/pages/FirstRunInstall.tsx`) com barra de progresso, lista de etapas e log em tempo real. Ela substitui o dashboard enquanto a instalação está rodando.
- **Entregável:** Componente de UI exibindo etapas como "Verificando dependências…", "Instalando Python…", "Configurando Playnite…", etc.

#### T-05: Conectar main process com a tela de instalação via IPC
- **Status:** Pendente
- **Descrição:** Expor canais IPC (`firstRun:start`, `firstRun:stepComplete`, `firstRun:log`) para que o main process avise o renderer sobre o progresso e o renderer possa solicitar a próxima etapa.
- **Entregável:** Comunicação bidirecional funcionando entre `src/main/` e o renderer durante a instalação.

---

### Fase 3 — Script de instalação automática (bootstrap)

#### T-06: Criar verificador de dependências do sistema
- **Status:** Pendente
- **Descrição:** Módulo `src/main/dependencyChecker.ts` que verifica se estão instalados e disponíveis no PATH:
  - Python 3.x + pip
  - Playnite (verificar diretório `%LOCALAPPDATA%\Playnite`)
- **Entregável:** Relatório booleano de quais dependências faltam.

#### T-07: Criar instalador silencioso de pré-requisitos
- **Status:** Pendente
- **Descrição:** Módulo `src/main/silentInstaller.ts` que roda instaladores MSI/EXE silenciosamente (ex: `winget`, `/quiet`, `/S`), solicitando elevação de privilégio (UAC) quando necessário.
- **Entregável:** Instalação silenciosa de Python e Playnite sem intervenção do usuário.

#### T-08: Implementar implantação dos 3 programas
- **Status:** Pendente
- **Descrição:** Para cada programa, o script deve:
  1. Copiar/extrair os arquivos do programa para uma subpasta da instalação do Hub (ex: `resources/programs/<nome>/`).
  2. Rodar comandos de instalação específicos (`pip install -r requirements.txt` para Mark LVI, etc.).
  3. Verificar se o executável principal existe após a instalação.
- **Entregável:** Todos os 3 programas instalados e funcionando dentro da estrutura do Hub.

#### T-09: Configurar automaticamente os comandos no Hub
- **Status:** Pendente
- **Descrição:** Após instalar cada programa, preencher automaticamente os campos de Configurações do Kolnd Hub (comando padrão e diretório de trabalho) e salvar no `localStorage`.
- **Entregável:** `localStorage` populado com caminhos e comandos corretos para os 3 programas.

#### T-10: Criar marcador de instalação concluída
- **Status:** Pendente
- **Descrição:** Ao finalizar com sucesso, criar o arquivo `installed.flag` (ou equivalente) para que na próxima abertura o app vá direto para o dashboard.
- **Entregável:** Flag escrita; segunda execução pula a tela de instalação.

---

### Fase 4 — Build e empacotamento (.exe)

#### T-11: Ajustar electron-builder.yml para incluir recursos extras
- **Status:** Pendente
- **Descrição:** Adicionar ao `electron-builder.yml` os arquivos dos instaladores e/ou cópias dos 3 programas na seção `files` ou `extraResources`, para que sejam empacotados no instalador NSIS.
- **Entregável:** `electron-builder.yml` atualizado incluindo recursos necessários.

#### T-12: Gerar o instalador .exe final
- **Status:** Pendente
- **Descrição:** Rodar `npm run package` (ou `electron-builder --win`) e gerar `dist/Kolnd Hub Setup X.Y.Z.exe`.
- **Entregável:** Arquivo `.exe` funcional em `dist/`.

---

### Fase 5 — Testes e validação

#### T-13: Testar em Windows limpo (sem dependências pré-instaladas)
- **Status:** Pendente
- **Descrição:** Instalar o `.exe` em uma máquina ou VM sem Python, Playnite, etc., abrir o Kolnd Hub pela primeira vez e verificar se a instalação automática roda até o fim.
- **Entregável:** Relatório de sucesso/falha de cada etapa.

#### T-14: Verificar se os 3 programas iniciam pelo Hub
- **Status:** Pendente
- **Descrição:** Após a instalação automática, clicar em "Iniciar" em cada um dos 3 cards do dashboard e confirmar que os respectivos processos abrem corretamente.
- **Entregável:** Todos os 3 programas iniciam pelo Hub sem erro de "comando não encontrado".

#### T-15: Testar comportamento na segunda execução
- **Status:** Pendente
- **Descrição:** Fechar e reabrir o Kolnd Hub; verificar que vai direto para o dashboard (não reinicia a instalação).
- **Entregável:** Flag de primeira execução respeitada.

#### T-16: Tratamento de erros e rollback parcial
- **Status:** Pendente
- **Descrição:** Se uma etapa falhar (ex: Playnite não instalou), o script deve logar o erro, continuar com as próximas se possível, e informar ao usuário quais programas ficaram indisponíveis.
- **Entregável:** Tela de instalação exibe erros por etapa; app não trava completamente por causa de um programa.

---

### Fase 6 — Documentação e entrega

#### T-17: Atualizar README.md com instruções de distribuição
- **Status:** Pendente
- **Descrição:** Documentar como gerar o `.exe`, como funciona a primeira execução, requisitos de internet (se houver download sob demanda) e notas sobre antivírus/UAC.
- **Entregável:** README atualizado.

#### T-18: Revisar riscos de antivírus e assinatura de código
- **Status:** Pendente
- **Descrição:** Avaliar se o `.exe` pode ser sinalizado como suspeito pelo Windows Defender (baixa e executa vários instaladores). Considerar code signing certificate se for distribuir publicamente.
- **Entregável:** Análise de risco e recomendação de assinatura.

---

## Ordem sugerida de execução

```
T-01 → T-02 → T-03 → T-04 → T-05 → T-06 → T-07 → T-08 → T-09 → T-10
   → T-11 → T-12 → T-13 → T-14 → T-15 → T-16 → T-17 → T-18
```

---

## Notas importantes

- **Tamanho do instalador:** Se optar por embutir todos os 3 programas + Python + Playnite dentro do `.exe`, o instalador ficará muito grande (provavelmente centenas de MB). A opção mais viável é baixar os instaladores oficiais na primeira execução (requer internet).
- **Privilégios de administrador:** Instalações de sistema (Python, Playnite) exigem UAC. O usuário verá prompts do Windows pedindo permissão.
- **Antivírus:** Um único `.exe` que baixa e executa vários instaladores pode ser detectado como falso positivo. Testar com Windows Defender antes de distribuir.
- **DeepSeek Harness e SteamGridDB Manager:** Se você reintroduzir esses programas no README e no código do Hub, adicione tarefas extras para instalar Node.js, pnpm e npm como dependências deles.

---

**Local do arquivo:** `C:\Users\TiffoDi\desenv\Kolnd Hub\task.md`
**Projeto:** Kolnd Hub (`kolnd-hub/`)
**Stack:** Electron 28 + electron-vite + React 18 + TypeScript + Tailwind CSS