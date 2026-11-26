import { app } from 'electron'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import { logger } from '../logger'
import { runPowerShellCommand, runProcess, type ProcessResult } from '../hwmon/powershell'
import { resolvePowershellPath } from '../hwmon/systemPaths'
import { isUacCancelled } from '../hwmon/uac'
import {
  buildStageScript,
  FPS_AGENT_SCRIPT_VERSION,
  isPresentMonBinary,
  PRESENTMON_FILE,
  PRESENTMON_LEGACY_SESSION_NAME,
  PRESENTMON_SESSION_NAME,
  PRESENTMON_SHA256,
  PRESENTMON_SIZE,
  PRESENTMON_VERSION,
  resolveBundledPresentMon
} from './engine'
import {
  captureAgentDir,
  captureBinDir,
  captureErrorPath,
  captureLatestPath,
  captureStopPath,
  captureStagedScriptPath,
  FPS_CAPTURE_TASK_NAME,
  FPS_MANIFEST_FILE,
  FPS_SINK_STALE_MS,
  FPS_WINDOW_MS,
  resolveCaptureDir,
  resolveFpsSinkDir,
  resolveHeartbeatPath
} from './paths'

/**
 * Agente elevado de captura de FPS (tarefa `KolndHubFpsCapture`).
 *
 * Mesmo desenho do agente de sensores: a tarefa roda no logon com `HIGHEST`,
 * um PowerShell persistente fica IDLE (sem ETW) até o main publicar um
 * heartbeat de 2 s, e o processo elevado lê o stdout do PresentMon, agrega por
 * PID em janelas de 1 s e grava `%ProgramData%\Kolnd Hub\capture\latest.json`.
 *
 * O tap embutido é C# SEM ETW próprio: só lê linhas de CSV e chama
 * `GetForegroundWindow`/`GetWindowThreadProcessId`. A sessão ETW pertence ao
 * PresentMon, com nome próprio; `--stop_existing_session` só limpa esse nome —
 * por isso o script também para a sessão legada `KolndHubFps`, que na T0
 * (órfã) causou 381 mil eventos perdidos.
 *
 * Instalar/remover é SEMPRE ação explícita do usuário (um UAC). Nada roda no
 * first-run/logon antes disso, e recusar o UAC não altera nada.
 */

const FPS_AGENT_UAC_TIMEOUT_MS = 120_000
const FPS_AGENT_QUERY_TIMEOUT_MS = 8_000
const FPS_AGENT_READY_TIMEOUT_MS = 8_000
const FPS_AGENT_MAX_LINES_PER_SECOND = 20_000
const FPS_AGENT_MAX_PIDS = 64

// ── Caminhos válidos ────────────────────────────────────────────

function hasUnsafeChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

function isSafeCommandPath(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && isAbsolute(value) && !hasUnsafeChars(value)
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function psArgList(values: string[]): string {
  return values.map((value) => `'${psQuote(value)}'`).join(' ')
}

// ── Tarefa agendada ─────────────────────────────────────────────

export interface FpsAgentTaskOptions {
  /** Script supervisor (cópia protegida em ProgramData é a que a tarefa executa). */
  scriptPath: string
  captureDir?: string
  taskName?: string
}

function buildFpsAgentAction(options: FpsAgentTaskOptions): string {
  if (!isSafeCommandPath(options.scriptPath)) {
    throw new Error('Caminho inválido para a tarefa de captura de FPS.')
  }
  // `\"` é o escape que o `schtasks /TR` entende para aspas internas; com aspas
  // cruas ele corta o valor no primeiro espaço de "Kolnd Hub".
  return `\\"${resolvePowershellPath()}\\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${options.scriptPath}\\"`
}

export function buildFpsAgentCreateArgs(options: FpsAgentTaskOptions): string[] {
  return [
    '/Create',
    '/TN',
    options.taskName ?? FPS_CAPTURE_TASK_NAME,
    '/TR',
    buildFpsAgentAction(options),
    '/SC',
    'ONLOGON',
    '/RL',
    'HIGHEST',
    '/F'
  ]
}

export function buildFpsAgentDeleteArgs(taskName: string = FPS_CAPTURE_TASK_NAME): string[] {
  return ['/Delete', '/TN', taskName, '/F']
}

/**
 * Interpreta `schtasks /Query`. `true` = existe, `false` = não existe,
 * `null` = não deu para saber.
 */
export function interpretFpsAgentQuery(
  result: ProcessResult,
  taskName: string = FPS_CAPTURE_TASK_NAME
): boolean | null {
  if (result.timedOut) return null
  const output = `${result.stdout}\n${result.stderr}`
  if (result.code === 0) {
    const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`TaskName:\\s*\\\\?${escaped}`, 'i').test(output) ? true : null
  }
  if (
    /cannot find|does not exist|n[ãa]o (?:é|e|foi )?poss[íi]vel encontrar|n[ãa]o pode (?:ser )?encontrar|n[ãa]o existe/i.test(
      output
    )
  ) {
    return false
  }
  return null
}

