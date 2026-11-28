# Avaliação de wake word (task 06)

Status: **avaliação apenas**. A v1 não implementa wake word; o clique no avatar
e o atalho `Control+Alt+Space` são os gatilhos aprovados.

## O que seria necessário

- Modelo local (por exemplo um detector ONNX pequeno) rodando no renderer ou no
  main, consumindo PCM 16 kHz continuamente.
- Dependência nova de runtime (`onnxruntime-node` ou `onnxruntime-web`), com
  binário/ABI nativa e `asarUnpack` no empacotamento. Isso contraria a regra de
  dependência sem aprovação do README §7.4.
- Um segundo caminho de captura sempre ligado, independente do consentimento
  da sessão de voz. O gate de microfone atual exige consentimento e indicador
  visível somente enquanto a sessão está ativa; wake word mudaria esse contrato.
- Tratamento de falso positivo: o detector pode acordar o app no meio de uma
  reunião, filme ou conversa de terceiros.

## Custo estimado

- CPU: inferência contínua de um modelo pequeno a cada 20–40 ms. Estimativa de
  **1% a 4% de um núcleo** em máquina de referência (4 núcleos, Windows 11),
  dependendo do modelo e do intervalo de inferência. Este número precisa ser
  medido no gate antes de qualquer decisão; não foi medido nesta task.
- Memória: o runtime ONNX adiciona dezenas de MB ao processo que o carregar.
- Bateria: em notebook, captura e inferência contínuas impedem o repouso do
  processador de áudio.
- Privacidade: o áudio continua local, mas o microfone fica aberto o tempo
  todo, o que exige um indicador permanente e um consentimento separado.

## Alternativas consideradas

1. **Clique no avatar** (implementado): zero custo em idle, gesto explícito e
   compatível com o gate de microfone.
2. **Atalho global** (implementado): `Control+Alt+Space`, sem captura quando o
   overlay está oculto.
3. **Push-to-talk**: manter o botão pressionado; simples, mas pior para
   conversas longas e para o barge-in.
4. **Wake word local**: melhor ergonomia, maior custo e risco de falso
   positivo; fica fora da v1.

## Decisão recomendada

**Não implementar wake word na v1.** O ganho de ergonomia não compensa a
dependência nativa, o consumo contínuo e o risco de abrir o microfone sem um
gesto do usuário. Reavaliar somente com métrica de CPU medida na máquina de
referência, taxa de falso positivo em 8 h de áudio ambiente e aprovação
explícita do gate de privacidade.
