# Modelo Gemini do Absolem

O Absolem usa exclusivamente **Gemini 3.8 Live** (`gemini-3.8-live`) para
conversa, voz, visão da tela, pesquisa web, leitura de URLs e ações.

Todas essas capacidades permanecem na sessão `ai.live.connect`. A pesquisa usa
o Google Search nativo do Live; `fetch_url` continua passando pelas proteções
locais de SSRF, limites, auditoria e proteção contra injeção.

Campos antigos como `gemini.model` e outros modelos continuam aceitos apenas
para migração segura de configurações existentes. Eles não selecionam endpoints
nem modelos em runtime e não aparecem como opções na interface.

O controle **Ilimitado** remove somente o teto mensal interno do Absolem; não
remove quota, rate limits ou indisponibilidade do provedor Google.
