# Patch `moonlight-stdatomic-guards.patch`

> Documento de referência do patch aplicado em tempo de build no submódulo
> `kloud-games/third-party/moonlight-common-c`.
> Mantido junto com a tarefa `gerente/tasks/2.0/12-12.4-patch-stdatomic-documentado.md`.
> **Docs pt-BR.** Nenhuma publicação upstream foi feita — ver a seção
> [Proposta upstream (NÃO enviada)](#proposta-upstream-não-enviada).

## Propósito

O `moonlight-common-c` é uma biblioteca **C** cujos headers públicos foram escritos sem
`extern "C"`. Quando esses headers são incluídos a partir de uma translation unit **C++**
(como acontece no Kloud Games, que compila partes em C++ com GCC 16/UCRT64), o compilador
gera mangling C++ para os símbolos declarados — e a linkagem com os objetos compilados em C
falha. Além disso, headers que incluem `<stdatomic.h>` (p.ex. `LinkedBlockingQueue.h`,
`PlatformThreads.h`, `Limelight-internal.h`) não são aceitos em TU C++ com GCC 16.

O patch `kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch` (6121 bytes) adiciona,
em cada header tocado, os guards:

```c
#ifdef __cplusplus
extern "C" {
#endif
...
#ifdef __cplusplus
}
#endif
```

Efeito: os headers passam a ser utilizáveis a partir de C++ (linkagem C correta) sem mudar
nenhum comportamento em TU C. **Nenhum código funcional é alterado** — apenas prolog/epilog
de linkage nos headers.

## Headers tocados (12 arquivos)

| Arquivo | Observação |
| --- | --- |
| `src/ByteBuffer.h` | guard `__cplusplus` após `#pragma once` |
| `src/Input.h` | idem |
| `src/Limelight-internal.h` | guard após os includes (`<enet/enet.h>`, `<stdatomic.h>`) |
| `src/LinkedBlockingQueue.h` | guard após `<stdatomic.h>` |
| `src/Platform.h` | idem |
| `src/PlatformCrypto.h` | idem |
| `src/PlatformSockets.h` | idem |
| `src/PlatformThreads.h` | guard após `<stdatomic.h>` |
| `src/RtpAudioQueue.h` | idem |
| `src/RtpVideoQueue.h` | idem |
| `src/Rtsp.h` | guard no topo (arquivo não tem `#pragma once`) |
| `src/Video.h` | idem |

## Onde vive e quem aplica

- **Patch:** `kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch`
- **Aplicador:** `kolnd-hub/scripts/build-kloud-games.ps1` (seção "Local patch", ~linhas
  173–194 no momento em que este doc foi escrito) — aplicado **a cada build** sobre
  `kloud-games/third-party/moonlight-common-c`.
- **Submódulo:** `moonlight-common-c`, pinado em `eac4c469c755dc4fcf6c4bac12e17c0d78881fb7`
  (`eac4c46`, "Fix multi-waiter cases for Lbq and PLT_EVENT", 2026-11-11 — commit presente
  no upstream).
- **O patch NÃO está commitado no submódulo.** Ele é aplicado por cima do pino a cada
  build, por decisão de projeto (o fork local não é publicado).

### Máquina de estados do build (idempotência)

A cada build, o script executa, nesta ordem:

1. `git -C <submódulo> log --oneline -1` — log informativo do commit atual do submódulo
   (adicionado na tarefa 12.4; só observabilidade, não afeta a decisão).
2. `git -C <submódulo> apply --reverse --check <patch>`
   - **exit 0** → o patch já está aplicado → loga `patch moonlight-stdatomic-guards: ja aplicado` e segue.
3. Senão: `git -C <submódulo> apply --check <patch>`
   - **exit != 0** → o contexto do patch não bate com o estado atual do submódulo
     (drift upstream, pino alterado, ou patch corrompido) → **`throw`** com mensagem que
     aponta este documento (`docs/patches.md`) e o runbook de regeneração.
4. Senão: `git -C <submódulo> apply <patch>` e loga `patch moonlight-stdatomic-guards: aplicado`.

### Mensagem exata do `throw` (atual, enriquecida na tarefa 12.4)

```
Nao foi possivel aplicar o patch de stdatomic/extern "C" no moonlight-common-c.
Commit do submodulo: <saida de `git -C <submodulo> log --oneline -1`>.
O patch em kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch nao se aplica mais
(drift upstream ou pino alterado). Consulte docs/patches.md (secao "Runbook de
regeneracao") para regenerar o patch. NAO contorne: regenere o patch ou reverta o pino.
```

(Antes da tarefa 12.4 a mensagem era apenas
`Nao foi possivel aplicar o patch de stdatomic/extern "C" no moonlight-common-c.`)

### Consequências da falha

- O script aborta **antes** de compilar o Kloud Games.
- **O MSI (instalador `kloud-games.msi`) não é gerado.**
- Nenhum artefato parcial é publicado (o build morre na fase de preparação de submódulos).
- O submódulo fica intacto (o `--check` não escreve nada; o `apply` só roda se o check passa).

## Runbook de regeneração

Use quando o `throw` acima disparar (drift upstream, pino alterado, ou patch corrompido).
**Não contorne o erro** (não edite headers à mão no submódulo esperando que o build passe —
o estado do submódulo é descartável e recriado pelo build).

1. **Verifique o estado do submódulo** — pode haver mudanças não commitadas geradas pelo
   próprio build (o build aplica o patch a cada execução; se uma execução anterior
   aplicou e não foi revertida, há diff pendente):
   ```powershell
   git -C kloud-games/third-party/moonlight-common-c status
   ```
   Se houver mudanças não commitadas e você estiver regenerando o patch, guarde-as antes:
   ```powershell
   git -C kloud-games/third-party/moonlight-common-c stash
   ```
   (O usuário pode descartar essas mudanças após o MSI ser gerado — elas são recriadas a
   cada build. Confirme com o usuário antes de descartar.)
2. **Aplique/avalie o patch à mão** para ver o que falha:
   ```powershell
   git -C kloud-games/third-party/moonlight-common-c apply --check kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch
   git -C kloud-games/third-party/moonlight-common-c apply kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch
   ```
   Se o contexto mudou por drift upstream, ajuste os hunks manualmente (mesmo tipo de
   edição: adicionar os guards `#ifdef __cplusplus` / `extern "C"` nos mesmos 12 headers).
3. **Regenere o patch** a partir do submódulo:
   ```powershell
   git -C kloud-games/third-party/moonlight-common-c diff > kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch
   ```
4. **Valide em clone/cópia limpa** (nunca no submódulo real com estado sujo):
   ```powershell
   git clone <url-do-fork-ou-upstream> %TEMP%\mcc-limpo
   git -C %TEMP%\mcc-limpo checkout eac4c469c755dc4fcf6c4bac12e17c0d78881fb7
   git -C %TEMP%\mcc-limpo apply --check kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch
   ```
   `git apply --check` deve sair com código 0. Apague a cópia ao final.
5. **Rode o build completo** e confirme o MSI:
   ```powershell
   .\kolnd-hub\scripts\build-kloud-games.ps1
   ```
   Verifique nos logs `patch moonlight-stdatomic-guards: aplicado` (ou `ja aplicado`) e a
   geração do instalador.
6. Se o upstream aceitou o fix (ver seção seguinte), o caminho correto é **remover o
   patch e o passo do build**, não regenerar — decisão do usuário/mantenedor.

### Alternativa: `git apply --3way`

O plano da tarefa 12.4 mencionou `--3way` como fallback. **Decisão: não usar como fallback
automático no build.** O 3-way pode aplicar o patch "limpo" em contexto divergente sem que
ninguém veja (merge semântico incorreto silencioso). Prefira falha barulhenta + este
runbook. O `--3way` pode ser usado manualmente durante a regeneração (passo 2), desde que o
resultado seja revisado no diff antes de sobrescrever o `.patch`.

## Achados upstream (pesquisa em 2026-11-16)

Pergunta: o fix (`extern "C"` / guards `__cplusplus` nos headers) já existe upstream em
`moonlight-stream/moonlight-common-c`?

**Resposta: não.** Evidências verificadas em 2026-11-16:

1. **Headers do branch `master` não têm os guards.** Verificado via
   `raw.githubusercontent.com/moonlight-stream/moonlight-common-c/master/src/ByteBuffer.h`
   e `.../src/PlatformThreads.h` — ambos sem `extern "C"` / `#ifdef __cplusplus`
   (acesso em 2026-11-16).
2. **Commit history (master):** commits mais recentes são de 2026-11-13
   (p.ex. `94c65fd` "Remove references to the deprecated Chrome client",
   `67996ec` "Improve check for clock_gettime()", `a879f89` "Change sleep duration to unsigned").
   Nenhum commit menciona `extern "C"` ou guards de linkage C++.
   - Nota: `eac4c46` (nosso pino) aparece no history upstream em 2026-11-11
     ("Fix multi-waiter cases for Lbq and PLT_EVENT", autor cgutman).
   - O master upstream **já divergiu do pino**: `a879f89` ("Change sleep duration to
     unsigned", 2026-11-13) altera `PlatformThreads.h` (`PltSleepMs(int)` → `uint32_t`),
     o que por si só já invalidaria o contexto do nosso patch contra o master atual. O
     patch continua válido apenas contra o pino `eac4c46`.
3. **Issues/PRs:** busca `extern "C"` no repositório retorna **0 issues** e nenhum PR
   relevante (busca no GitHub em 2026-11-16).
4. **Releases:** o repositório **não tem releases publicadas**
   ("There aren't any releases here") — não há release notes para consultar.
5. O contexto GCC 16/UCRT64 é recente (GCC 16 é de 2026); não há evidência de que o
   upstream tenha tratado o problema até 2026-11-16.

Links verificados (2026-11-16):

- https://github.com/moonlight-stream/moonlight-common-c — repo (sem releases)
- https://github.com/moonlight-stream/moonlight-common-c/commits/master — history
- https://raw.githubusercontent.com/moonlight-stream/moonlight-common-c/master/src/ByteBuffer.h — sem guards
- https://raw.githubusercontent.com/moonlight-stream/moonlight-common-c/master/src/PlatformThreads.h — sem guards
- https://github.com/moonlight-stream/moonlight-common-c/search?q=extern+%22C%22&type=issues — 0 resultados

**Conclusão:** o patch continua necessário; o caminho correto é propor o fix upstream
(seção seguinte) ou manter o runbook de regeneração como procedimento oficial.

## Proposta upstream (NÃO enviada)

> **Status: rascunho pronto, NÃO enviado.** O envio (issue ou PR) para
> `moonlight-stream/moonlight-common-c` depende de **aprovação explícita do usuário** —
> incluindo a identidade usada para publicar (conta pessoal vs. organização) e se vai
> como issue ou como PR com branch. Nada foi publicado em nome de ninguém.
>
> T6 (preparar branch/PR e aguardar CI upstream) só pode ser executada após essa
> aprovação explícita. Se a aprovação não vier, este runbook permanece o procedimento
> oficial e o patch continua sendo aplicado em build time.

### Texto proposto do issue/PR

---

**Título:** `Add extern "C" / __cplusplus guards to public headers so they can be included from C++ TUs`

**Corpo:**

Hi Moonlight team,

We build moonlight-common-c into a C++ application (Kloud Games, a Windows game client built
with GCC 16 / UCRT64) and hit compile errors because the public headers use C linkage
declarations without `extern "C"` guards. When these headers are included from a C++
translation unit, the declarations get C++ mangling and don't link against the C objects —
and with GCC 16, headers that include `<stdatomic.h>` are rejected outright in C++ mode.

The fix is mechanical: wrap each public header body in

```c
#ifdef __cplusplus
extern "C" {
#endif
...
#ifdef __cplusplus
}
#endif
```

with no functional change in C mode. It touches these 12 headers (`src/`):
`ByteBuffer.h`, `Input.h`, `Limelight-internal.h`, `LinkedBlockingQueue.h`, `Platform.h`,
`PlatformCrypto.h`, `PlatformSockets.h`, `PlatformThreads.h`, `RtpAudioQueue.h`,
`RtpVideoQueue.h`, `Rtsp.h`, `Video.h`.

We carry this as a local patch (applied at build time) in our fork pipeline
(Kolnd/Sunshine fork, used by the Kloud Games client). The full patch is attached below —
it's a pure linkage/prolog-epilog change and should be safe to merge as-is.

```diff
<PASTE_OF_moonlight-stdatomic-guards.patch>
```

Would you consider merging guards like this (or telling us the preferred approach)? If
accepted, we can drop our local patch and build against upstream directly.

Attribution: the patch was authored in the Kolnd fork pipeline (Kloud Games project);
happy to re-submit as a signed PR from a maintained branch if that's preferred.

Thanks!

---

### O que falta para enviar (decisão do usuário)

1. **Aprovação explícita** para publicar (issue vs. PR; e com qual conta/identidade).
2. Se PR: criar branch no fork (`kolnd-games-upstream` ou similar), commitar **apenas os
   guards** (não o pino atual), abrir PR contra `moonlight-stream/moonlight-common-c`.
3. Anexar/colar o patch (`kolnd-hub/scripts/patches/moonlight-stdatomic-guards.patch`)
   na descrição.
4. Após merge upstream: remover o patch e o passo do build, e bumpar o pino — decisão
   separada, relacionada à tarefa 12.3 (sync trimestral).
