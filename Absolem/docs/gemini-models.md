# Modelos Gemini

O Absolem mantém duas configurações independentes:

- **Texto, visão e pesquisa:** usa `gemini.model` nas chamadas de texto e
  grounding (`generateContent`/`generateContentStream`).
- **Live e voz:** usa `gemini.liveModel` na sessão de áudio em tempo real
  (`ai.live.connect`, endpoint `v1beta`).

O modelo Live não é automaticamente compatível com chat, visão ou pesquisa.
Por isso, escolher um modelo Live não altera o modelo de texto, e o Absolem
não envia um modelo Live para um endpoint de texto sem suporte comprovado.

`gemini-3.8-live` continua sendo o padrão da voz. Modelos customizados já
salvos são preservados e aparecem como **Personalizado** nas configurações.

O controle **Ilimitado** remove somente o teto mensal interno do Absolem; não
remove quota, rate limits ou indisponibilidade do provedor Google.
