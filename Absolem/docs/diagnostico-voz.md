# Diagnóstico manual da voz

Este roteiro coleta somente metadados do fluxo de voz. O arquivo padrão é:

```text
%APPDATA%\absolem\logs\absolem.log
```

## Reproduzir

1. Feche outras instâncias do Absolem.
2. Inicie o Absolem normalmente e deixe o overlay visível.
3. Ative a voz pelo avatar ou pelo atalho configurado.
4. Se o diálogo aparecer, escolha **Permitir microfone** (ou **Agora não**,
   caso queira testar a negação).
5. Fale uma frase curta por alguns segundos e aguarde a resposta.
6. Se a sessão reconectar, aguarde alguns segundos antes de encerrar.

O log registra estado, tipo de erro, contagens, tamanhos de buffer, taxas de
amostragem e duração aproximada. Ele não registra áudio/PCM, imagem,
transcrição, prompt, resposta, URL, chave, token ou conteúdo de ferramenta.

## Copiar o trecho relevante

1. Feche o Absolem completamente pelo menu da bandeja e confirme que ele não
   continua aberto no Gerenciador de Tarefas.
2. Abra `%APPDATA%\absolem\logs\absolem.log`.
3. Copie somente as linhas desde cerca de 10 segundos antes do início do teste
   até o fechamento da sessão.
4. Antes de enviar, confirme que o trecho contém apenas linhas de log e não
   inclua outros arquivos, configurações ou pastas.

Não envie áudio, capturas de tela, histórico, prompts, respostas, chaves,
tokens ou o arquivo inteiro se o trecho já for suficiente. Os arquivos
`absolem.1.log` e `absolem.2.log` são rotações antigas e normalmente não são
necessários.
