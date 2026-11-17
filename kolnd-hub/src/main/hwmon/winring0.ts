import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { runProcess, runPowerShell } from './powershell'
import { resolvePowershellPath } from './systemPaths'

/**
 * Acesso ao driver WinRing0 (OpenLibSys) para leituras privilegiadas.
 *
 * Constantes de IOCTL/struct obtidas de fonte oficial e conferidas em dois
 * projetos abertos:
 * - OpenLibSys/WinRing0, `drv/DriverIoCtl.h` (OLS_TYPE 40000; CTL_CODE com
 *   METHOD_BUFFERED): https://github.com/QCute/WinRing0/blob/master/drv/DriverIoCtl.h
 *   Licença declarada no header original: "modified BSD license"
 *   (Copyright 2007-2008 OpenLibSys.org).
 * - LibreHardwareMonitor, `LibreHardwareMonitorLib/Interop/Ring0.cs`
 *   (mesmos códigos 0x821/0x851): https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
 *   (MPL-2.0 — usado só como conferência dos valores, nenhum código copiado).
 *
 * O helper C# é compilado **uma vez** com `Add-Type` e o assembly fica em
 * `<userData>/hwmon/`. Cada leitura roda um PowerShell curto com stdin/stdout
 * (JSON), com timeout — nunca deixa processo pendurado. Sem driver acessível,
 * tudo degrada para `null`/`deviceOpen: false`.
 */

/**
 * Código C# do helper. Mantido em `String.raw` para preservar as barras do
 * caminho do device (`\\.\WinRing0_1_2_0`).
 */
const CSHARP_SOURCE = String.raw`using System;
using System.Runtime.InteropServices;

public static class KolndWinRing0
{
    // IOCTL_OLS_*: CTL_CODE(OLS_TYPE=40000, function, METHOD_BUFFERED=0, access).
    private static uint CtlCode(uint function, uint access)
    {
        return (40000u << 16) | (access << 14) | (function << 2);
    }

    private static readonly uint IOCTL_OLS_READ_MSR = CtlCode(0x821, 0);
    private static readonly uint IOCTL_OLS_READ_PCI_CONFIG = CtlCode(0x851, 1);
    private static readonly uint IOCTL_OLS_WRITE_PCI_CONFIG = CtlCode(0x852, 2);
    private const string DevicePath = @"\\.\WinRing0_1_2_0";

    private const uint GENERIC_READ_WRITE = 0xC0000000;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x80;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        IntPtr hDevice,
        uint dwIoControlCode,
        byte[] lpInBuffer,
        uint nInBufferSize,
        byte[] lpOutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private static readonly object Sync = new object();
    private static IntPtr _handle = IntPtr.Zero;

    private static bool HasHandle()
    {
        return _handle != IntPtr.Zero && _handle != new IntPtr(-1);
    }

    public static bool Open()
    {
        lock (Sync)
        {
            if (HasHandle()) return true;
            _handle = CreateFile(
                DevicePath,
                GENERIC_READ_WRITE,
                0,
                IntPtr.Zero,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);
            return HasHandle();
        }
    }

    public static void Close()
    {
        lock (Sync)
        {
            if (HasHandle())
            {
                CloseHandle(_handle);
            }
            _handle = IntPtr.Zero;
        }
    }

    public static bool ReadMsr(uint index, out ulong value)
    {
        value = 0;
        lock (Sync)
        {
            if (!HasHandle()) return false;
            byte[] input = BitConverter.GetBytes(index);
            byte[] output = new byte[8];
            uint returned;
            bool ok = DeviceIoControl(_handle, IOCTL_OLS_READ_MSR, input, 4, output, 8, out returned, IntPtr.Zero);
            if (!ok || returned < 8) return false;
            value = BitConverter.ToUInt64(output, 0);
            return true;
        }
    }

    public static bool ReadPciConfig(uint address, uint offset, out uint value)
    {
        value = 0;
        if ((offset & 3u) != 0) return false;
        lock (Sync)
        {
            if (!HasHandle()) return false;
            byte[] input = new byte[8];
            Buffer.BlockCopy(BitConverter.GetBytes(address), 0, input, 0, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(offset), 0, input, 4, 4);
            byte[] output = new byte[4];
            uint returned;
            bool ok = DeviceIoControl(_handle, IOCTL_OLS_READ_PCI_CONFIG, input, 8, output, 4, out returned, IntPtr.Zero);
            if (!ok || returned < 4) return false;
            value = BitConverter.ToUInt32(output, 0);
            return true;
        }
    }

    public static bool WritePciConfig(uint address, uint offset, uint value)
    {
        if ((offset & 3u) != 0) return false;
        lock (Sync)
        {
            if (!HasHandle()) return false;
            byte[] input = new byte[12];
            Buffer.BlockCopy(BitConverter.GetBytes(address), 0, input, 0, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(offset), 0, input, 4, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(value), 0, input, 8, 4);
            uint returned;
            return DeviceIoControl(_handle, IOCTL_OLS_WRITE_PCI_CONFIG, input, 12, null, 0, out returned, IntPtr.Zero);
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
  Add-Type -Path (Join-Path $PSScriptRoot 'KolndWinRing0.dll')
  $open = [KolndWinRing0]::Open()
  $msr = @()
  foreach ($index in @($request.msr)) {
    if ($null -eq $index) { continue }
    $value = [uint64]0
    $ok = [KolndWinRing0]::ReadMsr([uint32]$index, [ref]$value)
    $text = $null
    if ($ok) { $text = $value.ToString() }
    $msr += [pscustomobject]@{ index = [int]$index; value = $text }
  }
  $writes = @()
  foreach ($item in @($request.pciWrites)) {
    if ($null -eq $item) { continue }
    $ok = [KolndWinRing0]::WritePciConfig([uint32]$item.address, [uint32]$item.offset, [uint32]$item.value)
    $writes += [pscustomobject]@{ bus = [int]$item.bus; device = [int]$item.device; function = [int]$item.function; offset = [int]$item.offset; ok = [bool]$ok }
  }
  $pci = @()
  foreach ($item in @($request.pci)) {
    if ($null -eq $item) { continue }
    $value = [uint32]0
    $ok = [KolndWinRing0]::ReadPciConfig([uint32]$item.address, [uint32]$item.offset, [ref]$value)
    $text = $null
    if ($ok) { $text = $value.ToString() }
    $pci += [pscustomobject]@{ bus = [int]$item.bus; device = [int]$item.device; function = [int]$item.function; offset = [int]$item.offset; value = $text }
  }
  [pscustomobject]@{ deviceOpen = [bool]$open; msr = @($msr); pciWrites = @($writes); pci = @($pci) } | ConvertTo-Json -Depth 5 -Compress
} catch {
  [pscustomobject]@{ deviceOpen = $false; msr = @(); pciWrites = @(); pci = @(); error = $_.Exception.Message } | ConvertTo-Json -Depth 5 -Compress
}
`

