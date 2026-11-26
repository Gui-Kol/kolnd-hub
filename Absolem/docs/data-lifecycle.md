# Ciclo de vida dos dados

Documento da task 13 (T11). Explica o que o Absolem guarda em
`%APPDATA%\absolem`, por quanto tempo, como exportar e como apagar tudo. O
banco **não é cifrado** na v1; a proteção é a ACL do perfil do Windows. A chave
Gemini é a única peça cifrada (`safeStorage`/DPAPI).

## 1. O que fica em `%APPDATA%\absolem`

| Caminho                                                      | Conteúdo                                                                      | Retenção                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `config.json`                                                | Tema, overlay, voz, permissões, memória, web, rotinas, `usage` e `chat.turns` | Até o usuário apagar                             |
| `memory.sqlite`                                              | Memórias, FTS, arquivo, turnos, sessões, metadados e manutenção               | Até o usuário apagar                             |
| `memory.sqlite-wal` / `memory.sqlite-shm`                    | Journal do SQLite em modo WAL                                                 | Enquanto o banco estiver aberto                  |
| `secrets.bin`                                                | Chave Gemini cifrada por DPAPI                                                | Até remover a chave ou apagar tudo               |
| `logs/absolem.log` (+ `.1`, `.2`)                            | Log do main com redação em `info+`                                            | 5 MB por arquivo; 2 rotações (cerca de 15 MB)    |
| `audit/actions.jsonl` (+ `.1`, `.2`)                         | Auditoria de ações sem conteúdo                                               | 5 MB por arquivo; 2 rotações; poda de 90 dias    |
| `audit/memory.jsonl` (+ `.1`, `.2`)                          | Auditoria de memória `{at, op, id, kind}`                                     | 5 MB por arquivo; 2 rotações; apagado pelo purge |
| `usage` (dentro de `config.json`)                            | Tokens por dia e meses avisados                                               | 62 dias; mês corrente para o teto                |
| `scripts/foreground.ps1`                                     | Sonda de janela ativa gerada pelo app                                         | Até o purge; recriada sob demanda                |
| Caches do Chromium (`Cache`, `GPUCache`, `Code Cache`, etc.) | Cache de página/renderer                                                      | Até o purge                                      |
| `captures/`                                                  | Não existe na v1: capturas ficam só em memória                                | Não persistido                                   |

Pastas do Chromium (`Local Storage`, `Session Storage`, `Cookies`, `Network`,
`Preferences`) não guardam conteúdo de conversa; existem porque o Electron usa
o mesmo `userData`. O purge as remove junto.

## 2. Retenção e manutenção

- **Logs:** rotação por tamanho (`logger.rotateIfNeeded`): 5 MB por arquivo,
  mantendo `absolem.1.log` e `absolem.2.log`. Não há poda por data.
- **Auditoria de ações:** rotação 5 MB x 2 e poda de eventos com mais de
  **90 dias** na escrita (`AUDIT_RETENTION_DAYS`). Eventos sem `at` válido ou
  linha corrompida são descartados.
- **Auditoria de memória:** rotação 5 MB x 2. Não tem poda por tempo; o
  conteúdo é metadado e o purge remove a pasta.
- **Memória:** consolidação uma vez por dia e na abertura quando atrasada:
  temporárias expiradas, duplicatas, decay após 90 dias, arquivamento abaixo de
  0.2 e limite de 5.000 ativas. Temporária expira em 7 dias por padrão.
  Arquivar não apaga; apagar é ação explícita.
- **Custo:** o medidor mantém 62 dias de dias; o mês anterior deixa de contar no
  teto no primeiro instante do mês UTC.
- **VACUUM:** roda depois de "apagar tudo" da memória, de importação em massa e
  quando o serviço pede. Devolve páginas livres ao sistema; não é garantia
  forense contra backup/recuperação do Windows.

## 3. Exportar tudo

A v1 tem três exportações:

1. **Memória:** aba Memória, "Exportar memórias…" gera JSON
   `{app, kind, version, exportedAt, memories, sessions?}`. Transcrições só
   entram se o usuário marcar "Incluir transcrições".
2. **Tema:** aba Aparência, "Exportar tema…" gera o JSON do tema vigente.
3. **Pacote completo (main):** `buildFullBackup` em
   `src/main/security/dataLifecycle.ts` monta
   `{app:'absolem', kind:'absolem-backup', version:1, exportedAt, theme, config, memory}`.
   O chamador passa o resultado da exportação de memória, o snapshot do
   `config.json` e o tema; a função não escreve em disco.

A interface ainda não tem um botão único "exportar tudo"; o serviço existe e
está testado (`src/main/security/data-lifecycle.test.ts`). Enquanto o botão não
existe, o usuário exporta memória e tema separadamente e pode copiar
`config.json`. Isso fica registrado como evolução de UI, não como dado perdido:
nada é apagado por exportar.

## 4. Apagar tudo

### 4.1 Pela tela de memória

Aba Memória > "Apagar tudo" exige o texto literal `APAGAR TUDO`. Ela remove
memórias, reconstrói o FTS, roda `VACUUM` e, se marcado, remove turnos e
sessões. Não apaga logs, auditoria, cache, chave ou configuração.

### 4.2 Purge completo (main)

`purgeAppData` em `src/main/security/dataLifecycle.ts` exige o mesmo texto
`APAGAR TUDO`. Ele:

1. chama o `close` injetado (fecha o banco antes de remover o arquivo);
2. remove os alvos conhecidos: banco (`memory.sqlite` e WAL/SHM), `logs`,
   `audit`, `captures`, caches do Chromium, `config.json`, `secrets.bin`,
   `scripts` e `Crashpad`;
3. nunca remove o diretório `userData` inteiro nem caminho fora dele;
4. devolve `{ ok, removed, error? }` e é idempotente.

O procedimento de suporte, com o app fechado:

```powershell
# 1. Feche o Absolem pela bandeja (Sair).
# 2. Confirme o caminho e faça backup se quiser manter algo.
$ud = Join-Path $env:APPDATA 'absolem'
# 3. Apague os alvos conhecidos (não use caminho fora de $ud).
Remove-Item "$ud\memory.sqlite*","$ud\logs","$ud\audit","$ud\config.json","$ud\secrets.bin" -Recurse -Force -ErrorAction SilentlyContinue
```

Na primeira abertura seguinte, o app recria `config.json` com defaults, recria
o schema vazio do banco e mostra a primeira configuração. Nenhum dado antigo
volta.

### 4.3 O que "apagar" significa

- Exclusão lógica e remoção do arquivo, seguida de `VACUUM` quando o banco é
  mantido.
- Backups do Windows, sombras de volume ou ferramentas de recuperação podem
  conter páginas antigas. Apagar não é garantia forense.
- O banco não é cifrado; a ACL do perfil é a proteção da v1. SQLCipher é
  decisão futura.

## 5. Evidência automatizada

`src/main/security/data-lifecycle.test.ts` cobre, só com diretórios
temporários:

1. **apagar tudo remove banco e logs** (também auditoria, cache, capturas,
   config e chave);
2. **confirmação errada não apaga nada**;
3. **VACUUM reduz o arquivo** depois de remover 300 memórias;
4. **retenção de auditoria** remove evento com mais de 90 dias;
5. **reinício não ressuscita dados** (reabre o banco vazio e sem logs/auditoria);
6. **exportação completa** contém memória, config e tema.

O teste manual de apagar pela interface e reiniciar o app fica pendente quando
não houver ambiente interativo; o comportamento de reinício já é exercitado no
teste com reabertura real do SQLite.
