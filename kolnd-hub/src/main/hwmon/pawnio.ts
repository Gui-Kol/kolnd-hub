import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync, statSync } from 'fs'
import * as os from 'os'
import { join } from 'path'
import { logger } from '../logger'
import { runProcess, runPowerShell } from './powershell'
import { resolvePowershellPath } from './systemPaths'

/**
 * Acesso aos sensores privilegiados pelo PawnIO (backend único de ring0).
 *
 * Por que PawnIO: o driver anterior (OpenLibSys) é recusado pela Memória
 * Integrity (HVCI) no Windows 11 e consta na lista de drivers vulneráveis do
 * Defender. O PawnIO é
 * um driver assinado que executa **módulos** também assinados em ring0; só os
 * módulos que o Hub precisa (`IntelMSR`, `AMDFamily17`) são embutidos em
 * `resources/pawnio/` e nenhum download acontece em runtime.
 *
 * O helper C# é compilado **uma vez** (`Add-Type -OutputAssembly`) e o assembly
 * fica em `<userData>/hwmon/`, o mesmo padrão do helper antigo. Cada leitura
 * roda um PowerShell curto com stdin/stdout (JSON) e timeout — nunca deixa
 * processo pendurado. Sem device/módulo, tudo degrada para `null` e um
 * `error` explicável.
 *
 * API nativa usada (variantes Win32 com `BOOL` + `SetLastError`, extraídas de
 * `%ProgramFiles%\PawnIO\PawnIOLib.dll`):
 *   pawnio_version_win32, pawnio_open_win32, pawnio_load_win32,
 *   pawnio_execute_win32, pawnio_close_win32.
 */

/** Nome do instalador embutido (validado por `scripts/fetch-pawnio.ps1`). */
export const PAWNIO_SETUP_FILE_NAME = 'PawnIO_setup.exe'
export const PAWNIO_LIB_FILE_NAME = 'PawnIOLib.dll'
export const PAWNIO_UNINSTALL_KEY =
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO'

export type PawnIoModule = 'IntelMSR' | 'AMDFamily17'
export type CpuVendor = 'amd' | 'intel' | 'other'

/**
 * Registro usado pela sonda: 0x1A2 (Intel) entrega o TjMax e já prova que o
 * módulo IntelMSR responde; 0xC0010299 (AMD) é a unidade RAPL do pacote.
 */
export const PAWNIO_PROBE_INTEL_MSR = 0x1a2
export const PAWNIO_PROBE_AMD_MSR = 0xc0010299

