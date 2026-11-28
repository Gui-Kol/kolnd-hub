# Modelo de custo do Absolem

Documento da task 13 (T3). Reúne os limites internos de consumo,
o comportamento em 80% e 100%, como aumentar, desativar o teto interno e como zerar o medidor. O produto
mede **tokens**, não moeda: o preço é definido pelo Google e cobrado na conta
Gemini do usuário.

Fonte da verdade no código: `src/main/gemini/usage.ts` (teto e medidor),
`src/main/voice/controller.ts` (sessão de voz), `src/main/capture/limits.ts`
(capturas), `src/main/search/limits.ts` (pesquisa), `src/main/audit/actions.ts`
(ações), `src/shared/memory.ts` (extração) e `src/shared/screen.ts` (captura).

## 1. Tabela de limites

| Área                  | Limite                                                           | Onde está                                                                      | Como é aplicado                                                                                                |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Teto mensal           | 2.000.000 tokens (default), opcionalmente ilimitado internamente | `DEFAULT_MONTHLY_TOKEN_CAP`, `gemini.monthlyTokenCap`, `gemini.unlimitedUsage` | `UsageMeter.checkBudget` antes de qualquer transporte; `quota` bloqueia somente com o modo ilimitado desligado |
| Aviso                 | 80% do teto, uma vez por mês                                     | `USAGE_WARNING_PERCENT`                                                        | Push `gemini:usage-warning` e tarja na aba Chave e custo                                                       |
| Bloqueio              | 100% do teto                                                     | `checkBudget`                                                                  | Erro `quota` com a mensagem do medidor; nenhuma chamada de rede                                                |
| Retenção do medidor   | 62 dias de dias diários                                          | `USAGE_RETENTION_DAYS`                                                         | Poda na escrita; meses anteriores saem do cálculo mensal                                                       |
| Sessão de voz         | 15 min contínuos                                                 | `voice.maxSessionMinutes` (5-30)                                               | Timer do controlador encerra com aviso                                                                         |
| Silêncio na voz       | 20 s sem fala                                                    | `voice.silenceTimeoutSeconds` (5-600)                                          | Timer reiniciado por chunk com RMS de fala                                                                     |
| Capturas              | 20 por hora                                                      | `MAX_CAPTURES_PER_HOUR`                                                        | Janela deslizante em memória; reiniciar zera                                                                   |
| Captura proativa      | 1 a cada 60 s                                                    | `PROACTIVE_MIN_INTERVAL_MS`                                                    | Só com `privacy.screen.proactive` e voz `listening`                                                            |
| Tamanho da captura    | 8 MB e lado máximo 1280 px                                       | `MAX_CAPTURE_BYTES`, `MAX_CAPTURE_SIDE`                                        | Recusa antes de enviar ao Gemini                                                                               |
| Busca por turno       | 3 buscas grounded                                                | `MAX_SEARCHES_PER_TURN`                                                        | Contador reiniciado por `chat:send`                                                                            |
| Abertura por turno    | 5 páginas                                                        | `MAX_FETCHES_PER_TURN`                                                         | Mesmo contador do turno                                                                                        |
| Orçamento de pesquisa | 30 s por turno                                                   | `SEARCH_TURN_BUDGET_MS`                                                        | Relógio do turno; depois disso, recusa                                                                         |
| Extração de memória   | a cada 6 turnos e no fim da sessão                               | `MEMORY_EXTRACTION_TURN_INTERVAL`                                              | `recordTurn` dispara; máximo de 5 candidatos                                                                   |
| Prompt de memória     | 8 itens e 1.200 caracteres                                       | `MEMORY_PROMPT_BUDGET`, `MEMORY_PROMPT_MAX_ITEMS`                              | Bloco limitado no prompt de sistema                                                                            |
| Ações                 | 5 apps/min, 10 operações, 1 UIA/2 s                              | `ACTION_LIMITS`                                                                | Limitador da task 08 antes da execução                                                                         |
| Imagem no turno       | largura * altura / 750                                           | `estimateImageTokens`                                                          | Contabilizada no envio e descontada do total do provedor para não contar duas vezes                            |
| `test-key`            | uma chamada mínima                                               | `GeminiEngine.testKey`                                                         | Conta tokens como qualquer chamada                                                                             |

## 2. O que acontece em 80% e em 100%

### 80%

- O medidor emite `onWarning` uma única vez por mês (`warnedMonths`).
- O main empurra `gemini:usage-warning` com `percent`, `cap` e `used`.
- A aba Chave e custo mostra a tarja âmbar "Você já usou N% do teto mensal".
- Nada é bloqueado. A conversa continua; o usuário é avisado para aumentar o
  teto ou aguardar o próximo mês.

### 100%