// ── Script supervisor + tap C# (sem ETW próprio) ────────────────

/**
 * Tap C# do agente. Compilado por `Add-Type` no processo elevado.
 *
 * Responsabilidades: iniciar/parar o PresentMon conforme o heartbeat, ler o
 * stdout linha a linha, agregar por PID em uma janela e gravar o JSON atômico.
 * NÃO abre sessão ETW (quem abre é o PresentMon), NÃO usa console e nunca deixa
 * o filho órfão: o `finally` do PowerShell também para a sessão.
 *
 * C# 5 de propósito (compilador do .NET Framework do PowerShell 5.1).
 */
const FPS_TAP_SOURCE =
  String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class KolndFpsTap
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private sealed class Agg
    {
        public string Name;
        public long Presents;
        public double MsSum;
        public long MsCount;
    }

    private static readonly object Gate = new object();
    private static Dictionary<int, Agg> current = new Dictionary<int, Agg>();
    private static int colApp = -1;
    private static int colPid = -1;
    private static int colMs = -1;
    private static volatile bool stopReader;
    private static string readerError;
    private static long linesInWindow;
    private static int maxPids = 64;
    private static string sessionName = "KolndHubFpsCapture";

    public static int Run(string exe, string args, string latest, string heartbeat, string stop, string errorPath, string sessionNameValue, string engineVersion, int intervalMs, int maxPidsValue)
    {
        maxPids = maxPidsValue > 0 ? maxPidsValue : 64;
        sessionName = string.IsNullOrEmpty(sessionNameValue) ? "KolndHubFpsCapture" : sessionNameValue;
        Process proc = null;
        Thread reader = null;
        try
        {
            while (!File.Exists(stop))
            {
                if (!HeartbeatFresh(heartbeat, 5000))
                {
                    StopProc(ref proc, ref reader);
                    Thread.Sleep(500);
                    continue;
                }
                if (proc == null || proc.HasExited)
                {
                    StopProc(ref proc, ref reader);
                    StartProc(ref proc, ref reader, exe, args);
                }
                Thread.Sleep(intervalMs);
                if (File.Exists(stop)) break;
                if (!HeartbeatFresh(heartbeat, 5000)) continue;
                if (!string.IsNullOrEmpty(readerError))
                {
                    WriteError(errorPath, readerError);
                    StopProc(ref proc, ref reader);
                    Thread.Sleep(1000);
                    continue;
                }
                Flush(latest, engineVersion, intervalMs);
            }
        }
        catch (Exception ex)
        {
            WriteError(errorPath, ex.ToString());
        }
        finally
        {
            StopProc(ref proc, ref reader);
        }
        return 0;
    }

    private static bool HeartbeatFresh(string path, int staleMs)
    {
        try
        {
            if (!File.Exists(path)) return false;
            DateTime stamp = File.GetLastWriteTimeUtc(path);
            return (DateTime.UtcNow - stamp).TotalMilliseconds <= staleMs;
        }
        catch
        {
            return false;
        }
    }

    private static void StartProc(ref Process proc, ref Thread reader, string exe, string args)
    {
        colApp = -1;
        colPid = -1;
        colMs = -1;
        readerError = null;
        Interlocked.Exchange(ref linesInWindow, 0);
        lock (Gate)
        {
            current = new Dictionary<int, Agg>();
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = exe;
        psi.Arguments = args;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.WorkingDirectory = Path.GetDirectoryName(exe);

        Process p = new Process();
        p.StartInfo = psi;
        p.Start();
        proc = p;

        Thread err = new Thread(delegate() { DrainErrors(p); });
        err.IsBackground = true;
        err.Start();

        Thread r = new Thread(delegate() { ReaderThread(p); });
        r.IsBackground = true;
        r.Start();
        reader = r;
    }

    private static void DrainErrors(Process p)
    {
        try
        {
            while (p.StandardError.ReadLine() != null) { }
        }
        catch
        {
        }
    }

    private static void ReaderThread(Process p)
    {
        try
        {
            string line;
            while (!stopReader && (line = p.StandardOutput.ReadLine()) != null)
            {
                if (line.Length == 0 || line.Length > 8192) continue;
                if (colPid < 0)
                {
                    MapHeader(line);
                    continue;
                }
                if (Interlocked.Increment(ref linesInWindow) > ` +
  FPS_AGENT_MAX_LINES_PER_SECOND +
  String.raw`)
                {
                    continue;
                }
                string[] f = line.Split(',');
                int needed = Math.Max(colPid, Math.Max(colApp, colMs));
                if (f.Length <= needed) continue;

                int pid;
                if (!int.TryParse(f[colPid], NumberStyles.Integer, CultureInfo.InvariantCulture, out pid) || pid <= 0)
                {
                    continue;
                }
                double ms = 0;
                double.TryParse(f[colMs], NumberStyles.Float, CultureInfo.InvariantCulture, out ms);
                string app = f[colApp];

                lock (Gate)
                {
                    Agg agg;
                    if (!current.TryGetValue(pid, out agg))
                    {
                        if (current.Count >= maxPids) continue;
                        agg = new Agg();
                        agg.Name = app;
                        current[pid] = agg;
                    }
                    agg.Presents++;
                    if (ms > 0 && ms < 1000)
                    {
                        agg.MsSum += ms;
                        agg.MsCount++;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            readerError = "leitura do PresentMon falhou: " + ex.Message;
        }
    }

    private static void MapHeader(string line)
    {
        string[] h = line.Split(',');
        for (int i = 0; i < h.Length; i++)
        {
            string c = h[i].Trim().Trim('"');
            if (c.Equals("Application", StringComparison.OrdinalIgnoreCase)) colApp = i;
            else if (c.Equals("ProcessID", StringComparison.OrdinalIgnoreCase)) colPid = i;
            else if (c.Equals("msBetweenPresents", StringComparison.OrdinalIgnoreCase)) colMs = i;
        }
        if (colApp < 0 || colPid < 0 || colMs < 0)
        {
            throw new Exception("cabecalho do CSV sem Application/ProcessID/msBetweenPresents");
        }
    }

    private static void Flush(string latest, string engineVersion, int intervalMs)
    {
        Dictionary<int, Agg> snapshot;
        lock (Gate)
        {
            snapshot = current;
            current = new Dictionary<int, Agg>();
        }
        Interlocked.Exchange(ref linesInWindow, 0);

        uint fgPid = 0;
        IntPtr fg = GetForegroundWindow();
        if (fg != IntPtr.Zero) GetWindowThreadProcessId(fg, out fgPid);
        string fgName = ResolveName((int)fgPid, snapshot);

        List<KeyValuePair<int, Agg>> list = new List<KeyValuePair<int, Agg>>();
        foreach (KeyValuePair<int, Agg> pair in snapshot)
        {
            if (pair.Value.Presents > 0) list.Add(pair);
        }
        list.Sort(delegate(KeyValuePair<int, Agg> a, KeyValuePair<int, Agg> b)
        {
            return b.Value.Presents.CompareTo(a.Value.Presents);
        });
        if (list.Count > maxPids) list.RemoveRange(maxPids, list.Count - maxPids);

        StringBuilder sb = new StringBuilder();
        sb.Append("{\"schema\":2,\"engine\":{\"name\":\"PresentMon\",\"version\":");
        AppendJsonString(sb, engineVersion);
        sb.Append("},\"timestamp\":");
        AppendJsonString(sb, DateTime.UtcNow.ToString("o"));
        sb.Append(",\"foregroundPid\":");
        if (fgPid == 0) sb.Append("null"); else sb.Append(fgPid.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"foregroundName\":");
        AppendJsonString(sb, fgName);
        sb.Append(",\"windowMs\":").Append(intervalMs.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"pids\":[");
        for (int i = 0; i < list.Count; i++)
        {
            if (i > 0) sb.Append(',');
            Agg agg = list[i].Value;
            sb.Append("{\"pid\":").Append(list[i].Key.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"name\":");
            AppendJsonString(sb, agg.Name);
            sb.Append(",\"presents\":").Append(agg.Presents.ToString(CultureInfo.InvariantCulture));
            double avg = agg.MsCount > 0 ? agg.MsSum / agg.MsCount : 0;
            sb.Append(",\"frametimeMs\":").Append(avg.ToString("0.###", CultureInfo.InvariantCulture));
            sb.Append('}');
        }
        sb.Append("]}");
        WriteAtomic(latest, sb.ToString());
    }

    private static string ResolveName(int pid, Dictionary<int, Agg> snapshot)
    {
        Agg agg;
        if (snapshot.TryGetValue(pid, out agg) && !string.IsNullOrEmpty(agg.Name)) return agg.Name;
        try
        {
            Process p = Process.GetProcessById(pid);
            string n = p.ProcessName;
            if (!n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) n = n + ".exe";
            return n;
        }
        catch
        {
            return null;
        }
    }

    private static void AppendJsonString(StringBuilder sb, string value)
    {
        if (value == null)
        {
            sb.Append("null");
            return;
        }
        sb.Append('"');
        for (int i = 0; i < value.Length; i++)
        {
            char c = value[i];
            if (c == '"' || c == '\\')
            {
                sb.Append('\\');
                sb.Append(c);
            }
            else if (c < ' ')
            {
                sb.Append(' ');
            }
            else
            {
                sb.Append(c);
            }
        }
        sb.Append('"');
    }

    private static void WriteAtomic(string path, string content)
    {
        string tmp = path + ".tmp";
        File.WriteAllText(tmp, content, new UTF8Encoding(false));
        if (File.Exists(path))
        {
            try
            {
                File.Replace(tmp, path, null);
            }
            catch (IOException)
            {
                File.Copy(tmp, path, true);
                File.Delete(tmp);
            }
            catch (UnauthorizedAccessException)
            {
                File.Copy(tmp, path, true);
                File.Delete(tmp);
            }
        }
        else
        {
            File.Move(tmp, path);
        }
    }

    private static void WriteError(string path, string message)
    {
        try
        {
            File.WriteAllText(path, message == null ? "erro desconhecido" : message, new UTF8Encoding(false));
        }
        catch
        {
        }
    }

    private static void StopProc(ref Process proc, ref Thread reader)
    {
        bool killed = false;
        stopReader = true;
        if (proc != null)
        {
            try
            {
                if (!proc.HasExited)
                {
                    proc.Kill();
                    killed = true;
                }
            }
            catch
            {
            }
            try
            {
                proc.WaitForExit(3000);
            }
            catch
            {
            }
            try
            {
                proc.Dispose();
            }
            catch
            {
            }
            proc = null;
        }
        if (reader != null)
        {
            try
            {
                reader.Join(2000);
            }
            catch
            {
            }
            reader = null;
        }
        stopReader = false;
        // Matar o PresentMon NÃO fecha a sessão ETW no kernel: sem este stop a
        // sessão fica órfã a cada perda de heartbeat (foi a causa dos 381 mil
        // eventos perdidos da T0). Só roda quando o processo foi realmente morto.
        if (killed) StopSession();
    }

    private static void StopSession()
    {
        try
        {
            string logman = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "logman.exe");
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = logman;
            psi.Arguments = "stop \"" + sessionName.Replace("\"", "") + "\" -ets";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = false;
            psi.RedirectStandardError = false;
            Process p = Process.Start(psi);
            if (p != null)
            {
                p.WaitForExit(2000);
                try { p.Dispose(); } catch { }
            }
        }
        catch
        {
        }
    }
}
`

export interface FpsAgentScriptOptions {
  /** Cópia protegida do PresentMon (a fonte embutida nunca é executada direto). */
  presentMonPath: string
  /** Argumentos do PresentMon (padrão: PRESENTMON_ARGS). */
  args?: string
  latestPath: string
  heartbeatPath: string
  stopPath: string
  errorPath: string
  intervalMs?: number
  maxPids?: number
  engineVersion?: string
}

/**
 * Script persistente do supervisor. Fica idle (sleep de 500 ms) sem heartbeat;
 * ao ver o heartbeat fresco inicia o PresentMon, agrega e publica. O `finally`
 * para a sessão ETW própria e o C# mata o filho.
 */
export function buildFpsAgentScript(input: FpsAgentScriptOptions): string {
  if (
    !isSafeCommandPath(input.presentMonPath) ||
    !isSafeCommandPath(input.latestPath) ||
    !isSafeCommandPath(input.heartbeatPath) ||
    !isSafeCommandPath(input.stopPath) ||
    !isSafeCommandPath(input.errorPath)
  ) {
    throw new Error('Caminho inválido para o agente de FPS.')
  }
  const interval =
    Number.isInteger(input.intervalMs) && (input.intervalMs ?? 0) > 0
      ? (input.intervalMs as number)
      : FPS_WINDOW_MS
  const maxPids =
    Number.isInteger(input.maxPids) && (input.maxPids ?? 0) > 0
      ? Math.min(input.maxPids as number, FPS_AGENT_MAX_PIDS * 4)
      : FPS_AGENT_MAX_PIDS
  const args =
    input.args ??
    [
      '--v1_metrics',
      '--output_stdout',
      '--no_console_stats',
      '--session_name',
      PRESENTMON_SESSION_NAME,
      '--stop_existing_session'
    ].join(' ')
  if (/['"]/.test(args) || /[\r\n]/.test(args)) {
    throw new Error('Argumentos inválidos para o motor de FPS.')
  }
  const engineVersion = input.engineVersion ?? PRESENTMON_VERSION

  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$exe = '${psQuote(input.presentMonPath)}'`,
    `$presentmonArgs = '${psQuote(args)}'`,
    `$latest = '${psQuote(input.latestPath)}'`,
    `$heartbeat = '${psQuote(input.heartbeatPath)}'`,
    `$stop = '${psQuote(input.stopPath)}'`,
    `$errorPath = '${psQuote(input.errorPath)}'`,
    // A sessão legada pode estar órfã (T0: 381 mil eventos perdidos e o alvo
    // escondido). `--stop_existing_session` só limpa o NOME PRÓPRIO.
    `& logman.exe stop '${PRESENTMON_LEGACY_SESSION_NAME}' -ets 2>$null | Out-Null`,
    `& logman.exe stop '${PRESENTMON_SESSION_NAME}' -ets 2>$null | Out-Null`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(input.errorPath)}'`,
    "$source = @'",
    FPS_TAP_SOURCE.trim(),
    "'@",
    'try {',
    '  Add-Type -TypeDefinition $source',
    `  [KolndFpsTap]::Run($exe, $presentmonArgs, $latest, $heartbeat, $stop, $errorPath, '${psQuote(
      PRESENTMON_SESSION_NAME
    )}', '${psQuote(engineVersion)}', ${interval}, ${maxPids})`,
    '} catch {',
    '  $msg = $_.Exception.Message',
    '  try { [IO.File]::WriteAllText($errorPath, $msg, (New-Object Text.UTF8Encoding($false))) } catch { }',
    '} finally {',
    `  & logman.exe stop '${PRESENTMON_SESSION_NAME}' -ets 2>$null | Out-Null`,
    '}',
    'exit 0'
  ]
  return lines.join('\r\n')
}