const CSHARP_SOURCE = String.raw`using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class KolndPawnIo
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibrary(string fileName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr module);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate bool VersionDelegate(out uint version);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate bool OpenDelegate(out IntPtr handle);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate bool LoadDelegate(IntPtr handle, byte[] blob, UIntPtr size);

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Ansi)]
    private delegate bool ExecuteDelegate(
        IntPtr handle,
        string name,
        ulong[] input,
        UIntPtr inputSize,
        ulong[] output,
        UIntPtr outputSize,
        out UIntPtr returnSize);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate bool CloseDelegate(IntPtr handle);

    // Formato do erro: "etapa|codigo|detalhe". A etapa e traduzida no lado TS;
    // o detalhe (caminho, nome da funcao) fica para o log, nunca para a UI.
    private static string Error(string stage, int code, string detail)
    {
        return stage + "|" + code.ToString(CultureInfo.InvariantCulture) + "|" + (detail ?? "");
    }

    private static string JsonString(string value)
    {
        if (value == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        foreach (char c in value)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    private static ulong[] ParseList(string text)
    {
        List<ulong> values = new List<ulong>();
        if (string.IsNullOrEmpty(text)) return values.ToArray();
        foreach (string part in text.Split(','))
        {
            ulong parsed;
            if (ulong.TryParse(part.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
            {
                values.Add(parsed);
            }
        }
        return values.ToArray();
    }

    private static Delegate Bind(IntPtr lib, string name, Type type)
    {
        IntPtr address = GetProcAddress(lib, name);
        if (address == IntPtr.Zero) return null;
        return Marshal.GetDelegateForFunctionPointer(address, type);
    }

    private static bool Read(ExecuteDelegate execute, IntPtr handle, string name, ulong address, out ulong value, out int code)
    {
        ulong[] input = new ulong[] { address };
        ulong[] output = new ulong[1];
        UIntPtr returned;
        value = 0;
        code = 0;
        if (!execute(handle, name, input, new UIntPtr(1), output, new UIntPtr(1), out returned))
        {
            code = Marshal.GetLastWin32Error();
            return false;
        }
        if (returned.ToUInt64() < 1)
        {
            code = -1;
            return false;
        }
        value = output[0];
        return true;
    }

    public static string Run(string dllPath, string modulePath, string vendor, string msrList, string smnList)
    {
        ulong[] msr = ParseList(msrList);
        ulong[] smn = ParseList(smnList);
        List<KeyValuePair<ulong, string>> msrValues = new List<KeyValuePair<ulong, string>>();
        List<KeyValuePair<ulong, string>> smnValues = new List<KeyValuePair<ulong, string>>();
        bool deviceOpen = false;
        string moduleName = null;
        string error = null;
        IntPtr lib = IntPtr.Zero;
        IntPtr handle = IntPtr.Zero;

        try
        {
            // LoadLibrary em vez de DllImport: a DLL vive em %ProgramFiles%\PawnIO,
            // fora do diretorio do app e do PATH.
            lib = LoadLibrary(dllPath);
            if (lib == IntPtr.Zero)
            {
                error = Error("library", Marshal.GetLastWin32Error(), dllPath);
            }
            else
            {
                VersionDelegate version = (VersionDelegate)Bind(lib, "pawnio_version_win32", typeof(VersionDelegate));
                OpenDelegate open = (OpenDelegate)Bind(lib, "pawnio_open_win32", typeof(OpenDelegate));
                LoadDelegate load = (LoadDelegate)Bind(lib, "pawnio_load_win32", typeof(LoadDelegate));
                ExecuteDelegate execute = (ExecuteDelegate)Bind(lib, "pawnio_execute_win32", typeof(ExecuteDelegate));
                CloseDelegate close = (CloseDelegate)Bind(lib, "pawnio_close_win32", typeof(CloseDelegate));

                string missing = null;
                if (version == null) missing = "pawnio_version_win32";
                else if (open == null) missing = "pawnio_open_win32";
                else if (load == null) missing = "pawnio_load_win32";
                else if (execute == null) missing = "pawnio_execute_win32";
                else if (close == null) missing = "pawnio_close_win32";

                if (missing != null)
                {
                    error = Error("export", 0, missing);
                }
                else
                {
                    uint versionValue;
                    if (!version(out versionValue))
                    {
                        error = Error("version", Marshal.GetLastWin32Error(), "");
                    }
                    else if (!open(out handle) || handle == IntPtr.Zero || handle == new IntPtr(-1))
                    {
                        error = Error("device", Marshal.GetLastWin32Error(), "");
                    }
                    else
                    {
                        deviceOpen = true;
                        if (vendor != "amd" && vendor != "intel")
                        {
                            // Cada modulo valida o vendor no main(): nao ha o que
                            // carregar numa CPU que nao seja AMD/Intel.
                            error = Error("vendor", 0, vendor);
                        }
                        else
                        {
                            byte[] blob = File.ReadAllBytes(modulePath);
                            if (!load(handle, blob, new UIntPtr((ulong)blob.Length)))
                            {
                                error = Error("module", Marshal.GetLastWin32Error(), vendor);
                            }
                            else
                            {
                                moduleName = vendor == "amd" ? "AMDFamily17" : "IntelMSR";

                                int firstCode = 0;
                                foreach (ulong index in msr)
                                {
                                    ulong value;
                                    int code;
                                    if (Read(execute, handle, "ioctl_read_msr", index, out value, out code))
                                    {
                                        msrValues.Add(new KeyValuePair<ulong, string>(index, value.ToString(CultureInfo.InvariantCulture)));
                                    }
                                    else
                                    {
                                        if (firstCode == 0) firstCode = code;
                                        msrValues.Add(new KeyValuePair<ulong, string>(index, null));
                                    }
                                }

                                // SMN so existe no modulo AMD; no Intel o pedido nem
                                // chega aqui (o TS filtra por vendor).
                                foreach (ulong index in smn)
                                {
                                    ulong value;
                                    int code;
                                    if (Read(execute, handle, "ioctl_read_smn", index, out value, out code))
                                    {
                                        smnValues.Add(new KeyValuePair<ulong, string>(index, value.ToString(CultureInfo.InvariantCulture)));
                                    }
                                    else
                                    {
                                        if (firstCode == 0) firstCode = code;
                                        smnValues.Add(new KeyValuePair<ulong, string>(index, null));
                                    }
                                }

                                // Se TODAS as leituras falharam com o mesmo erro, o
                                // problema e a funcao (modulo sem esse ioctl), nao o
                                // registro isolado. Um erro explica os nulls.
                                bool anyValue = false;
                                foreach (KeyValuePair<ulong, string> entry in msrValues) if (entry.Value != null) anyValue = true;
                                foreach (KeyValuePair<ulong, string> entry in smnValues) if (entry.Value != null) anyValue = true;
                                if (!anyValue && (msrValues.Count + smnValues.Count) > 0)
                                {
                                    error = Error("execute", firstCode, "leitura");
                                }
                            }
                        }
                    }
                }

                if (close != null && handle != IntPtr.Zero && handle != new IntPtr(-1))
                {
                    close(handle);
                }
            }
        }
        catch (Exception ex)
        {
            if (error == null) error = Error("helper", 0, ex.Message);
        }
        finally
        {
            if (lib != IntPtr.Zero) FreeLibrary(lib);
        }

        StringBuilder json = new StringBuilder();
        json.Append("{\"deviceOpen\":").Append(deviceOpen ? "true" : "false");
        json.Append(",\"module\":").Append(JsonString(moduleName));
        json.Append(",\"msr\":[");
        for (int i = 0; i < msrValues.Count; i++)
        {
            if (i > 0) json.Append(',');
            json.Append("{\"index\":").Append(msrValues[i].Key.ToString(CultureInfo.InvariantCulture));
            json.Append(",\"value\":").Append(msrValues[i].Value == null ? "null" : JsonString(msrValues[i].Value)).Append('}');
        }
        json.Append("],\"smn\":[");
        for (int i = 0; i < smnValues.Count; i++)
        {
            if (i > 0) json.Append(',');
            json.Append("{\"index\":").Append(smnValues[i].Key.ToString(CultureInfo.InvariantCulture));
            json.Append(",\"value\":").Append(smnValues[i].Value == null ? "null" : JsonString(smnValues[i].Value)).Append('}');
        }
        json.Append("],\"error\":").Append(JsonString(error)).Append('}');
        return json.ToString();
    }

    // Escreve o JSON do agente de forma atomica: o Hub pode ler a qualquer
    // instante e nunca ve um arquivo pela metade.
    private static void WriteAtomic(string path, string content)
    {
        string temp = path + ".tmp";
        File.WriteAllText(temp, content, new UTF8Encoding(false));
        if (File.Exists(path))
        {
            try
            {
                File.Replace(temp, path, null);
            }
            catch
            {
                File.Copy(temp, path, true);
                File.Delete(temp);
            }
        }
        else
        {
            File.Move(temp, path);
        }
    }

    private static string BuildAgentJson(string vendor, bool deviceOpen, List<KeyValuePair<ulong, string>> msrValues, List<KeyValuePair<ulong, string>> smnValues, string error)
    {
        StringBuilder json = new StringBuilder();
        json.Append("{\"timestamp\":").Append(JsonString(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)));
        json.Append(",\"vendor\":").Append(JsonString(vendor));
        json.Append(",\"deviceOpen\":").Append(deviceOpen ? "true" : "false");
        json.Append(",\"msr\":[");
        for (int i = 0; i < msrValues.Count; i++)
        {
            if (i > 0) json.Append(',');
            json.Append("{\"index\":").Append(msrValues[i].Key.ToString(CultureInfo.InvariantCulture));
            json.Append(",\"value\":").Append(msrValues[i].Value == null ? "null" : JsonString(msrValues[i].Value)).Append('}');
        }
        json.Append("],\"smn\":[");
        for (int i = 0; i < smnValues.Count; i++)
        {
            if (i > 0) json.Append(',');
            json.Append("{\"index\":").Append(smnValues[i].Key.ToString(CultureInfo.InvariantCulture));
            json.Append(",\"value\":").Append(smnValues[i].Value == null ? "null" : JsonString(smnValues[i].Value)).Append('}');
        }
        // Ponto de extensao para os sensores da placa (Super I/O) na proxima
        // tarefa. O campo ja existe e e sempre null nesta versao.
        json.Append("],\"board\":null");
        json.Append(",\"error\":").Append(JsonString(error)).Append('}');
        return json.ToString();
    }

    /**
     * Loop persistente do agente de sensores (roda elevado pela tarefa no
     * logon). Abre o device e carrega o modulo UMA vez e publica o sink a cada
     * intervalo; sai quando o arquivo de stop aparece. Cada iteracao releia
     * os registradores pedidos, entao o Hub sempre ve valores novos.
     */
    public static void RunAgent(string dllPath, string modulePath, string vendor, string msrList, string smnList, string sinkPath, string stopPath, int intervalMs)
    {
        ulong[] msr = ParseList(msrList);
        ulong[] smn = ParseList(smnList);
        IntPtr lib = IntPtr.Zero;
        IntPtr handle = IntPtr.Zero;
        CloseDelegate close = null;
        bool deviceOpen = false;

        try
        {
            lib = LoadLibrary(dllPath);
            if (lib == IntPtr.Zero)
            {
                throw new InvalidOperationException(Error("library", Marshal.GetLastWin32Error(), dllPath));
            }

            VersionDelegate version = (VersionDelegate)Bind(lib, "pawnio_version_win32", typeof(VersionDelegate));
            OpenDelegate open = (OpenDelegate)Bind(lib, "pawnio_open_win32", typeof(OpenDelegate));
            LoadDelegate load = (LoadDelegate)Bind(lib, "pawnio_load_win32", typeof(LoadDelegate));
            ExecuteDelegate execute = (ExecuteDelegate)Bind(lib, "pawnio_execute_win32", typeof(ExecuteDelegate));
            close = (CloseDelegate)Bind(lib, "pawnio_close_win32", typeof(CloseDelegate));

            string missing = null;
            if (version == null) missing = "pawnio_version_win32";
            else if (open == null) missing = "pawnio_open_win32";
            else if (load == null) missing = "pawnio_load_win32";
            else if (execute == null) missing = "pawnio_execute_win32";
            else if (close == null) missing = "pawnio_close_win32";
            if (missing != null)
            {
                throw new InvalidOperationException(Error("export", 0, missing));
            }

            uint versionValue;
            if (!version(out versionValue))
            {
                throw new InvalidOperationException(Error("version", Marshal.GetLastWin32Error(), ""));
            }
            if (!open(out handle) || handle == IntPtr.Zero || handle == new IntPtr(-1))
            {
                throw new InvalidOperationException(Error("device", Marshal.GetLastWin32Error(), ""));
            }
            deviceOpen = true;

            byte[] blob = File.ReadAllBytes(modulePath);
            if (!load(handle, blob, new UIntPtr((ulong)blob.Length)))
            {
                throw new InvalidOperationException(Error("module", Marshal.GetLastWin32Error(), vendor));
            }

            int delay = intervalMs > 0 ? intervalMs : 1000;
            while (!File.Exists(stopPath))
            {
                List<KeyValuePair<ulong, string>> msrValues = new List<KeyValuePair<ulong, string>>();
                List<KeyValuePair<ulong, string>> smnValues = new List<KeyValuePair<ulong, string>>();
                int firstCode = 0;

                foreach (ulong index in msr)
                {
                    ulong value;
                    int code;
                    if (Read(execute, handle, "ioctl_read_msr", index, out value, out code))
                    {
                        msrValues.Add(new KeyValuePair<ulong, string>(index, value.ToString(CultureInfo.InvariantCulture)));
                    }
                    else
                    {
                        if (firstCode == 0) firstCode = code;
                        msrValues.Add(new KeyValuePair<ulong, string>(index, null));
                    }
                }

                foreach (ulong index in smn)
                {
                    ulong value;
                    int code;
                    if (Read(execute, handle, "ioctl_read_smn", index, out value, out code))
                    {
                        smnValues.Add(new KeyValuePair<ulong, string>(index, value.ToString(CultureInfo.InvariantCulture)));
                    }
                    else
                    {
                        if (firstCode == 0) firstCode = code;
                        smnValues.Add(new KeyValuePair<ulong, string>(index, null));
                    }
                }

                bool anyValue = false;
                foreach (KeyValuePair<ulong, string> entry in msrValues) if (entry.Value != null) anyValue = true;
                foreach (KeyValuePair<ulong, string> entry in smnValues) if (entry.Value != null) anyValue = true;
                string error = (anyValue || (msr.Length + smn.Length) == 0) ? null : Error("execute", firstCode, "leitura");

                // Uma falha transitoria de escrita (Hub lendo no mesmo instante)
                // nao pode matar o agente: a proxima iteracao tenta de novo.
                try
                {
                    WriteAtomic(sinkPath, BuildAgentJson(vendor, true, msrValues, smnValues, error));
                }
                catch
                {
                }
                System.Threading.Thread.Sleep(delay);
            }
        }
        catch (Exception ex)
        {
            try
            {
                WriteAtomic(sinkPath, BuildAgentJson(vendor, deviceOpen, new List<KeyValuePair<ulong, string>>(), new List<KeyValuePair<ulong, string>>(), Error("agent", 0, ex.Message)));
            }
            catch
            {
            }
        }
        finally
        {
            if (close != null && handle != IntPtr.Zero && handle != new IntPtr(-1))
            {
                try { close(handle); } catch { }
            }
            if (lib != IntPtr.Zero) FreeLibrary(lib);
        }
    }
}
`

