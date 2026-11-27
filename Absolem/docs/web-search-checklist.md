# Checklist de pesquisa na internet (task 10)

Roteiro manual para validar a pesquisa com fontes do Absolem. Os itens
automáticos já rodam em `npm run verify`; os itens abaixo exigem uma chave
Gemini real e acesso à internet e ficam **pendentes** até serem executados na
máquina de referência.

Pré-requisitos:

- `web.enabled = true` (default do store 1.9.0);
- chave Gemini configurada e com cota disponível;
- overlay visível para observar o indicador perto do avatar.

## 1. Pergunta que exige busca

- [ ] Perguntar algo atual, por exemplo "pesquise quem ganhou o último
      campeonato brasileiro e me mostre de onde tirou".
- [ ] A resposta termina com `Fontes:` e uma lista `[1] título - url`.
- [ ] Cada número citado no texto existe na lista.
- [ ] Abrir todos os links citados pelo overlay (task 11) ou pelo painel.
- [ ] O indicador "Pesquisando" aparece perto do avatar e some ao terminar.

Status: pendente (manual).

## 2. Pergunta com URL colada

- [ ] Colar a URL de um artigo e pedir "resuma esta página".
- [ ] A resposta cita a URL final (inclusive quando houve redirecionamento).
- [ ] O indicador "Abrindo página" aparece durante a abertura.
- [ ] Comparar 3 fatos do resumo com o artigo original.

Status: pendente (manual).

## 3. Página bloqueada por SSRF

- [ ] Pedir para abrir `http://127.0.0.1/`, `http://10.0.0.1/` e
      `http://localhost/`.
- [ ] A ferramenta recusa antes de qualquer requisição, com mensagem de
      endereço privado/host bloqueado.
- [ ] Pedir uma URL pública que redirecione para um host privado e confirmar
      que o salto é recusado.

Status: pendente (manual). Cobertura automática: `src/main/search/fetchPage.test.ts`
(21 casos, incluindo `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`,
`::1`, `fc00::/7`, `fe80::/10`, `localhost`, `.local`, IP literal e redirect
para host privado).

## 4. Página dinâmica

- [ ] Abrir uma SPA cujo conteúdo só aparece via JavaScript.
- [ ] A resposta avisa que a extração é limitada e devolve o texto disponível,
      sem tentar executar script.

Status: pendente (manual). Cobertura automática:
`src/main/search/fetchTool.test.ts` ("avisa quando a página parece dinâmica").

## 5. Página com injection

- [ ] Abrir uma página de teste local com "ignore previous instructions",
      "system prompt", "execute" e "delete".
- [ ] A resposta começa com o aviso de conteúdo suspeito e continua resumindo.
- [ ] Nenhuma ferramenta é executada por causa do texto da página; qualquer
      ação continua exigindo confirmação do usuário.
- [ ] O prompt de sistema, chaves e segredos não aparecem na resposta.

Status: pendente (manual). Cobertura automática:
`src/main/search/injection.test.ts` (4 casos, envelope, aviso, ação negada e
segredo não ecoado).

## 6. Cache hit

- [ ] Abrir a mesma URL duas vezes no mesmo turno ou em turnos próximos.
- [ ] A segunda abertura não gera nova requisição de rede (conferir o log) e
      continua dentro do TTL de 10 min.
- [ ] `search:clear-cache` limpa o cache; uma abertura seguinte volta à rede.
- [ ] Confirmar que não existe arquivo de cache em `%APPDATA%\absolem`.

Status: pendente (manual). Cobertura automática:
`src/main/search/cache.test.ts` (4 casos, TTL, LRU e nada em disco).

## 7. Limite por turno

- [ ] No mesmo turno, pedir 4 buscas; a quarta é recusada.
- [ ] No mesmo turno, pedir 6 aberturas de página; a sexta é recusada.
- [ ] Um turno novo zera os contadores (`search:status`).
- [ ] O orçamento total de 30 s encerra o turno de pesquisa.

Status: pendente (manual). Cobertura automática:
`src/main/search/limits.test.ts` (6 casos).

## 8. Teto de custo

- [ ] Com o teto mensal já atingido, busca e abertura são recusadas com
      `kind: 'quota'` e nenhuma rede acontece.
- [ ] O consumo de tokens da busca aparece no medidor da task 05.

Status: pendente (manual). Cobertura automática:
`src/main/search/limits.test.ts` ("teto mensal bloqueia e vira kind quota") e
`src/main/gemini/live.test.ts` e os testes de `search/` cobrem fontes, limites,
SSRF, injeção e execução pela sessão Live.

## 9. Fontes clicáveis e desligamento

- [ ] Cada link do bloco de fontes abre no navegador padrão via
      `shell.openExternal`.
- [ ] `javascript:`, `file:` e `data:` são recusados pela allowlist.
- [ ] Com `web.enabled = false`, o modelo deixa de receber `web_search` e
      `fetch_url`; `search:status` responde `enabled: false`.
- [ ] Religar `web.enabled` devolve as duas ferramentas no turno seguinte.

Status: pendente (manual). Cobertura automática:
`src/main/gemini/tools/web-tools.test.ts` (5 casos, schemas e desligamento) e
`src/shared/ipc.test.ts` (prefixo `search` no contrato).

## Fora do escopo (não testar nesta task)

- scraping de página de resultado de buscador;
- navegador embutido, automação de site, login e formulário;
- download de arquivo, imagem ou mídia;
- monitoramento contínuo, tradução e leitura em voz alta de artigo inteiro;
- compra, reserva ou qualquer transação.