// ── Instalação/remoção elevada ─────────────────────────────────

export interface FpsAgentInstallOptions {
  captureDir: string
  /** Exe embutido no app (fonte do estágio). */
  sourceExe: string
  /** Script supervisor gerado pelo main (fonte do estágio). */
  sourceScriptPath: string
  /** SHA-256 do script (hex maiúsculo) conferido no DESTINO. */
  scriptSha256: string
  generatedAt: string
  taskName?: string
}

export function buildFpsAgentInstallScript(options: FpsAgentInstallOptions): string {
  if (
    !isSafeCommandPath(options.captureDir) ||
    !isSafeCommandPath(options.sourceExe) ||
    !isSafeCommandPath(options.sourceScriptPath)
  ) {
    throw new Error('Caminho inválido para instalar a captura de FPS.')
  }
  if (!/^[A-F0-9]{64}$/.test(options.scriptSha256)) {
    throw new Error('Hash do script inválido.')
  }
  const taskName = options.taskName ?? FPS_CAPTURE_TASK_NAME
  const binDir = captureBinDir(options.captureDir)
  const agentDir = captureAgentDir(options.captureDir)
  const stagedExe = join(binDir, PRESENTMON_FILE)
  const stagedScript = captureStagedScriptPath(options.captureDir)
  const latest = captureLatestPath(options.captureDir)
  const stop = captureStopPath(options.captureDir)

  return [
    "$ErrorActionPreference = 'Continue'",
    // Antes de qualquer estágio: a sessão legada não pode continuar viva.
    `& logman.exe stop '${PRESENTMON_LEGACY_SESSION_NAME}' -ets 2>$null | Out-Null`,
    `& schtasks.exe /End /TN '${psQuote(taskName)}' 2>$null | Out-Null`,
    buildStageScript({
      captureDir: options.captureDir,
      binDir,
      agentDir,
      sourceExe: options.sourceExe,
      stagedExe,
      manifestPath: join(options.captureDir, FPS_MANIFEST_FILE),
      generatedAt: options.generatedAt
    }),
    // O script também é copiado para dependência protegida; o hash do DESTINO
    // protege contra troca do arquivo-fonte entre o main e o processo elevado.
    `& icacls.exe '${psQuote(stagedScript)}' /reset 2>$null | Out-Null`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(stagedScript)}'`,
    `Copy-Item -LiteralPath '${psQuote(options.sourceScriptPath)}' -Destination '${psQuote(
      stagedScript
    )}' -Force`,
    `if (-not (Test-Path -LiteralPath '${psQuote(stagedScript)}')) { exit 1 }`,
    `$scriptHash = (Get-FileHash -Algorithm SHA256 -LiteralPath '${psQuote(
      stagedScript
    )}').Hash.ToUpperInvariant()`,
    `if ($scriptHash -ne '${options.scriptSha256}') { Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(
      stagedScript
    )}'; exit 1 }`,
    // Sem o latest/stop antigos a UI nunca mostra um número da sessão anterior.
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(latest)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(`${latest}.tmp`)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(stop)}'`,
    `& schtasks.exe ${psArgList(
      buildFpsAgentCreateArgs({
        scriptPath: stagedScript,
        captureDir: options.captureDir,
        taskName
      })
    )}`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    `& schtasks.exe /Run /TN '${psQuote(taskName)}'`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'exit 0'
  ].join('\r\n')
}

