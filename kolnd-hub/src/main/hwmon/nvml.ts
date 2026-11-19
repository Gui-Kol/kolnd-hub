import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { runProcess, runPowerShell } from './powershell'
import { resolvePowershellPath, windowsRoot } from './systemPaths'

/**
 * RPM da ventoinha da GPU pela NVML (NVIDIA Management Library).
 *
 * Por que NVML: o `nvidia-smi` só publica o percentual da ventoinha; o RPM
 * existe na NVML, que vem junto do driver (`C:\Windows\System32\nvml.dll`) e
 * roda em modo usuário — sem driver próprio, sem serviço, sem UAC, ao contrário
 * do PawnIO e do Super I/O da placa.
 *
 * O helper C# é compilado **uma vez** (`Add-Type -OutputAssembly`) e o assembly
 * fica em `<userData>/hwmon/`, o mesmo padrão do helper PawnIO. Cada leitura
 * roda um PowerShell curto com stdin/stdout (JSON) e timeout curto: um tick de
 * 1 Hz nunca deixa processo pendurado. Sem NVIDIA/NVML tudo degrada para `null`
 * com o motivo no log, uma vez por minuto (o polling não pode inundar o arquivo).
 *
 * Assinaturas reais (conferidas em `nvml.h` e medidas nesta máquina —
 * RTX 5060 Ti, driver 8.17.16.2124):
 *   nvmlInit_v2, nvmlShutdown, nvmlDeviceGetCount_v2,
 *   nvmlDeviceGetHandleByIndex_v2, nvmlDeviceGetNumFans,
 *   nvmlDeviceGetFanSpeed_v2(device, fan, unsigned int*),
 *   nvmlDeviceGetFanSpeedRPM(device, nvmlFanSpeedInfo_t*).
 *
 * ATENÇÃO: `nvmlDeviceGetFanSpeedRPM` **não** recebe `unsigned int*`; ela usa a
 * struct versionada `nvmlFanSpeedInfo_t` (`{ version, fan, speed }`). Passar um
 * `unsigned int*` faz a NVML devolver `NVML_ERROR_ARGUMENT_VERSION_MISMATCH` (25)
 * e o RPM some — foi exatamente o que aconteceu na primeira tentativa.
 */

export const NVML_LIB_FILE_NAME = 'nvml.dll'

const HELPER_DIR = 'hwmon'
const CSHARP_FILE_NAME = 'KolndNvml.cs'
const ASSEMBLY_FILE_NAME = 'KolndNvml.dll'
const SCRIPT_FILE_NAME = 'nvml-helper.ps1'

const COMPILE_TIMEOUT_MS = 30_000
/** Leitura tem orçamento curto: ela roda junto do CIM, nunca depois. */
const HELPER_TIMEOUT_MS = 4000
/** Após uma falha, espera antes de tentar de novo (o polling é de 1 Hz). */
const RETRY_AFTER_MS = 60_000
/** Faixa de sanidade do RPM: acima disso é lixo de leitura, não ventoinha. */
const MAX_PLAUSIBLE_RPM = 30_000

const COMPILE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
const HELPER_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

