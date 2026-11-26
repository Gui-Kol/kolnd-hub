# Assinatura de codigo - Absolem

## Estado na v1: NAO assinado

O executavel do Absolem **nao e assinado** na v1. **Nao ha assinatura de codigo**
(no `electron-builder.yml`, **nenhum** `certificateFile`, `signtool`, `signingHashAlgorithms`,
`publisherName`, certificado, `CSC_*`/`WIN_CSC_*`, `electron-builder` `sign`, `signAndEditExecutable`
ativo; nada de segredo no git). **Nao implementar agora**; nenhuma etapa de assinatura foi adicionada.

- **SmartScreen:** o Windows pode mostrar "aplicativo nao reconhecido" / "Microsoft Defender
  SmartScreen impediu..." porque o `.exe` nao e assinado e **nao tem reputacao**. Esperado na v1.
  O usuario prossegue com "Mais informacoes" -> "Executar assim mesmo" **somente apos conferir
  o SHA-256**. Nao ha verificacao de reputacao.
- **Instalador/desinstalador:** `installerIcon`/`uninstallerIcon` so visual. Sem assinar. O aviso
  de SmartScreen tambem pode aparecer no desinstalador; coerente com o README e o checklist.
- **NSIS per-user:** sem Administrador; `appId com.kolnd.absolem`; `perMachine=false`;
  `deleteAppDataOnUninstall=false`. Sem assinatura nao muda dados preservados.

## Conferir SHA-256 (mitigacao obrigatoria)

App nao assinado => **integridade por checksum**. **SHA-256 obrigatorio.**

```powershell
Get-FileHash -Algorithm SHA256 ".\Absolem Setup <versao>.exe"
```

Compare com `Absolem Setup <versao>.exe.sha256` (formato `<hash>  <arquivo>`, minusculo) gerado
por `scripts/hash-artifact.ps1` e com o `<hash>` em `dist/release-notes.md`. **Divergiu? Nao
instale.** Ver `docs/RELEASE.md`. Regex: `^[a-f0-9]{64}`. **Antes de assinar no futuro, gerar o
checksum do artefato assinado** (o hash final publicado deve ser do `.exe` final).

## Futuro (nao implementado) - assinatura OV/EV + timestamp

Para remover/reduzir SmartScreen no futuro (decisao do usuario; custo e processo a parte):

1. **Certificado de assinatura de codigo** (Windows). **OV** (Organization Validation) vs
   **EV** (Extended Validation):
   - **OV**: validacao da organizacao; **constroi reputacao SmartScreen** ao longo do tempo;
     custo menor que EV; pode precisar de reputacao inicial.
   - **EV**: validacao estendida; **reduz a friccao inicial do SmartScreen**; em token
     USB/HSM ou nuvem; **custo maior**. **EV vs OV e decisao do usuario.**
2. **Provedor / Azure Trusted Signing** (nuvem, sem token USB/HSM) **vs certificado
   tradicional** (PFX/HSM). **Custo, fornecedor e conta sao decisao do usuario**; **nenhuma
   credencial/segredo em git** (segredos fora do repo, injetados no ambiente de release).
3. **Timestamp (carimbo de tempo)**: assinar com servidor de **timestamp RFC 3161** (e o
   timestamp dual-assinatura para `SHA256`, ex. `/tr <url> /td SHA256` + `/t`, `signtool sign
... /fd SHA256 /tr <url> /td SHA256`) para a assinatura continuar valida **apos o
   certificado expirar**. Detalhes do `signtool`/`electron-builder` so quando implementar.
4. **O que assinar**: o **instalador NSIS** `Absolem Setup <versao>.exe`, o
   **desinstalador**, o `Absolem.exe`, e o **`better_sqlite3.node`** (modulo nativo) - decisao
   do usuario; **`electron-builder` `win.sign`** (`signtool`) injetado por ambiente, nao
   commitado. **Gerar SHA-256 do artefato final assinado.**
5. **Verificar**: `Get-AuthenticodeSignature "<artefato>"` -> `Status: Valid`, **timestamp**
   presente; re-gerar e reconferir `.sha256` **depois** de assinar. SmartScreen reputacao com o tempo.
6. **Custo**: certificado OV/EV (anual) ou Azure Trusted Signing (uso), timestamp, processo de
   release seguro. **Nao implementar agora.**

## Notas honestas

- Sem assinatura, **SHA-256 e a unica garantia de integridade**; nao substitui confianca de
  origem. Confira a fonte de download.
- **Nada de promessa de SmartScreen limpo.** Sem reputacao na v1.
- Docs coerentes: `README.md`, `docs/FIRST-RUN-CHECKLIST.md`, `docs/RELEASE.md`, instalador.