export function buildFpsAgentRemoveScript(
  captureDir: string,
  taskName: string = FPS_CAPTURE_TASK_NAME
): string {
  if (!isSafeCommandPath(captureDir)) {
    throw new Error('Diretório da captura de FPS inválido.')
  }
  const latest = captureLatestPath(captureDir)
  const stop = captureStopPath(captureDir)
  return [
    "$ErrorActionPreference = 'Continue'",
    `New-Item -ItemType File -Force -Path '${psQuote(stop)}' | Out-Null`,
    // O loop sai pelo stop; `/End` cobre o caso de ele não reagir.
    'Start-Sleep -Milliseconds 1500',
    `& schtasks.exe /End /TN '${psQuote(taskName)}' 2>$null | Out-Null`,
    // Remover quando a tarefa já não existe precisa funcionar (idempotência).
    `& schtasks.exe ${psArgList(buildFpsAgentDeleteArgs(taskName))} 2>$null | Out-Null`,
    // Só o PresentMon da NOSSA sessão: nunca matar a captura pessoal do usuário.
    `Get-CimInstance Win32_Process -Filter "Name='${PRESENTMON_FILE}'" -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.CommandLine -like '*${PRESENTMON_SESSION_NAME}*' } | ` +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    `& logman.exe stop '${PRESENTMON_SESSION_NAME}' -ets 2>$null | Out-Null`,
    `& logman.exe stop '${PRESENTMON_LEGACY_SESSION_NAME}' -ets 2>$null | Out-Null`,
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${psQuote(captureDir)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(latest)}'`,
    'exit 0'
  ].join('\r\n')
}

