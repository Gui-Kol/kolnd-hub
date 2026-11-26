# Memória de longo prazo do Absolem

Documento da task 09. Descreve o que é guardado, por quanto tempo, como apagar e
quais são os limites de privacidade da v1.

## Onde ficam os dados

- Banco: `%APPDATA%\absolem\memory.sqlite` (`app.getPath('userData')`).
- Modo WAL: o SQLite mantém `memory.sqlite-wal` e `memory.sqlite-shm` ao lado.
- Auditoria: `%APPDATA%\absolem\audit\memory.jsonl`.
- Backup automático e sincronização não existem na v1. O usuário pode exportar
  em JSON pela tela de memória.

## O banco NÃO é cifrado na v1

Decisão registrada no gate de privacidade: a proteção é a ACL do perfil do
Windows. Quem conseguir ler o arquivo com a conta do usuário lê as memórias.
Não prometa sigilo além disso. Cifragem (SQLCipher) fica para a avaliação da
task 13.

`VACUUM` é executado depois de "apagar tudo" e de importação em massa para
devolver páginas livres ao sistema. Ainda assim, um arquivo de backup do
Windows ou ferramenta de recuperação pode conter páginas antigas. Apagar não é
garantia forense; é exclusão lógica seguida de compactação.

## Modelo de dados

- `memories`: `id`, `kind` (`fact`, `preference`, `profile`, `temporary`),
  conteúdo, tags, confiança, origem, datas, uso, expiração e `pinned`.
- `memories_fts`: FTS5 external-content sobre `content` e `tags`, mantido por
  triggers de insert/update/delete. `remove` e import/remove-all rodam
  `rebuild` para não deixar resultado fantasma.
- `memories_archive`: mesma forma mais `archived_at` e `reason`. É somente
  leitura na tela; a consolidação nunca apaga por conta própria.
- `turns` e `sessions`: transcrições finais da voz, com `interrupted` quando o
  turno foi cortado. Só são gravadas quando `memory.enabled` é verdadeiro.
- `memory_meta`: `last_extraction_at` e afins.
- `memory_maintenance`: relatório de manutenção visível na tela.
- `schema_version`: migrações aditivas (1, 2, ...). Migração lançada não é
  editada.

## Extração automática

- Roda ao fim da sessão de voz e, no máximo, a cada 6 turnos.
- Usa o Gemini com schema JSON, no máximo 5 candidatos por rodada.
- Custo entra no medidor mensal da task 05, como qualquer chamada.
- Confiança mínima 0.6; conteúdo máximo 400 caracteres.
- Candidato com aparência de chave, token, senha ou cartão é descartado com o
  log `candidato sensivel descartado`, sem registrar o valor.
- Duplicata por trigramas acima de 0.85 atualiza a memória existente em vez de
  criar outra.
- `temporary` expira em 7 dias por padrão; os demais tipos são permanentes.
- Turno marcado `interrupted` não entra na transcrição enviada à extração.
- `memory.autoExtract = false` mantém o que existe e só desliga a extração.

## Recuperação e custo de prompt

- Busca BM25 (`bm25(memories_fts)`) normalizada, decaimento exponencial de 30
  dias, frequência de uso e `pinned`.
- `pinned` e `kind = profile` entram sempre primeiro.
- No máximo 8 memórias e 1.200 caracteres no bloco do prompt.
- O bloco usa o marcador `[memória]` e o cabeçalho diz que é informação
  registrada, não verdade absoluta.
- O banco inteiro nunca é colocado no prompt.

## Consolidação

Roda uma vez por dia e na abertura quando atrasada, sem chamar modelo:

1. remove `temporary` expiradas;
2. mescla duplicatas restantes;
3. reduz a confiança do que não é usado há mais de 90 dias;
4. arquiva o que caiu abaixo de 0.2;
5. limita a 5.000 memórias ativas, arquivando o excedente.

Toda remoção ou arquivamento gera linha no relatório de manutenção. Arquivar
preserva conteúdo; apagar de verdade é ato explícito do usuário.

## Pausar, editar, apagar

- `memory.enabled = false`: interrompe extração e recuperação, não grava turnos
  e não apaga nada na tela.
- Editar altera conteúdo, tags, tipo, confiança e fixação. `id` e `created_at`
  nunca são editáveis.
- Apagar uma memória remove a linha, reconstrói o FTS e audita sem conteúdo.
- "Apagar tudo" exige o texto literal `APAGAR TUDO`, apaga memórias e arquivo e
  pode apagar `turns`/`sessions` se o usuário marcar a opção. Depois roda
  `VACUUM`.

## Exportar e importar

Formato:

```json
{
  "app": "absolem",
  "kind": "memory",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "memories": [],
  "sessions": []
}
```

- `sessions` só existe quando o usuário marca "incluir transcrições".
- Import valida `app`, `kind`, versão (versão futura é recusada) e cada linha.
- A prévia informa novas, duplicadas e inválidas; a aplicação só acontece após
  confirmação no diálogo nativo.
- Deduplica por conteúdo normalizado e nunca sobrescreve memória existente por
  `id`: toda linha importada recebe um id novo.

## Auditoria

`userData/audit/memory.jsonl`, append-only, uma linha JSON por operação:
`{ "at": "ISO", "op": "create|update|remove|remove-all|export|import|pause|...",
"id": "...", "kind": "..." }`. Conteúdo de memória, transcrição, tag e caminho
pessoal não entram. Rotação de 5 MB mantendo 2 arquivos antigos, no mesmo
padrão de `audit/actions.jsonl`.

## Módulo nativo e empacotamento

`better-sqlite3` está fixado em `11.10.0`. O `postinstall` próprio do Absolem
(`scripts/postinstall-sqlite.cjs`) baixa o prebuild
`electron-v119-win32-x64` com `prebuild-install --runtime=electron
--target=28.3.3`; o postinstall padrão do pacote fica bloqueado em
`allowScripts` para não sobrescrever o binário do Electron. O
`electron-builder.yml` marca `node_modules/better-sqlite3/**` como
`asarUnpack`.

Os testes unitários usam o `node:sqlite` embutido no Node moderno (SQL real com
FTS5) e nunca carregam o binário do Electron. O smoke do app empacotado com
`ABSOLEM_MEMORY_SMOKE=1` prova que o módulo nativo carrega e que `memory:stats`
responde com o banco vazio.

## Fora de escopo da v1

- Embeddings, banco vetorial e RAG semântico.
- Sincronização entre máquinas, backup automático e memória compartilhada.
- Cifragem com SQLCipher.
- Sumarização de conversas antigas por modelo.