- Com **Uso ilimitado** ativo, o teto mensal interno não bloqueia chat, voz,
  pesquisa ou visão; o medidor continua registrando tokens, chamadas e
  percentuais.
- `UsageMeter.checkBudget` lança `GeminiError('quota', ...)`.
- `GeminiEngine.assertEnabled` chama `checkBudget` antes de montar a requisição;
  o transporte não é tocado (`generateAttempts`/`streamAttempts` ficam em 0).
- `CaptureLimiter`, `SearchTurnLimits` e `VoiceController` também consultam o
  teto antes de capturar, buscar ou abrir a sessão de voz.
- O renderer recebe `chat:error` com `kind: 'quota'` e a mensagem com o caminho
  para aumentar `gemini.monthlyTokenCap`.
- A captura de tela é recusada antes dos pixels; a busca antes da rede; a voz
  antes do microfone.

## 3. Como aumentar o teto

1. Abra **Configurações > Chave e custo**.
2. Clique em **Aumentar teto**. A interface dobra o valor vigente
   (`Math.max(monthlyTokenCap, ceil(capAtual * 2))`) e persiste em
   `gemini.monthlyTokenCap`.
3. O medidor lê o teto a cada consulta; a próxima chamada já usa o valor novo,
   sem reiniciar o app.
4. Aumentar o teto **não zera** o consumo: o valor já gasto continua no mês. O
   percentual cai porque o denominador cresceu.

## 3.1 Como ativar o uso ilimitado interno

1. Abra **Configurações > Chave e custo**.
2. Clique em **Ativar uso ilimitado**. A preferência é persistida em
   `gemini.unlimitedUsage` e o estado **Ilimitado** aparece na tela.
3. Isso remove somente o bloqueio mensal interno do Absolem. Não remove quotas,
   limites de requisições (rate limits), indisponibilidade ou outras políticas
   do Google, inclusive ao usar uma API key gratuita.
4. O uso continua sendo contabilizado. Capturas por hora, chamadas por turno,
   intervalo proativo, duração de sessão e limites de tamanho permanecem ativos.

Limite mínimo: 1 token (`clampCap`). Não há teto máximo no código; valores
absurdos são responsabilidade do usuário e da conta Google.

## 4. Como zerar

- **Automático:** o medidor soma por mês UTC (`YYYY-MM`). No primeiro instante
  do mês seguinte, `month` volta a 0 sem apagar o histórico diário. A retenção
  de 62 dias poda os dias antigos.
- **Manual (suporte):** não existe botão "zerar consumo" na v1. Com o app
  fechado, faça backup de `%APPDATA%\absolem\config.json`, remova a chave
  `usage` e reabra o app. O medidor recomeça do zero; o restante da configuração
  é preservado. Não é recomendado como rotina e não muda a cobrança já feita
  pelo Google.
- Reduzir o teto **não** zera e pode bloquear imediatamente se o consumo atual
  já estiver acima do novo valor.

## 5. Idempotência e valores inválidos

- `UsageMeter.record(amounts, { requestId })` ignora um `requestId` já visto na
  mesma execução. O conjunto é limitado a 200 identificadores em memória; não é
  persistido e não cresce sem limite.
- Tokens de entrada e saída passam por `nonNegativeInt`: número inválido,
  `NaN`, infinito ou negativo vira 0. O medidor nunca mostra valor negativo.
- O total do provedor, quando existe, é a fonte; sem metadados, a estimativa é
  `caracteres / 4` e vem marcada com `estimated: true`.
- Tokens de imagem são contados no envio e descontados da entrada do primeiro
  turno quando o provedor devolve o total, evitando soma dupla.

## 6. Limites que não são configuráveis na UI

- 20 capturas por hora, 1 proativa a cada 60 s e 1280 px são constantes de
  projeto; mudar exige alteração de código e novo release.
- 3 buscas, 5 aberturas e 30 s por turno são constantes de projeto.
- A extração a cada 6 turnos é constante; o usuário só liga/desliga a extração
  automática (`memory.autoExtract`).
- Aumentar o teto ou ativar o uso ilimitado interno são as alavancas de custo
  expostas na interface; nenhuma delas altera quotas do Google.

## 7. Evidência automatizada

`src/main/security/cost-limits.test.ts` cobre:

1. **100% bloqueia** sem chamar `generateText` nem `streamText`;
2. **aumento libera** a chamada seguinte;
3. **`requestId` repetido** não soma duas vezes;
4. **reset mensal** zera o mês e libera o orçamento;
5. **valores negativos** não reduzem o medidor;
6. **aumentar o teto** reduz o percentual sem zerar o consumo.

Os testes de 06/07/10 continuam cobrindo os limites de voz, captura e pesquisa
(`voice-timeouts.test.ts`, `capture/limits.test.ts`, `search/limits.test.ts`).