/**
 * Comando que PEDE O UAC e espera o processo elevado terminar.
 *
 * O script vai por `-EncodedCommand` (UTF-16LE/base64), NUNCA por um `.ps1`
 * em pasta gravável pelo usuário esperando o clique no UAC — regra explícita
 * do projeto (AGENTS.md). O `runPowerShellCommand` usa spawn + argv (sem
 * shell), então o comando longo/base64 é seguro.
 */
export function buildFpsAgentElevationCommand(script: string): string {
  if (typeof script !== 'string' || !script.trim() || script.length > 512 * 1024) {
    throw new Error('Script de elevação inválido.')
  }
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') ` +
      `-Verb RunAs -Wait -PassThru`,
    'exit $p.ExitCode'
  ].join('; ')
}

// ── Manifesto e freshness do sink ──────────────────────────────

export interface FpsAgentManifest {
  schema: 1
  engine: { name: string; version: string; sha256: string; size: number }
  scriptVersion: number
  generatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lê o manifest do staging; qualquer divergência de forma devolve `null`. */
export async function readFpsManifest(path: string): Promise<FpsAgentManifest | null> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) return null
    const parsed = JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as unknown
    if (!isRecord(parsed) || parsed.schema !== 1 || !isRecord(parsed.engine)) return null
    const engine = parsed.engine
    if (
      typeof engine.name !== 'string' ||
      typeof engine.version !== 'string' ||
      typeof engine.sha256 !== 'string' ||
      typeof engine.size !== 'number' ||
      typeof parsed.scriptVersion !== 'number' ||
      typeof parsed.generatedAt !== 'string'
    ) {
      return null
    }
    return {
      schema: 1,
      engine: {
        name: engine.name,
        version: engine.version,
        sha256: engine.sha256,
        size: engine.size
      },
      scriptVersion: parsed.scriptVersion,
      generatedAt: parsed.generatedAt
    }
  } catch {
    return null
  }
}