const CSHARP_SOURCE = String.raw`using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class KolndNvml
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibrary(string fileName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr module);

    // NVML entra pela ABI C (cdecl); no x64 a convencao e unica, mas declarar
    // Cdecl deixa o helper correto tambem se algum dia rodar em x86.
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int InitDelegate();

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int ShutdownDelegate();

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int CountDelegate(out uint count);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int HandleDelegate(uint index, out IntPtr device);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int NumFansDelegate(IntPtr device, out uint count);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int FanSpeedDelegate(IntPtr device, uint fan, out uint percent);

    // nvmlDeviceGetFanSpeed (legado) nao conhece indice de ventoinha: assinatura
    // de dois parametros, diferente da _v2.
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int FanSpeedLegacyDelegate(IntPtr device, out uint percent);

    // nvmlFanSpeedInfo_t: struct versionada (version | fan de entrada, speed de
    // saida). A versao e sizeof(struct) | (1 << 24).
    [StructLayout(LayoutKind.Sequential)]
    private struct FanSpeedInfo
    {
        public uint version;
        public uint fan;
        public uint speed;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int FanRpmDelegate(IntPtr device, ref FanSpeedInfo fanSpeed);

    private static readonly uint FanSpeedInfoVersion =
        (uint)Marshal.SizeOf(typeof(FanSpeedInfo)) | (1u << 24);

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

    private static Delegate Bind(IntPtr lib, string name, Type type)
    {
        IntPtr address = GetProcAddress(lib, name);
        if (address == IntPtr.Zero) return null;
        return Marshal.GetDelegateForFunctionPointer(address, type);
    }

    public static string Run(string dllPath)
    {
        bool initialized = false;
        uint deviceCount = 0;
        StringBuilder fans = new StringBuilder();
        int fanCount = 0;
        string error = null;
        IntPtr lib = IntPtr.Zero;
        ShutdownDelegate shutdown = null;

        try
        {
            // LoadLibrary em vez de DllImport: a DLL vive em System32 (ou no
            // NVSMI antigo), fora do PATH e fora da pasta do app.
            lib = LoadLibrary(dllPath);
            if (lib == IntPtr.Zero)
            {
                error = Error("library", Marshal.GetLastWin32Error(), dllPath);
            }
            else
            {
                InitDelegate init = (InitDelegate)Bind(lib, "nvmlInit_v2", typeof(InitDelegate));
                shutdown = (ShutdownDelegate)Bind(lib, "nvmlShutdown", typeof(ShutdownDelegate));
                CountDelegate count = (CountDelegate)Bind(lib, "nvmlDeviceGetCount_v2", typeof(CountDelegate));
                HandleDelegate handleByIndex = (HandleDelegate)Bind(lib, "nvmlDeviceGetHandleByIndex_v2", typeof(HandleDelegate));

                // Opcionais: drivers antigos nao tem NumFans/FanSpeed_v2/RPM. Sem
                // eles ainda e possivel entregar o percentual pela funcao legada.
                NumFansDelegate numFans = (NumFansDelegate)Bind(lib, "nvmlDeviceGetNumFans", typeof(NumFansDelegate));
                FanSpeedDelegate fanSpeedV2 = (FanSpeedDelegate)Bind(lib, "nvmlDeviceGetFanSpeed_v2", typeof(FanSpeedDelegate));
                FanSpeedLegacyDelegate fanSpeedLegacy = (FanSpeedLegacyDelegate)Bind(lib, "nvmlDeviceGetFanSpeed", typeof(FanSpeedLegacyDelegate));
                FanRpmDelegate fanRpm = (FanRpmDelegate)Bind(lib, "nvmlDeviceGetFanSpeedRPM", typeof(FanRpmDelegate));

                string missing = null;
                if (init == null) missing = "nvmlInit_v2";
                else if (shutdown == null) missing = "nvmlShutdown";
                else if (count == null) missing = "nvmlDeviceGetCount_v2";
                else if (handleByIndex == null) missing = "nvmlDeviceGetHandleByIndex_v2";

                if (missing != null)
                {
                    error = Error("export", 0, missing);
                }
                else
                {
                    int code = init();
                    if (code != 0)
                    {
                        error = Error("init", code, "");
                    }
                    else
                    {
                        initialized = true;
                        if (count(out deviceCount) != 0 || deviceCount == 0)
                        {
                            error = Error("device", 0, "count");
                        }
                        else
                        {
                            IntPtr device;
                            code = handleByIndex(0, out device);
                            if (code != 0 || device == IntPtr.Zero)
                            {
                                error = Error("handle", code, "0");
                            }
                            else
                            {
                                uint fanTotal = 1;
                                if (numFans != null && numFans(device, out fanTotal) != 0) fanTotal = 0;

                                if (fanTotal == 0)
                                {
                                    error = Error("fans", 0, "count");
                                }
                                else
                                {
                                    for (uint fan = 0; fan < fanTotal; fan++)
                                    {
                                        uint rpm = 0;
                                        uint percent = 0;
                                        bool hasRpm = false;

                                        if (fanRpm != null)
                                        {
                                            FanSpeedInfo info = new FanSpeedInfo();
                                            info.version = FanSpeedInfoVersion;
                                            info.fan = fan;
                                            if (fanRpm(device, ref info) == 0)
                                            {
                                                rpm = info.speed;
                                                hasRpm = true;
                                            }
                                        }

                                        bool hasPercent = false;
                                        if (fanSpeedV2 != null)
                                        {
                                            hasPercent = fanSpeedV2(device, fan, out percent) == 0;
                                        }
                                        else if (fan == 0 && fanSpeedLegacy != null)
                                        {
                                            // API legada: so conhece a primeira ventoinha.
                                            hasPercent = fanSpeedLegacy(device, out percent) == 0;
                                        }

                                        if (!hasRpm && !hasPercent) continue;
                                        if (fanCount > 0) fans.Append(',');
                                        fans.Append("{\"rpm\":");
                                        fans.Append(hasRpm ? rpm.ToString(CultureInfo.InvariantCulture) : "null");
                                        fans.Append(",\"percent\":");
                                        fans.Append(hasPercent ? percent.ToString(CultureInfo.InvariantCulture) : "null");
                                        fans.Append('}');
                                        fanCount++;
                                    }

                                    if (fanCount == 0) error = Error("fans", 0, "leitura");
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            if (error == null) error = Error("helper", 0, ex.Message);
        }
        finally
        {
            if (initialized && shutdown != null)
            {
                try { shutdown(); } catch { }
            }
            if (lib != IntPtr.Zero) FreeLibrary(lib);
        }

        StringBuilder json = new StringBuilder();
        json.Append("{\"ok\":").Append(error == null ? "true" : "false");
        json.Append(",\"initialized\":").Append(initialized ? "true" : "false");
        json.Append(",\"deviceCount\":").Append(deviceCount.ToString(CultureInfo.InvariantCulture));
        json.Append(",\"fans\":[").Append(fans).Append(']');
        json.Append(",\"error\":").Append(JsonString(error)).Append('}');
        return json.ToString();
    }
}
`

