# E2E fake e observabilidade operacional (task 09)

Este documento mapeia as capabilities públicas do Absolem para o que é provado
por E2E fake e o que continua dependendo de roteiro manual. Ele complementa
`docs/test-matrix.md`; a matriz continua sendo a fonte única de rastreabilidade.

## Regras dos gates fake

- `ABSOLEM_TEST_TRANSPORT=fake` e `ABSOLEM_TEST_USERDATA` temporário por
  execução. Nenhuma chave, token, rede autenticada ou dado pessoal.
- `workers=1` para não disputar o lock de instância única.
- Trace só em falha (`retain-on-failure`).
- Relatório local redigido em `test-results/e2e-report.json`: arquivo, título,
  fase (`test.step`), duração, estado e categoria do erro. Sem payload, prompt,
  resposta, áudio, imagem, URL, caminho pessoal, chave ou token.
- Um gate fake nunca promove um item manual a "aprovado".

## Capabilities públicas e cobertura

| Capability                    | Superfície pública                                                    | E2E fake                                                         | Pendência/manual                                      |
| ----------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Bandeja e instância única     | menu/click da bandeja, `second-instance`, lock, autostart             | autostart recusado fora do pacote em `overlay-avatar.spec.ts`    | SO real, bandeja e app instalado                      |
| Overlay                       | `overlay:show/hide/toggle/status/set-layout/set-interactive/...`      | `overlay-avatar.spec.ts`, `settings.spec.ts`, `baseline.spec.ts` | atalho global e clique real no desktop                |
| Avatar                        | `avatar:set-state`, `avatar:set-level`, `avatar:get-status`, apply    | `overlay-avatar.spec.ts` (estado, nível e push)                  | aparência/GPU em máquina real                         |
| Configurações e rotas         | `settings:open`, 7 abas, `ui.lastSettingsTab`, tema, export/import    | `settings-memory.spec.ts`, `settings.spec.ts`, `a11y.spec.ts`    | tema real na Hub e Narrador                           |
| Texto/Live                    | `chat:send/cancel`, pushes delta/done/error, uso                      | `chat-capture.spec.ts`, `baseline.spec.ts`                       | chave e modelo Gemini reais                           |
| Voz fake                      | consentimento, dispositivo, start/stop/toggle/interrupt, PCM/barge-in | `baseline.spec.ts`, `settings.spec.ts`                           | microfone, barge-in acústico, reconexão e hot-swap    |
| Captura de tela               | `capture:status/sources/ask/region/cancel`, frame e indicador         | `chat-capture.spec.ts`, `baseline.spec.ts`                       | DPI, dois monitores, janela ativa, DRM e legibilidade |
| Permissões, ações e auditoria | `permissions:get/set`, `actions:pause/status`, audit                  | `overlay-avatar.spec.ts`, `settings-memory.spec.ts`              | ações reais, `actions.jsonl`, UAC e energia           |
| Pesquisa e cache              | `search:status/open-url/clear-cache`, tools e indicador               | `settings-memory.spec.ts` (ligado/desligado, cache, allowlist)   | busca real, fontes, SSRF e injeção                    |
| Memória                       | `memory:list/search/create/update/remove/remove-all/stats/...`        | `settings-memory.spec.ts` (CRUD, auditoria, export/import)       | edição pela UI real e migração de perfil existente    |
| Histórico                     | `history:list`                                                        | `settings-memory.spec.ts`                                        | turnos reais de voz/chat                              |
| Diagnóstico                   | `diagnostics:gemini/overlay/export`                                   | `settings-memory.spec.ts` (metadados e export redigido)          | diagnóstico de sessão real de voz/captura             |
| Encerramento                  | `app:quit`, shutdown hooks, janelas e perfil                          | `lifecycle.spec.ts`                                              | encerramento pelo SO, bandeja e Windows               |
| Observabilidade               | relatório local de execução                                           | `redacted-reporter.ts` e `test-results/e2e-report.json`          | envio de log/diagnóstico real                         |

## Lacunas manuais (não convertidas em aprovadas)

- Voz com microfone, barge-in acústico, reconexão e hot-swap:
  `docs/diagnostico-voz.md`.
- Captura real em 100%/150%, dois monitores, região, blocklist, DRM e
  legibilidade: `docs/screen-capture-checklist.md`.
- Ações reais (abrir/fechar app, arquivos, energia, UIA, pausa por atalho):
  `docs/computer-control-checklist.md`.
- Pesquisa real com chave e internet, SSRF em navegador, cache e fontes:
  `docs/web-search-checklist.md`.
- Narrador do Windows e navegação completa por teclado: `docs/a11y-audit.md`.
- Bandeja, segunda instância, atalhos globais, abrir pastas, relançar,
  autostart instalado e UAC: Windows real.
- Atualização pela Hub, máquina limpa e desempenho na máquina de referência:
  `docs/data-lifecycle.md`, `docs/perf-budget.md` e README.
