# Checklist de release - Absolem

Release candidata: **0.1.0**
Data da execução: **2026-11-26**
Artefato: `dist/Absolem Setup 0.1.0.exe` (NSIS per-user, não assinado)
SHA-256: `be69c9bb21ed2f8405bd211154ce882ce256f52e7e3720c7c64c4664de8fe921`

Este checklist foi preenchido com o que foi realmente executado. Itens que
dependem de ambiente humano estão marcados **PENDENTE MANUAL** e **bloqueiam o
release público** até serem concluídos; não há item "a fazer" escondido.

## 1. Código

- [x] `cd Absolem && npm run verify` - typecheck, lint, format e testes verdes.
      Resultado: **123 arquivos, 496 testes**, exit 0, cerca de 6 s.
- [x] `npm run test:coverage` - **74,51% linhas, 68,33% ramos, 83,29% funções**;
      metas 70/60 cumpridas, exit 0.
- [x] `npm run test:e2e` - **2 testes verdes** (`settings.spec.ts` e
      `a11y.spec.ts`), build de produção antes.
- [x] `npm run verify:build` - verificação e build de produção sem erro.
- [x] `npm run package` - instalador NSIS gerado nesta data.
- [x] Nenhuma dependência de runtime nova; única dev nova:
      `@axe-core/playwright` 4.14.1 (T9, justificada).
- [x] `git status --short` sem arquivos fora de `Absolem/` deste agente; nada
      commitado/push pelo subagente.
- [x] Cadeia de suprimentos local (T7): `npm ci` exit 0, `npm ls --all` sem
      `extraneous`, `npm audit --omit=dev` com 0 vulnerabilidades e `npm audit`
      completo com 21 avisos de dev registrados em `docs/licenses.md`.
- [ ] **PENDENTE:** 21 vulnerabilidades de desenvolvimento (tar/electron-builder,
      tinypool/vitest, minimatch) exigem atualização controlada futura; não foram
      corrigidas com `--force` porque trocariam a stack sem aprovação.
- [ ] **PENDENTE:** T5 (CI) e T8 (VM limpa) da task 12 continuam abertos; nenhum
      workflow de `.github/` foi criado ou alterado nesta task.

## 2. Segurança

- [x] `docs/threat-model.md` revisado contra o código; ativos, adversários,
      superfícies, mitigações e riscos residuais com matriz de rastreabilidade.
- [x] Redação de logs: `src/main/security/redaction.test.ts` (chave, caminho
      pessoal, transcrição, debug só com flag). Regra ESLint `no-console` no main
      com exceção só do logger.
- [x] Auditoria sem conteúdo: `audit/actions.jsonl` e `audit/memory.jsonl`
      testados; `safeArgs`/hash e rotação.
- [x] IPC: `src/main/security/ipc.test.ts` (allowlist, limite 8 MB/64 KB,
      remetente, erro sem stack); guarda aplicada em chat e capture.
- [x] Hardening: `src/main/security/hardening.test.ts` (webPreferences nas três
      janelas, CSP sem unsafe-eval/script inline, webview negado, mídia só no
      overlay); `app.enableSandbox()` no bootstrap.
- [x] Navegação e `shell.openExternal` restritos a http/https; testes de
      `navigation` e `shared/search`.
- [x] Nenhuma chave, áudio, imagem ou transcrição em `info+` nos testes de
      redação; varredura manual nos logs reais **PENDENTE MANUAL** (sem roteiro
      interativo completo).
- [x] Sem segredo, `.env`, `secrets.bin` real ou `%APPDATA%` real usado nos
      testes; tudo em diretório temporário.
- [ ] **PENDENTE MANUAL:** no DevTools do overlay, tentar `window.open`,
      `location.href`, `require` e `window.absolem.__proto__`; confirmar bloqueio.
- [ ] **PENDENTE MANUAL:** revisar os logs gerados após um roteiro real com
      `Select-String` e confirmar zero chave/transcrição/caminho pessoal.

## 3. Privacidade

- [x] `docs/consent-matrix.md` cobre microfone, tela, leitura/escrita de
      arquivos, abrir/fechar apps, energia, UIA, pesquisa web e memória, com
      revogação em até 2 cliques.
- [x] `src/renderer/src/settings/consent-revocation.test.tsx` percorre as
      capacidades e confirma mudança de estado e bloqueio.
- [x] `docs/data-lifecycle.md`: caminhos, prazos, exportação e "apagar tudo".
- [x] `src/main/security/data-lifecycle.test.ts`: purge remove banco, logs,
      auditoria, cache, config e chave; confirmação literal; `VACUUM` reduz arquivo;
      auditoria de 90 dias; reinício não ressuscita dados.
- [x] Retenção: logs 5 MB x 2; auditoria 5 MB x 2 e 90 dias; medidor 62 dias;
      consolidação diária da memória.
- [ ] **PENDENTE MANUAL:** apagar tudo pela UI, reiniciar o app e confirmar tela
      vazia; exportar/importar memória em app real.
- [ ] **PENDENTE MANUAL:** conceder/revogar cada consentimento com o app em uso
      (microfone, tela, arquivos, apps, energia, UIA, web e memória).
- [ ] **PENDENTE MANUAL:** confirmar que a desinstalação preserva
      `%APPDATA%\absolem` (`deleteAppDataOnUninstall:false`).

## 4. Custo

- [x] `docs/cost-model.md` com tabela de limites, 80%, 100%, como aumentar e
      como zerar.
- [x] `src/main/security/cost-limits.test.ts`: 100% bloqueia sem rede, aumento
      libera, `requestId` repetido não conta duas vezes, reset mensal zera, valores
      negativos não reduzem o medidor.