/** Script PowerShell (ASCII puro) carregado do userData a cada leitura. */
const PS_SOURCE = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $raw = [Console]::In.ReadToEnd()
  $request = $raw | ConvertFrom-Json
  Add-Type -Path (Join-Path $PSScriptRoot 'KolndNvml.dll')
  $json = [KolndNvml]::Run([string]$request.dllPath)
  [Console]::Out.Write($json)
} catch {
  $detail = $_.Exception.Message -replace '\s+', ' '
  $detail = $detail -replace '\\', '\\\\' -replace '"', '\"'
  [Console]::Out.Write('{"ok":false,"initialized":false,"deviceCount":0,"fans":[],"error":"helper|0|' + $detail + '"}')
}
`

export interface NvmlFanSample {
  /** RPM da ventoinha; `null` quando o driver não expõe essa leitura. */
  rpm: number | null
  percent: number | null
}

export interface NvmlParsed {
  ok: boolean
  initialized: boolean
  deviceCount: number
  fans: NvmlFanSample[]
  error?: string
}

/** Leitura pronta para o snapshot: primeira ventoinha com RPM. */
export interface NvmlFanReading {
  rpm: number | null
  percent: number | null
}

interface HelperAssets {
  scriptPath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Falhas são raras, mas o polling de 1 Hz poderia repeti-las a cada segundo. */
let lastWarnAt = 0
function warnNvml(message: string): void {
  const now = Date.now()
  if (now - lastWarnAt < RETRY_AFTER_MS) return
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

function toRpm(value: unknown): number | null {
  const parsed = toUnsigned(value)
  return parsed !== null && parsed <= MAX_PLAUSIBLE_RPM ? parsed : null
}

function toPercent(value: unknown): number | null {
  const parsed = toUnsigned(value)
  // A NVML documenta percentuais acima de 100 em placas com tolerância alta;
  // para exibição o teto é 100, como no percentual do `nvidia-smi`.
  return parsed === null ? null : Math.min(100, parsed)
}

/** Caminhos possíveis da NVML: System32 (driver atual) e o NVSMI antigo. */
export function nvmlDllCandidates(systemRoot: string, programFiles: string): string[] {
  return [
    join(systemRoot, 'System32', NVML_LIB_FILE_NAME),
    join(programFiles, 'NVIDIA Corporation', 'NVSMI', NVML_LIB_FILE_NAME)
  ]
}

/** Primeiro caminho existente — puro para testes (o `exists` é injetável). */
export function pickExistingDll(
  candidates: ReadonlyArray<string>,
  exists: (path: string) => boolean
): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/** `C:\Windows\System32\nvml.dll` quando existir; senão o NVSMI; senão null. */
export function resolveNvmlDllPath(): string | null {
  const programFiles = (process.env.ProgramFiles ?? '').trim() || 'C:\\Program Files'
  return pickExistingDll(nvmlDllCandidates(windowsRoot(), programFiles), existsSync)
}

/** Parser do JSON do helper — puro, exportado para testes. Nunca lança. */
export function parseNvmlHelperOutput(raw: string | null | undefined): NvmlParsed | null {
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

  const fans: NvmlFanSample[] = []
  for (const entry of Array.isArray(value.fans) ? value.fans : []) {
    if (!isRecord(entry)) continue
    fans.push({ rpm: toRpm(entry.rpm), percent: toPercent(entry.percent) })
  }

  const error =
    typeof value.error === 'string' && value.error.trim() ? value.error.trim() : undefined
  return {
    ok: value.ok === true,
    initialized: value.initialized === true,
    deviceCount: toUnsigned(value.deviceCount) ?? 0,
    fans,
    error
  }
}

/**
 * Escolha da ventoinha exibida: a primeira que reporta RPM; sem nenhuma, a
 * primeira que reporta percentual (drivers antigos não têm a função de RPM).
 * Pura, exportada para testes.
 */
export function pickFanReading(fans: ReadonlyArray<NvmlFanSample>): NvmlFanSample | null {
  const withRpm = fans.find((fan) => fan.rpm !== null)
  if (withRpm) return withRpm
  return fans.find((fan) => fan.percent !== null) ?? null
}

/**
 * Traduz o `stage|codigo|detalhe` do helper para uma frase de UI. Pura,
 * exportada para testes. `null` = sem erro.
 */
export function describeNvmlError(raw: string | undefined | null): string | null {
  if (!raw) return null
  const [stage = '', codeText = ''] = raw.split('|')
  const code = Number.parseInt(codeText, 10)

  switch (stage) {
    case 'library':
      return 'A NVML (nvml.dll) não foi encontrada ou não pôde ser carregada. Reinstale o driver da NVIDIA.'
    case 'export':
      return 'A NVML deste driver não expõe as funções esperadas (driver antigo demais).'
    case 'init':
      // 9 = NVML_ERROR_DRIVER_NOT_LOADED, 3 = NVML_ERROR_NOT_SUPPORTED.
      return code === 9
        ? 'O driver da NVIDIA não está carregado; a NVML não pôde iniciar.'
        : 'A NVML não inicializou (driver sem suporte ou GPU virtualizada).'
    case 'device':
    case 'handle':
      return 'A NVML não encontrou nenhuma GPU NVIDIA neste PC.'
    case 'fans':
      return 'Esta GPU não expõe ventoinhas para a NVML.'
    case 'timeout':
      return 'A leitura do NVML excedeu o tempo limite.'
    case 'helper':
      return 'Não foi possível ler o RPM da ventoinha da GPU (NVML).'
    default:
      return null
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

let assetsPromise: Promise<HelperAssets> | null = null

async function ensureAssets(): Promise<HelperAssets> {
  const dir = join(app.getPath('userData'), HELPER_DIR)
  await fs.mkdir(dir, { recursive: true })

  const csharpPath = join(dir, CSHARP_FILE_NAME)
  const dllPath = join(dir, ASSEMBLY_FILE_NAME)
  const scriptPath = join(dir, SCRIPT_FILE_NAME)

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
      throw new Error('A compilação do helper NVML excedeu o tempo limite.')
    }
    if (!existsSync(dllPath)) {
      const detail = result.stderr.trim() || `código ${result.code ?? 'desconhecido'}`
      throw new Error(`Não foi possível compilar o helper NVML: ${detail}`)
    }
  }

  return { scriptPath }
}

function getAssets(): Promise<HelperAssets> {
  if (!assetsPromise) {
    assetsPromise = ensureAssets().catch((err) => {
      assetsPromise = null
      throw err
    })
  }
  return assetsPromise
}

/** Depois de uma falha/sem suporte, não vale gastar um processo por segundo. */
let retryAfter = 0
/** O aviso "sem RPM" é de sessão: a capacidade do driver não muda no meio dela. */
let rpmUnsupportedLogged = false

/**
 * Lê as ventoinhas do **primeiro** dispositivo NVIDIA. Nunca lança:
 * `null` = NVML indisponível nesta máquina (sem NVIDIA, sem DLL, init falhou).
 *
 * O RPM é `0` em modo zero-fan (GPU fria) — 0 é leitura válida, não ausência.
 */
export async function readNvmlFan(
  timeoutMs: number = HELPER_TIMEOUT_MS
): Promise<NvmlFanReading | null> {
  if (process.platform !== 'win32') return null
  if (Date.now() < retryAfter) return null

  const dllPath = resolveNvmlDllPath()
  if (!dllPath) {
    retryAfter = Date.now() + RETRY_AFTER_MS
    warnNvml('NVML indisponível: nvml.dll não encontrada (driver da NVIDIA ausente?)')
    return null
  }

  try {
    const assets = await getAssets()
    const process = await runProcess(
      resolvePowershellPath(),
      [...HELPER_ARGS, assets.scriptPath],
      JSON.stringify({ dllPath }),
      timeoutMs
    )

    if (process.timedOut) {
      retryAfter = Date.now() + RETRY_AFTER_MS
      warnNvml(`leitura do NVML excedeu ${timeoutMs} ms`)
      return null
    }

    const parsed = parseNvmlHelperOutput(process.stdout)
    if (!parsed) {
      retryAfter = Date.now() + RETRY_AFTER_MS
      const detail = process.stderr.trim() || 'resposta inválida do helper'
      warnNvml(`helper NVML falhou: ${detail}`)
      return null
    }

    if (parsed.error) {
      retryAfter = Date.now() + RETRY_AFTER_MS
      warnNvml(`NVML: ${describeNvmlError(parsed.error) ?? parsed.error}`)
      return null
    }

    const fan = pickFanReading(parsed.fans)
    if (!fan) {
      retryAfter = Date.now() + RETRY_AFTER_MS
      warnNvml('NVML respondeu sem nenhuma ventoinha legível')
      return null
    }

    if (fan.rpm === null) {
      // Driver anterior à função de RPM: o percentual já vem do `nvidia-smi`,
      // então repetir a leitura a cada tick seria custo puro.
      retryAfter = Date.now() + RETRY_AFTER_MS
      if (!rpmUnsupportedLogged) {
        rpmUnsupportedLogged = true
        logger.info('hwmon', 'NVML desta máquina não expõe RPM da ventoinha (driver antigo?)')
      }
    }

    return { rpm: fan.rpm, percent: fan.percent }
  } catch (err) {
    retryAfter = Date.now() + RETRY_AFTER_MS
    const message = err instanceof Error ? err.message : String(err)
    warnNvml(`helper NVML indisponível: ${message}`)
    return null
  }
}

/** Sonda: `true` só quando a NVML respondeu com um RPM de verdade. */
export async function probeNvml(): Promise<boolean> {
  const reading = await readNvmlFan()
  return reading !== null && reading.rpm !== null
}

/** Apenas para testes: descarta o helper compilado em cache desta sessão. */
export function resetNvmlForTests(): void {
  assetsPromise = null
  lastWarnAt = 0
  retryAfter = 0
  rpmUnsupportedLogged = false
}