/** `true` somente quando motor (versão/hash/tamanho) e script estão atuais. */
export function isFpsManifestCurrent(manifest: FpsAgentManifest | null): boolean {
  if (!manifest) return false
  return (
    manifest.engine.name === 'PresentMon' &&
    manifest.engine.version === PRESENTMON_VERSION &&
    manifest.engine.sha256.toUpperCase() === PRESENTMON_SHA256 &&
    manifest.engine.size === PRESENTMON_SIZE &&
    manifest.scriptVersion === FPS_AGENT_SCRIPT_VERSION
  )
}

/** Checagem barata usada pelo install: o sink existe, parseia e está fresco. */
export async function isFpsSinkFresh(path: string, nowMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) return false
    const parsed = JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as unknown
    if (!isRecord(parsed) || typeof parsed.timestamp !== 'string') return false
    const stamp = Date.parse(parsed.timestamp)
    if (!Number.isFinite(stamp)) return false
    const age = nowMs - stamp
    return age <= FPS_SINK_STALE_MS && age >= -5_000
  } catch {
    return false
  }
}

// ── Consulta/instalação/remoção (UAC explícito) ────────────────

export interface FpsAgentActionResult {
  ok: boolean
  cancelled?: boolean
  engineMissing?: boolean
  error?: string
}