- [x] Limites de voz (15 min/20 s), captura (20/h, 1/60 s, 8 MB) e pesquisa
      (3/5/30 s) cobertos pelos testes das tasks 06/07/10.
- [ ] **PENDENTE MANUAL:** baixar o teto, esgotar, conferir a mensagem e liberar
      com chave real.

## 5. Acessibilidade

- [x] `@axe-core/playwright` 4.14.1 rodando nas sete abas e no overlay expandido;
      **0 violações críticas ou sérias**.
- [x] Contraste corrigido: `--text-tertiary` de `#6b7885` para `#8b98a5`
      (5,53-6,53:1 nos fundos usados).
- [x] `docs/a11y-audit.md` registra método, correção e cobertura.
- [x] Testes de UI: rótulos, foco inicial, `aria-live`, navegação por abas.
- [ ] **PENDENTE MANUAL:** passada com Narrador do Windows e teclado em todas as
      telas; `prefers-reduced-motion`; contraste com tema personalizado.

## 6. Desempenho

- [x] `docs/perf-budget.md` com método e números reais do binário empacotado:
      oculto **0,3% de um núcleo / 102,7 MB**; visível **0,5-0,6% / 106,3 MB**;
      fps **165**; frame 6,1 ms.
- [x] 50 ciclos de mostrar/ocultar sem crescimento: RSS 120,6 -> 113,2 MB
      (-7,4 MB), heap do renderer 10,0 -> 10,0 MB.
- [x] `process.memoryUsage()` do main antes/depois registrado.
- [ ] **PENDENTE MANUAL:** 10 sessões de voz curtas com chave/microfone reais.
- [ ] **PENDENTE MANUAL:** 10 minutos com overlay ativo e medição térmica com
      HWiNFO/Monitor de Desempenho; confirmar ausência de throttling.

## 7. Empacotamento

- [x] Budget de build: `electron-vite build` e `electron-builder --win` sem erro
      nesta data.
- [x] Instalador gerado: `Absolem Setup 0.1.0.exe`.
- [x] SHA-256 gerado por `scripts/hash-artifact.ps1`:
      `be69c9bb21ed2f8405bd211154ce882ce256f52e7e3720c7c64c4664de8fe921`.
- [x] `release-notes.md` gerado com versão, data, requisitos, hash e aviso de
      app não assinado.
- [x] `better_sqlite3.node` dentro de `app.asar.unpacked` (conferido no build
      empacotado; smoke de memória coberto na task 12).
- [ ] **PENDENTE MANUAL:** instalação limpa em VM sem Node, conferência do hash,
      abertura do app, desinstalação e confirmação de que `%APPDATA%` ficou.
- [ ] **PENDENTE MANUAL:** SmartScreen/execução em máquina sem Visual Studio e
      sem Node (fora do ambiente de build).

## 8. Documentação

- [x] `README.md` com requisitos, instalação, primeira configuração, atalhos,
      dados e custo; caminho do banco corrigido para `memory.sqlite`.
- [x] `docs/FIRST-RUN-CHECKLIST.md` e `docs/RELEASE.md` revisados para
      `memory.sqlite`.
- [x] `docs/SIGNING.md` com app não assinado, SHA-256 e futuro OV/EV.
- [x] `docs/threat-model.md`, `consent-matrix.md`, `cost-model.md`,
      `test-matrix.md`, `a11y-audit.md`, `perf-budget.md`, `data-lifecycle.md` e
      `licenses.md` presentes.
- [x] `docs/licenses.md` com inventário, auditoria npm, pendências de dev e
      justificativa do axe.
- [x] Nenhum emoji, aspas curvas ou texto fora de pt-BR nos documentos novos.

## 9. Modos degradados

- [x] `src/main/security/degraded.test.ts`: sem chave, chave inválida, sem rede,
      Gemini fora, cota, microfone negado, dispositivo removido, WebGL indisponível,
      banco corrompido e captura bloqueada; todos com título, mensagem, avatar e
      recuperação, sem "erro desconhecido".
- [x] UI existente mostra recuperação na aba Chave, Voz, Memória e no overlay de
      primeira configuração; testes de UI das tasks 09/11 cobrem os estados.
- [ ] **PENDENTE MANUAL:** desligar a rede, remover o microfone/saída e corromper
      `memory.sqlite` (com backup antes) para confirmar a recuperação no app real.

## 10. Decisão final

**Código e auditoria automática: APROVADOS.**
**Release público: REPROVADO nesta sessão** até concluir os itens de ambiente
humano abaixo. A reprovação é bloqueio explícito, não nota de rodapé:

1. Instalação limpa em VM sem Node, hash, abertura e desinstalação.
2. Narrador do Windows + teclado em todas as telas.
3. 10 sessões de voz reais e 10 min de overlay com medição térmica.
4. Apagar tudo pela UI + reiniciar + tela vazia.
5. Roteiro real de logs com `Select-String` confirmando zero segredo.
6. Teste de teto baixo/esgotar/liberar com chave real.

Nenhum desses itens falhou: eles não foram executados por falta de ambiente
(chave, microfone, Narrador, VM limpa e ferramenta térmica). O produto não deve
ser publicado como release final antes de concluí-los.

| Campo    | Valor                                                    |
| -------- | -------------------------------------------------------- |
| Executor | Subagente da task 13                                     |
| Revisor  | Usuário (pendente)                                       |
| Data     | 2026-11-26                                               |
| Versão   | 0.1.0                                                    |
| Decisão  | Reprovado para release público até as pendências manuais |
