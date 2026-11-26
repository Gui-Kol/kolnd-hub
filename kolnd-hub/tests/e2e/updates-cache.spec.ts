import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Cache da aba Atualizações (task 04 do plano de otimização de recursos).
 *
 * Prova, contra o app Electron real, que reabrir a aba em < 10 min NÃO roda o
 * winget de novo e que "Verificar novamente" sempre força uma consulta real.
 *
 * O stub de `stubs.ts` é compartilhado entre specs; para não contaminar o
 * `smoke.spec.ts` (que exige `stubs.log` vazio), esta spec compila um
 * `winget.exe` próprio num diretório temporário e grava num log PRIVADO. O stub
 * responde JSON válido ao probe `--output json` — o caminho de sucesso que
 * popula o cache.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

const STUB_SOURCE = `
using System;
public static class WingetCacheStub
{
    public static int Main(string[] args)
    {
        try
        {
            System.IO.File.AppendAllText(
                @"%LOG_PATH%",
                "winget " + string.Join(" ", args) + "\\n");
        }
        catch { /* diagnóstico: nunca falhar por causa do log */ }
        string joined = string.Join(" ", args);
        if (joined.Contains("--version"))
        {
            Console.WriteLine("v1.9.0");
            return 0;
        }
        if (joined.Contains("--output json"))
        {
            Console.WriteLine(@"[{""PackageIdentifier"":""Git.Git"",""PackageName"":""Git"",""Version"":""2.55.0"",""AvailableVersion"":""2.56.0""}]");
            return 0;
        }
        Console.WriteLine("Nenhuma atualização disponível.");
        return 0;
    }
}`

/** Compila o stub dedicado no diretório temporário da spec. */
function createWingetStub(stubsDir: string, logPath: string): void {
  const source = STUB_SOURCE.replace('%LOG_PATH%', logPath.replace(/\\/g, '\\\\'))
  const sourcePath = join(stubsDir, 'winget.stub.cs')
  const exePath = join(stubsDir, 'winget.exe')
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
}

test('Atualizações: cache na reativação em < 10 min e força no botão', async () => {
  test.setTimeout(120_000)
  const ctx = loadContext()
  const stubsDir = mkdtempSync(join(tmpdir(), 'kolnd-updates-cache-'))
  // Log privado da spec: nada é escrito no `stubs.log` compartilhado.
  const logPath = join(stubsDir, 'winget.log')
  createWingetStub(stubsDir, logPath)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
    PATH: `${stubsDir}${delimiter}${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_ENV

  const app = await electron.launch({ args: ['.'], env })
  const window = await app.firstWindow()
  try {
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    const countWinget = (): number => {
      if (!existsSync(logPath)) return 0
      return readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('winget ')).length
    }
    const openPc = async (): Promise<void> => {
      await window.getByRole('button', { name: 'Meu PC' }).click()
      await expect(window.getByText('Manutenção e inicialização do seu PC')).toBeVisible({
        timeout: 15_000
      })
    }
    const openUpdates = async (): Promise<void> => {
      await window.getByRole('tab', { name: 'Atualizações' }).click()
      await expect(window.getByRole('tab', { name: 'Atualizações' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      // Lista renderizada = IPC concluído (consulta real ou cache hit).
      await expect(window.getByRole('heading', { name: '1 atualização disponível' })).toBeVisible({
        timeout: 15_000
      })
    }

    const initial = countWinget()
    await openPc()
    await openUpdates()
    const firstDelta = countWinget() - initial
    expect(firstDelta).toBeGreaterThan(0)

    // Sair de Meu PC desmonta a página; voltar e abrir a aba em < 10 min deve
    // ser atendido pelo cache do main — zero invocações de winget.
    await window.getByRole('button', { name: 'Ferramentas' }).click()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 15_000
    })
    await openPc()
    const beforeSecond = countWinget()
    await openUpdates()
    expect(countWinget() - beforeSecond).toBe(0)

    // Botão manual: ignora o cache e roda o winget de verdade.
    const beforeForce = countWinget()
    await window.getByRole('button', { name: 'Verificar novamente' }).click()
    await expect.poll(() => countWinget() - beforeForce, { timeout: 15_000 }).toBeGreaterThan(0)
  } finally {
    await app.close().catch(() => {
      try {
        app.process().kill()
      } catch {
        // processo já encerrado
      }
    })
    try {
      rmSync(stubsDir, { recursive: true, force: true })
    } catch {
      // exe ainda preso: o SO limpa o tmp depois
    }
  }
})