let installing = false
let removing = false

function programDataDir(): string {
  return process.env.ProgramData ?? 'C:\\ProgramData'
}

function currentCaptureDir(): string {
  return resolveCaptureDir(programDataDir())
}

function currentAppDataDir(): string {
  return app.getPath('userData')
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
}

/** Consulta a tarefa no Windows sem elevação. `null` = não deu para saber. */
export async function isFpsAgentInstalled(): Promise<boolean | null> {
  if (process.platform !== 'win32') return false
  const result = await runProcess(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe'),
    ['/Query', '/TN', FPS_CAPTURE_TASK_NAME, '/FO', 'LIST'],
    null,
    FPS_AGENT_QUERY_TIMEOUT_MS
  )
  return interpretFpsAgentQuery(result)
}

/** `true` quando o sink do diretório lido pelo main está fresco. */
export async function isFpsCaptureActive(nowMs: number = Date.now()): Promise<boolean> {
  const sinkDir = resolveFpsSinkDir(programDataDir(), process.env.KOLDND_HUB_TEST_USERDATA)
  return isFpsSinkFresh(captureLatestPath(sinkDir), nowMs)
}

async function runElevated(script: string): Promise<ProcessResult> {
  // Nada é gravado em %APPDATA% para elevar: o conteúdo vira -EncodedCommand.
  return runPowerShellCommand(buildFpsAgentElevationCommand(script), FPS_AGENT_UAC_TIMEOUT_MS)
}