const HELPER_DIR = 'hwmon'
const COMPILE_TIMEOUT_MS = 30_000
const HELPER_TIMEOUT_MS = 6000
const COMPILE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

export interface PciReadRequest {
  bus: number
  device: number
  function: number
  offset: number
}

export interface PciWriteRequest extends PciReadRequest {
  value: number
}

export interface WinRing0BatchRequest {
  msr?: number[]
  /** Escritas acontecem antes das leituras PCI (SMN: índice 0x60 → dado 0x64). */
  pciWrites?: PciWriteRequest[]
  pci?: PciReadRequest[]
}

export interface WinRing0MsrResult {
  index: number
  value: bigint | null
}

export interface WinRing0PciResult extends PciReadRequest {
  value: number | null
}

export interface WinRing0PciWriteResult extends PciReadRequest {
  ok: boolean
}

export interface WinRing0BatchResult {
  ok: boolean
  deviceOpen: boolean
  msr: WinRing0MsrResult[]
  pciWrites: WinRing0PciWriteResult[]
  pci: WinRing0PciResult[]
  error?: string
}

interface HelperAssets {
  scriptPath: string
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

/** Parser do JSON do helper — puro, exportado para testes. */
export function parseWinRing0HelperOutput(raw: string | null | undefined): {
  deviceOpen: boolean
  msr: WinRing0MsrResult[]
  pciWrites: WinRing0PciWriteResult[]
  pci: WinRing0PciResult[]
  error?: string
} | null {
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

  const msr: WinRing0MsrResult[] = []
  const rawMsr = Array.isArray(value.msr) ? value.msr : value.msr ? [value.msr] : []
  for (const entry of rawMsr) {
    if (!isRecord(entry)) continue
    const index = toUnsigned(entry.index)
    if (index === null) continue
    msr.push({ index, value: toBigInt(entry.value) })
  }

  const pciWrites: WinRing0PciWriteResult[] = []
  const rawWrites = Array.isArray(value.pciWrites)
    ? value.pciWrites
    : value.pciWrites
      ? [value.pciWrites]
      : []
  for (const entry of rawWrites) {
    if (!isRecord(entry)) continue
    const bus = toUnsigned(entry.bus)
    const device = toUnsigned(entry.device)
    const fn = toUnsigned(entry.function)
    const offset = toUnsigned(entry.offset)
    if (bus === null || device === null || fn === null || offset === null) continue
    pciWrites.push({ bus, device, function: fn, offset, ok: entry.ok === true })
  }

  const pci: WinRing0PciResult[] = []
  const rawPci = Array.isArray(value.pci) ? value.pci : value.pci ? [value.pci] : []
  for (const entry of rawPci) {
    if (!isRecord(entry)) continue
    const bus = toUnsigned(entry.bus)
    const device = toUnsigned(entry.device)
    const fn = toUnsigned(entry.function)
    const offset = toUnsigned(entry.offset)
    if (bus === null || device === null || fn === null || offset === null) continue
    pci.push({ bus, device, function: fn, offset, value: toUnsigned(entry.value) })
  }

  const error =
    typeof value.error === 'string' && value.error.trim() ? value.error.trim() : undefined
  return { deviceOpen: value.deviceOpen === true, msr, pciWrites, pci, error }
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

  const csharpPath = join(dir, 'KolndWinRing0.cs')
  const dllPath = join(dir, 'KolndWinRing0.dll')
  const scriptPath = join(dir, 'winring0-helper.ps1')

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
      throw new Error('A compilação do helper WinRing0 excedeu o tempo limite.')
    }
    if (!existsSync(dllPath)) {
      const detail = result.stderr.trim() || `código ${result.code ?? 'desconhecido'}`
      throw new Error(`Não foi possível compilar o helper WinRing0: ${detail}`)
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

function pciAddress(request: PciReadRequest): number {
  return ((request.bus & 0xff) << 8) | ((request.device & 0x1f) << 3) | (request.function & 7)
}

function isValidPciAddress(item: PciReadRequest): boolean {
  return (
    Number.isInteger(item.bus) &&
    Number.isInteger(item.device) &&
    Number.isInteger(item.function) &&
    Number.isInteger(item.offset) &&
    item.bus >= 0 &&
    item.bus <= 0xff &&
    item.device >= 0 &&
    item.device <= 0x1f &&
    item.function >= 0 &&
    item.function <= 7 &&
    item.offset >= 0 &&
    item.offset <= 0xff
  )
}

function toPayloadPci(item: PciReadRequest): PciReadRequest & { address: number } {
  return {
    bus: item.bus,
    device: item.device,
    function: item.function,
    offset: item.offset,
    address: pciAddress(item)
  }
}

/**
 * Executa leituras/escritas em lote (MSR + PCI) em uma única chamada ao helper.
 * Nunca lança: qualquer falha vira `ok: false` com `error` amigável.
 */
export async function readWinRing0Batch(
  request: WinRing0BatchRequest,
  timeoutMs: number = HELPER_TIMEOUT_MS
): Promise<WinRing0BatchResult> {
  const msrIndices = (request.msr ?? []).filter(
    (index) => Number.isInteger(index) && index >= 0 && index <= 0xffffffff
  )
  const pciWriteRequests = (request.pciWrites ?? []).filter(
    (item) =>
      isValidPciAddress(item) &&
      Number.isInteger(item.value) &&
      item.value >= 0 &&
      item.value <= 0xffffffff
  )
  const pciRequests = (request.pci ?? []).filter(isValidPciAddress)

  const empty: WinRing0BatchResult = {
    ok: false,
    deviceOpen: false,
    msr: msrIndices.map((index) => ({ index, value: null })),
    pciWrites: pciWriteRequests.map((item) => ({
      bus: item.bus,
      device: item.device,
      function: item.function,
      offset: item.offset,
      ok: false
    })),
    pci: pciRequests.map((item) => ({ ...item, value: null }))
  }

  try {
    const assets = await getAssets()
    const payload = JSON.stringify({
      msr: msrIndices,
      pciWrites: pciWriteRequests.map((item) => ({ ...toPayloadPci(item), value: item.value })),
      pci: pciRequests.map(toPayloadPci)
    })

    const process = await runProcess(
      resolvePowershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', assets.scriptPath],
      payload,
      timeoutMs
    )

    if (process.timedOut) {
      return { ...empty, error: 'A leitura do driver WinRing0 excedeu o tempo limite.' }
    }

    const parsed = parseWinRing0HelperOutput(process.stdout)
    if (!parsed) {
      const detail = process.stderr.trim() || 'resposta inválida do helper'
      warnHelper(`helper WinRing0 falhou: ${detail}`)
      return { ...empty, error: 'Não foi possível ler o driver WinRing0.' }
    }

    const sameAddress = (entry: PciReadRequest, item: PciReadRequest): boolean =>
      entry.bus === item.bus &&
      entry.device === item.device &&
      entry.function === item.function &&
      entry.offset === item.offset

    // Reordena pelo pedido: o helper responde na mesma ordem, mas não confiamos nisso.
    const msr = msrIndices.map(
      (index) => parsed.msr.find((entry) => entry.index === index) ?? { index, value: null }
    )
    const pciWrites = pciWriteRequests.map((item) => ({
      bus: item.bus,
      device: item.device,
      function: item.function,
      offset: item.offset,
      ok: parsed.pciWrites.find((entry) => sameAddress(entry, item))?.ok === true
    }))
    const pci = pciRequests.map((item) => {
      const match = parsed.pci.find((entry) => sameAddress(entry, item))
      return { ...item, value: match?.value ?? null }
    })

    return {
      ok: !parsed.error,
      deviceOpen: parsed.deviceOpen,
      msr,
      pciWrites,
      pci,
      error: parsed.error
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warnHelper(`helper WinRing0 indisponível: ${message}`)
    return { ...empty, error: 'O driver WinRing0 não está disponível.' }
  }
}

/** true somente quando o device abriu de fato (driver instalado e acessível). */
export async function probeWinRing0(): Promise<boolean> {
  const result = await readWinRing0Batch({})
  return result.ok && result.deviceOpen
}
