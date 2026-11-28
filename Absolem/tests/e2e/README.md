# E2E fake do Absolem

Os testes desta pasta rodam o app buildado com:

- `ABSOLEM_TEST_TRANSPORT=fake`: nenhuma chave, rede, microfone ou áudio real;
- `ABSOLEM_TEST_USERDATA` temporário por execução, removido no `finally`;
- `workers=1`, para não disputar o lock de instância única;
- trace apenas em falha (`retain-on-failure`).

```text
npm run test:e2e
```

O relatório local fica em `test-results/e2e-report.json` (ignorado pelo Git). Ele
grava somente arquivo do repositório, título, fase, duração, estado e categoria
do erro. Prompt, resposta, áudio, imagem, URL, caminho pessoal, chave e token
nunca entram no relatório.

`ABSOLEM_TEST_FAKE_DELAY_MS` atrasa a resposta do transporte fake de propósito
para os testes de cancelamento/substituição. Ele só tem efeito fora do app
empacotado com `ABSOLEM_TEST_TRANSPORT=fake`.

Estes gates não substituem os roteiros manuais de voz, captura, ações reais,
Narrador/teclado, atualização pela Hub e máquina limpa. A rastreabilidade fica em
`docs/test-matrix.md` e `docs/e2e-observability.md`.