async function waitForSink(): Promise<boolean> {
  const deadline = Date.now() + FPS_AGENT_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isFpsCaptureActive()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

/**
 * Instala a captura (UAC único). Idempotente: reescreve o script, re-estagia o
 * motor, reinicia a tarefa e espera o sink. Nunca lança.
 */
export async function installFpsAgent(): Promise<FpsAgentActionResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A captura de FPS só é suportada no Windows.' }
  }
  if (installing || removing) {
    return { ok: false, error: 'Já existe uma operação em andamento.' }
  }

  installing = true
  try {
    const captureDir = currentCaptureDir()
    const sourceExe = resolveBundledPresentMon(resourcesDir())
    // O exe precisa existir ANTES do UAC: nunca pedir elevação para descobrir
    // que o recurso não foi embarcado.
    if (!isPresentMonBinary(sourceExe)) {
      return {
        ok: false,
        engineMissing: true,
        error: 'O motor de FPS não está disponível nesta instalação. Nada foi alterado.'
      }
    }

    const appData = currentAppDataDir()
    const script = buildFpsAgentScript({
      presentMonPath: join(captureBinDir(captureDir), PRESENTMON_FILE),
      latestPath: captureLatestPath(captureDir),
      heartbeatPath: resolveHeartbeatPath(appData),
      stopPath: captureStopPath(captureDir),
      errorPath: captureErrorPath(captureDir)
    })
    const content = `\uFEFF${script}`
    const scriptSha256 = createHash('sha256').update(content, 'utf8').digest('hex').toUpperCase()
    const sourcePath = join(appData, 'fps', 'fps-agent-source.ps1')
    await fs.mkdir(dirname(sourcePath), { recursive: true })
    await fs.writeFile(sourcePath, content, 'utf8')

    const installScript = buildFpsAgentInstallScript({
      captureDir,
      sourceExe,
      sourceScriptPath: sourcePath,
      scriptSha256,
      generatedAt: new Date().toISOString()
    })
    const result = await runElevated(installScript)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelled(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.'
      }
    }
    if (result.timedOut) {
      return { ok: false, error: 'A ativação demorou demais para responder. Tente novamente.' }
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      logger.warn(
        'fps',
        `instalação da captura falhou (código ${result.code})${detail ? `: ${detail}` : ''}`
      )
      return { ok: false, error: 'Não foi possível agendar a captura de FPS.' }
    }

    const fresh = await waitForSink()
    if (!fresh) {
      return {
        ok: true,
        error:
          'A captura foi instalada, mas ainda não publicou uma leitura. Aguarde alguns segundos.'
      }
    }
    logger.info('fps', `tarefa ${FPS_CAPTURE_TASK_NAME} ativa (sink ${captureDir})`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('fps', `falha ao instalar a captura: ${message}`)
    return { ok: false, error: 'Não foi possível ativar a captura de FPS.' }
  } finally {
    installing = false
  }
}

/** Remove a captura (UAC explícito): tarefa, processo, sessões e diretório. */
export async function removeFpsAgent(): Promise<FpsAgentActionResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A captura de FPS só é suportada no Windows.' }
  }
  if (installing || removing) {
    return { ok: false, error: 'Já existe uma operação em andamento.' }
  }

  removing = true
  try {
    const captureDir = currentCaptureDir()
    const script = buildFpsAgentRemoveScript(captureDir)
    const result = await runElevated(script)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelled(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.'
      }
    }
    if (result.timedOut || result.code !== 0) {
      logger.warn('fps', `remoção da captura falhou (código ${result.code ?? 'timeout'})`)
      return { ok: false, error: 'Não foi possível remover a captura de FPS.' }
    }
    logger.info('fps', `tarefa ${FPS_CAPTURE_TASK_NAME} removida`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('fps', `falha ao remover a captura: ${message}`)
    return { ok: false, error: 'Não foi possível remover a captura de FPS.' }
  } finally {
    removing = false
  }
}

/** Só para testes: zera os guardas de operação. */
export function resetFpsAgentForTests(): void {
  installing = false
  removing = false
}