/** Script PowerShell (ASCII puro) carregado do userData a cada leitura. */
const PS_SOURCE = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $raw = [Console]::In.ReadToEnd()
  $request = $raw | ConvertFrom-Json
  Add-Type -Path (Join-Path $PSScriptRoot 'KolndPawnIo.dll')
  $json = [KolndPawnIo]::Run([string]$request.dllPath, [string]$request.modulePath, [string]$request.vendor, [string]$request.msr, [string]$request.smn)
  [Console]::Out.Write($json)
} catch {
  $detail = $_.Exception.Message -replace '\s+', ' '
  $detail = $detail -replace '\\', '\\\\' -replace '"', '\"'
  [Console]::Out.Write('{"deviceOpen":false,"module":null,"msr":[],"smn":[],"error":"helper|0|' + $detail + '"}')
}
`

const HELPER_DIR = 'hwmon'
const COMPILE_TIMEOUT_MS = 30_000
const HELPER_TIMEOUT_MS = 6000
const COMPILE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
const REG_TIMEOUT_MS = 4000

export interface PawnIoAssets {
  dir: string
  installer: string
  intelModule: string
  amdModule: string
  license: string
  pins: string
}

/** Caminhos puros (recebem a base para não depender de Electron nos testes). */
export function resolvePawnIoAssets(resourcesDir: string): PawnIoAssets {
  const dir = join(resourcesDir, 'pawnio')
  return {
    dir,
    installer: join(dir, PAWNIO_SETUP_FILE_NAME),
    intelModule: join(dir, 'IntelMSR.bin'),
    amdModule: join(dir, 'AMDFamily17.bin'),
    license: join(dir, 'COPYING'),
    pins: join(dir, 'pins.json')
  }
}

function resourcesDir(): string {
  // Empacotado: <app>/resources/pawnio (extraResources). Dev: resources/pawnio
  // relativo ao cwd do projeto — mesmo padrão do antigo driver embutido.
  return app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
}

export function currentPawnIoAssets(): PawnIoAssets {
  return resolvePawnIoAssets(resourcesDir())
}

/** `AuthenticAMD`/`GenuineIntel` não aparecem no brand string do Windows. */
export function detectCpuVendor(model: string | null | undefined): CpuVendor {
  if (typeof model !== 'string') return 'other'
  const text = model.trim().toLowerCase()
  if (!text) return 'other'
  if (
    text.includes('amd') ||
    text.includes('ryzen') ||
    text.includes('athlon') ||
    text.includes('threadripper') ||
    text.includes('epyc')
  ) {
    return 'amd'
  }
  if (
    text.includes('intel') ||
    text.includes('core(tm)') ||
    text.includes('xeon') ||
    text.includes('pentium') ||
    text.includes('celeron')
  ) {
    return 'intel'
  }
  return 'other'
}

/** Módulo oficial que corresponde ao vendor — `null` quando não há módulo. */
export function moduleForVendor(vendor: CpuVendor): PawnIoModule | null {
  if (vendor === 'amd') return 'AMDFamily17'
  if (vendor === 'intel') return 'IntelMSR'
  return null
}

/** MSR lido pela sonda de status; `null` quando a CPU não tem módulo. */
export function probeRegisterForVendor(vendor: CpuVendor): number | null {
  if (vendor === 'amd') return PAWNIO_PROBE_AMD_MSR
  if (vendor === 'intel') return PAWNIO_PROBE_INTEL_MSR
  return null
}

export interface PawnIoInstallation {
  /** `InstallLocation` existe em HKLM (instalador registrado, não só a pasta). */
  registered: boolean
  installDir: string
  dllPath: string
  dllPresent: boolean
}

export interface PawnIoMsrResult {
  index: number
  value: bigint | null
}

export interface PawnIoSmnResult {
  index: number
  value: bigint | null
}

export interface PawnIoBatchRequest {
  msr?: number[]
  smn?: number[]
}

export interface PawnIoParsed {
  deviceOpen: boolean
  module: PawnIoModule | null
  msr: PawnIoMsrResult[]
  smn: PawnIoSmnResult[]
  error?: string
}

export interface PawnIoBatchResult extends PawnIoParsed {
  ok: boolean
}

export interface PawnIoHelperAssets {
  /** Pasta em `<userData>/hwmon` com o C#, a DLL compilada e o script. */
  dir: string
  scriptPath: string
  dllPath: string
  csharpPath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Falhas do helper são raras, mas o polling poderia repeti-las a cada segundo. */
let lastWarnAt = 0
function warnHelper(message: string): void {
  const now = Date.now()
  if (now - lastWarnAt < 60_000) return
  lastWarnAt = now
  logger.warn('hwmon', message)
}

function toUnsigned(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim())
    } catch {
      return null
    }
  }
  return null
}

function toModule(value: unknown): PawnIoModule | null {
  return value === 'IntelMSR' || value === 'AMDFamily17' ? value : null
}

function parseEntries(raw: unknown): Array<{ index: number; value: bigint | null }> {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  const entries: Array<{ index: number; value: bigint | null }> = []
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const index = toUnsigned(entry.index)
    if (index === null) continue
    entries.push({ index, value: toBigInt(entry.value) })
  }
  return entries
}

/** Parser do JSON do helper — puro, exportado para testes. Nunca lança. */
export function parsePawnIoHelperOutput(raw: string | null | undefined): PawnIoParsed | null {
  if (!raw) return null
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (!text) return null

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  const error =
    typeof value.error === 'string' && value.error.trim() ? value.error.trim() : undefined
  return {
    deviceOpen: value.deviceOpen === true,
    module: toModule(value.module),
    msr: parseEntries(value.msr),
    smn: parseEntries(value.smn),
    error
  }
}

/**
 * Traduz o `stage|codigo|detalhe` do helper para uma frase de UI. Pura,
 * exportada para testes. `null` = sem erro.
 *
 * Nada aqui fala de HVCI/blocklist: o PawnIO é assinado e o Defender não o
 * bloqueia; um erro real é instalação ausente, módulo incompatível ou CPU sem
 * módulo.
 */
export function describePawnIoError(raw: string | undefined | null): string | null {
  if (!raw) return null
  const [stage = '', codeText = '', detail = ''] = raw.split('|')
  const code = Number.parseInt(codeText, 10)
  // ERROR_NOT_SUPPORTED (50) e STATUS_NOT_SUPPORTED (0xC00000BB): o módulo
  // recusou a CPU. ERROR_INVALID_FUNCTION (1), STATUS_NOT_IMPLEMENTED
  // (0xC0000002) e "-1" (retorno vazio) indicam ioctl inexistente no módulo.
  const cpuRejected = code === 50 || code === -1073741637 || code === 0xc00000bb
  const functionMissing = cpuRejected || code === 1 || code === -1 || code === -1073741822

  switch (stage) {
    case 'library':
      return 'A biblioteca do PawnIO (PawnIOLib.dll) não foi encontrada. Reinstale o PawnIO e tente de novo.'
    case 'export':
      return 'A biblioteca do PawnIO não expõe as funções esperadas (versão incompatível). Reinstale o PawnIO.'
    case 'version':
      return 'A biblioteca do PawnIO respondeu com uma versão incompatível. Atualize o PawnIO.'
    case 'device':
      return 'O driver do PawnIO não abriu o device. Confirme que o PawnIO está instalado e reinicie o PC se acabou de instalar.'
    case 'module':
      return cpuRejected
        ? 'O módulo de leitura do PawnIO rejeitou esta CPU — o modelo pode não ser suportado pelos módulos oficiais.'
        : 'Não foi possível carregar o módulo de leitura do PawnIO. Reinstale o PawnIO e tente de novo.'
    case 'vendor':
      return 'A CPU deste PC não foi reconhecida como AMD ou Intel; não há módulo de sensores para ela.'
    case 'execute':
      return functionMissing
        ? 'O módulo do PawnIO não implementa a leitura pedida. Atualize os módulos embutidos do Hub.'
        : 'O PawnIO aceitou o módulo, mas não conseguiu ler o registro pedido.'
    case 'helper':
    case 'timeout':
      return 'Não foi possível ler os sensores avançados (PawnIO).'
    default:
      return detail.trim() ? 'Não foi possível ler os sensores avançados (PawnIO).' : null
  }
}

function escapePowerShellPath(value: string): string {
  return value.replace(/'/g, "''")
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    const current = await fs.readFile(path, 'utf8')
    if (current === content) return
  } catch {
    // arquivo ainda não existe
  }
  await fs.writeFile(path, content, 'utf8')
}

function needsCompile(csharpPath: string, dllPath: string): boolean {
  if (!existsSync(dllPath)) return true
  try {
    return statSync(csharpPath).mtimeMs > statSync(dllPath).mtimeMs
  } catch {
    return true
  }
}

let assetsPromise: Promise<PawnIoHelperAssets> | null = null

async function ensureAssets(): Promise<PawnIoHelperAssets> {
  const dir = join(app.getPath('userData'), HELPER_DIR)
  await fs.mkdir(dir, { recursive: true })

  const csharpPath = join(dir, 'KolndPawnIo.cs')
  const dllPath = join(dir, 'KolndPawnIo.dll')
  const scriptPath = join(dir, 'pawnio-helper.ps1')

  await writeIfChanged(csharpPath, CSHARP_SOURCE)
  await writeIfChanged(scriptPath, PS_SOURCE)

  if (needsCompile(csharpPath, dllPath)) {
    const command = [
      `Add-Type -Path '${escapePowerShellPath(csharpPath)}'`,
      `-OutputAssembly '${escapePowerShellPath(dllPath)}'`,
      '-OutputType Library'
    ].join(' ')
    const result = await runPowerShell([...COMPILE_ARGS, command], COMPILE_TIMEOUT_MS)
    if (result.timedOut) {
      throw new Error('A compilação do helper PawnIO excedeu o tempo limite.')
    }
    if (!existsSync(dllPath)) {
      const detail = result.stderr.trim() || `código ${result.code ?? 'desconhecido'}`
      throw new Error(`Não foi possível compilar o helper PawnIO: ${detail}`)
    }
  }

  return { dir, scriptPath, dllPath, csharpPath }
}

function getAssets(): Promise<PawnIoHelperAssets> {
  if (!assetsPromise) {
    assetsPromise = ensureAssets().catch((err) => {
      assetsPromise = null
      throw err
    })
  }
  return assetsPromise
}

/**
 * Garante o helper compilado e devolve os caminhos. Usado pelo agente de
 * sensores: o processo persistente carrega a mesma DLL via `Add-Type -Path`,
 * sem recompilar nada em runtime.
 */
export async function ensurePawnIoHelperAssets(): Promise<PawnIoHelperAssets> {
  return getAssets()
}

/** `InstallLocation` do registro — string pura, exportada para testes. */
export function parseRegString(output: string, valueName: string): string | null {
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(
    `^[ \\t]*${escaped}[ \\t]+REG_(?:EXPAND_)?SZ[ \\t]+(.+?)[ \\t]*\\r?$`,
    'm'
  ).exec(output)
  if (!match) return null
  const value = match[1].trim().replace(/^"(.*)"$/, '$1')
  return value || null
}

function programFilesDir(): string {
  return (process.env.ProgramFiles ?? '').trim() || 'C:\\Program Files'
}

/**
 * Instalação do PawnIO: `InstallLocation` no registro (fonte oficial) e, como
 * reserva, `%ProgramFiles%\PawnIO`. `registered` diferencia "instalado" de
 * "pasta sobrou de uma desinstalação".
 */
export async function detectPawnIoInstallation(): Promise<PawnIoInstallation> {
  const fallbackDir = join(programFilesDir(), 'PawnIO')
  let registered = false
  let installDir = fallbackDir

  if (process.platform === 'win32') {
    const result = await runProcess(
      'reg.exe',
      ['query', PAWNIO_UNINSTALL_KEY, '/v', 'InstallLocation'],
      null,
      REG_TIMEOUT_MS
    )
    if (!result.timedOut && result.code === 0) {
      const parsed = parseRegString(result.stdout, 'InstallLocation')
      if (parsed) {
        registered = true
        installDir = parsed
      }
    }
  }

  const dllPath = join(installDir, PAWNIO_LIB_FILE_NAME)
  return { registered, installDir, dllPath, dllPresent: existsSync(dllPath) }
}

function currentVendor(): CpuVendor {
  return detectCpuVendor(os.cpus()[0]?.model)
}

function emptyResult(request: { msr: number[]; smn: number[]; error?: string }): PawnIoBatchResult {
  return {
    ok: false,
    deviceOpen: false,
    module: null,
    msr: request.msr.map((index) => ({ index, value: null })),
    smn: request.smn.map((index) => ({ index, value: null })),
    error: request.error
  }
}

function sanitizeIndices(values: ReadonlyArray<number> | undefined): number[] {
  const seen = new Set<number>()
  const indices: number[] = []
  for (const value of values ?? []) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) continue
    if (seen.has(value)) continue
    seen.add(value)
    indices.push(value)
  }
  return indices
}

/**
 * Executa leituras MSR/SMN em lote numa única chamada ao helper. Nunca lança:
 * qualquer falha vira `ok: false` com `error` em pt-BR.
 *
 * SMN só é enviado quando a CPU é AMD (o módulo IntelMSR não tem esse ioctl);
 * no Intel o pedido é descartado em vez de gerar erro.
 */
export async function readPawnIoBatch(
  request: PawnIoBatchRequest,
  timeoutMs: number = HELPER_TIMEOUT_MS
): Promise<PawnIoBatchResult> {
  const vendor = currentVendor()
  const msr = sanitizeIndices(request.msr)
  const smn = vendor === 'amd' ? sanitizeIndices(request.smn) : []
  const module = moduleForVendor(vendor)

  if (!module) {
    return emptyResult({
      msr,
      smn: sanitizeIndices(request.smn),
      error:
        'A CPU deste PC não foi reconhecida como AMD ou Intel; não há módulo de sensores para ela.'
    })
  }

  const manifest = currentPawnIoAssets()
  const modulePath = module === 'IntelMSR' ? manifest.intelModule : manifest.amdModule

  const installation = await detectPawnIoInstallation()
  if (!installation.dllPresent) {
    return emptyResult({
      msr,
      smn,
      error: 'O PawnIO não está instalado. Instale os sensores avançados (PawnIO) e tente de novo.'
    })
  }

  const empty = emptyResult({ msr, smn })
  try {
    const assets = await getAssets()
    const payload = JSON.stringify({
      dllPath: installation.dllPath,
      modulePath,
      vendor,
      msr: msr.join(','),
      smn: smn.join(',')
    })

    const process = await runProcess(
      resolvePowershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', assets.scriptPath],
      payload,
      timeoutMs
    )

    if (process.timedOut) {
      return { ...empty, error: 'A leitura do PawnIO excedeu o tempo limite.' }
    }

    const parsed = parsePawnIoHelperOutput(process.stdout)
    if (!parsed) {
      const detail = process.stderr.trim() || 'resposta inválida do helper'
      warnHelper(`helper PawnIO falhou: ${detail}`)
      return { ...empty, error: 'Não foi possível ler os sensores avançados (PawnIO).' }
    }

    // Reordena pelo pedido: o helper responde na mesma ordem, mas não confiamos
    // nisso — e um registro ausente precisa virar `null`, não sumir.
    return {
      ok: !parsed.error,
      deviceOpen: parsed.deviceOpen,
      module: parsed.module,
      msr: msr.map(
        (index) => parsed.msr.find((entry) => entry.index === index) ?? { index, value: null }
      ),
      smn: smn.map(
        (index) => parsed.smn.find((entry) => entry.index === index) ?? { index, value: null }
      ),
      error: describePawnIoError(parsed.error) ?? parsed.error
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warnHelper(`helper PawnIO indisponível: ${message}`)
    return { ...empty, error: 'O PawnIO não está disponível para leitura.' }
  }
}

/**
 * Sonda de status: abre o device, carrega o módulo do vendor e lê um registro
 * real. `true` só quando os três passos funcionam — é o que vira `ready`.
 */
export async function probePawnIo(): Promise<boolean> {
  const vendor = currentVendor()
  const register = probeRegisterForVendor(vendor)
  if (register === null) return false

  const result = await readPawnIoBatch({ msr: [register] })
  return (
    result.ok &&
    result.deviceOpen &&
    result.module !== null &&
    (result.msr[0]?.value ?? null) !== null
  )
}

/** Apenas para testes: descarta o helper compilado em cache desta sessão. */
export function resetPawnIoForTests(): void {
  assetsPromise = null
  lastWarnAt = 0
}
