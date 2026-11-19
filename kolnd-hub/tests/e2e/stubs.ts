import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

/**
 * Stubs de `winget.exe`/`msiexec.exe` para o smoke E2E (task 04-4.1).
 *
 * O Hub invoca `winget` via `spawn('winget', args)` SEM shell; no Windows isso
 * exige um PE de verdade no PATH — um `.cmd`/`.bat`/`.exe` de texto seria
 * rejeitado pelo CreateProcess. Por isso os stubs são compilados aqui com o
 * Add-Type do PowerShell (precisa do .NET Framework, presente em todo Windows
 * suportado). Cada stub apenas anexa `<nome> <args>` a `stubs.log` e sai com 0.
 *
 * `stubs.log` fica ao lado dos stubs: o smoke assert que ele NÃO existe (ou
 * está vazio) — prova de que o fluxo abrir→dashboard→modal não tocou
 * winget/msiexec.
 */

export interface StubInfo {
  /** Diretório com os stubs (vai PREFIXADO no PATH do app no smoke). */
  stubsDir: string
  /** Log de invocações — ausente/vazio significa "nenhum stub chamado". */
  stubsLog: string
}

// Fonte C# do stub. %NAME% é substituído pelo nome do programa (winget/msiexec).
// O caminho do log é embutido na compilação (sem depender de env propagation).
const STUB_SOURCE = `
using System;
public static class StubProgram
{
    public static int Main(string[] args)
    {
        try
        {
            System.IO.File.AppendAllText(
                @"%LOG_PATH%",
                "%NAME% " + string.Join(" ", args) + "\\n");
        }
        catch { /* nunca falhar: stub de diagnóstico, não de lógica */ }
        return 0;
    }
}`

function compileStub(name: 'winget' | 'msiexec', stubsDir: string, logPath: string): boolean {
  const source = STUB_SOURCE.replace('%LOG_PATH%', logPath.replace(/\\/g, '\\\\')).replace(
    /%NAME%/g,
    name
  )
  const exePath = join(stubsDir, `${name}.exe`)
  // Add-Type via stdin-less file: escreve o fonte temporário e compila.
  const sourcePath = join(stubsDir, `${name}.stub.cs`)
  try {
    writeFileSync(sourcePath, source, 'utf8')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${sourcePath}') -OutputAssembly '${exePath}'`
      ],
      { stdio: 'pipe', timeout: 60_000 }
    )
    return true
  } catch {
    return false
  }
}

// Stub do CLI do Tailscale: `tailscale status --json` devolve um nó conectado
// com IP fixo na faixa 100.64/10. Permite o E2E do "Modo remoto" sem instalar
// VPN nenhuma — o app lê o JSON e segue o caminho real de sucesso.
const TAILSCALE_STUB_SOURCE = `
using System;
public static class TailscaleStub
{
    public static int Main(string[] args)
    {
        Console.WriteLine(@"{""BackendState"":""Running"",""Self"":{""HostName"":""e2e-pc"",""DNSName"":""e2e-pc.tail.ts.net."",""TailscaleIPs"":[""100.101.102.103""],""Online"":true},""CurrentTailnet"":{""MagicDNSSuffix"":""tail.ts.net""},""Peer"":{}}");
        return 0;
    }
}`

/** Compila `tailscale.exe`; falha aqui só impede o E2E do modo remoto. */
function compileTailscaleStub(stubsDir: string): void {
  const sourcePath = join(stubsDir, 'tailscale.stub.cs')
  const exePath = join(stubsDir, 'tailscale.exe')
  try {
    writeFileSync(sourcePath, TAILSCALE_STUB_SOURCE, 'utf8')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${sourcePath}') -OutputAssembly '${exePath}'`
      ],
      { stdio: 'pipe', timeout: 60_000 }
    )
  } catch {
    console.warn(
      '[e2e/stubs] Falha ao compilar tailscale.exe — o E2E do modo remoto seguirá bloqueado'
    )
  }
}

/** Cria o diretório de stubs e os executáveis. Compilação falhando não derruba o setup: */
export function createStubs(rootDir: string): StubInfo {
  const stubsDir = join(rootDir, 'stubs')
  mkdirSync(stubsDir, { recursive: true })
  const stubsLog = join(stubsDir, 'stubs.log')

  for (const name of ['winget', 'msiexec'] as const) {
    const ok = compileStub(name, stubsDir, stubsLog)
    if (!ok) {
      // Fallback: arquivo-placeholder (NÃO executável de verdade). O smoke não
      // invoca nenhum dos dois; se invocado, `spawn` falha e o fluxo que o
      // chamou reporta erro — comportamento aceitável para um stub ausente.
      writeFileSync(
        join(stubsDir, `${name}.exe`),
        `stub de ${name} não compilado (Add-Type indisponível)\n`,
        'utf8'
      )
      console.warn(`[e2e/stubs] Falha ao compilar stub ${name}.exe — usando placeholder`)
    }
  }

  compileTailscaleStub(stubsDir)

  return { stubsDir, stubsLog }
}
