import { app, ipcMain } from 'electron'
import { logger } from './logger'
import { runPowerShellCommand } from './hwmon/powershell'
import type { IpcContext } from './ipc/lifecycle'
import {
  buildResolutions,
  buildScaleInfo,
  DISPLAY_CONFIRM_TIMEOUT_MS,
  DISPLAY_SCALE_STEPS,
  resolutionErrorMessage,
  scaleErrorMessage,
  scaleRelForPercent,
  type DisplayChangeTicket,
  type DisplayConfirmResult,
  type DisplayInfo,
  type DisplayMode,
  type DisplayRevertedEvent,
  type DisplaySetResult
} from '../shared/display'

/**
 * Escala, resolução e taxa de atualização por monitor (aba Tela em Meu PC).
 *
 * Sem dependências nativas: um script PowerShell 5.1 com C# inline (`Add-Type`)
 * fala direto com EnumDisplayDevices/EnumDisplaySettings/ChangeDisplaySettingsEx
 * e com a API de DisplayConfig (DPI e nome amigável). O Windows já persiste
 * resolução/escala — nada vai para o electron-store. Saída do script: uma linha
 * JSON em UTF-8.
 */

const TIMEOUT_MS = 20_000
const MIN_WIDTH = 320
const MAX_WIDTH = 16384
const MIN_HEIGHT = 200
const MAX_HEIGHT = 16384
const MIN_REFRESH_HZ = 20
const MAX_REFRESH_HZ = 1000
const MAX_DISPLAY_ID_LENGTH = 32
const MAX_DISPLAY_NAME_LENGTH = 200

/** Nome GDI exato (`\\.\DISPLAY1`) — nada além disso entra no comando. */
const DISPLAY_ID_PATTERN = /^\\\\\.\\DISPLAY\d{1,3}$/

const GENERIC_PROBE_ERROR = 'Não foi possível consultar as configurações de tela do Windows.'
const GENERIC_RESOLUTION_ERROR = 'Não foi possível alterar a resolução de tela. Tente novamente.'
const GENERIC_SCALE_ERROR = 'Não foi possível alterar a escala da tela. Tente novamente.'
const MONITOR_INVALID_ERROR = 'Monitor inválido.'
const MONITOR_NOT_FOUND_ERROR = 'Monitor não encontrado.'
const MONITOR_PROBE_ERROR = 'Não foi possível consultar os monitores.'

const PROBE_ERROR_MESSAGES: Record<string, string> = {
  query: 'Não foi possível consultar a resolução atual da tela.',
  dpi: 'Não foi possível consultar a escala da tela.',
  mode: 'Não foi possível listar os monitores ou as resoluções disponíveis.',
  load: 'Não foi possível carregar o suporte de tela do Windows.',
  ps: 'Não foi possível consultar as configurações de tela do Windows.'
}

type DisplayAction = 'Info' | 'SetResolution' | 'SetScale'

interface RawScale {
  minRel: number
  curRel: number
  maxRel: number
}

interface RawDisplay {
  id: string
  name: string
  primary: boolean
  width: number
  height: number
  refreshHz: number
  modes: DisplayMode[]
  scale: RawScale | null
  preferred: { width: number; height: number } | null
}

interface RawProbe {
  displays: RawDisplay[]
}

type RawProbeParse = { ok: true; probe: RawProbe } | { ok: false; error: string }

// C# 5 (PowerShell 5.1): sem interpolação de string, `out var`, `?.` ou tuplas.
// Strings JSON usam literais verbatim ("" para aspas) e o helper JsonString
// monta aspas/barras por código — a fonte atravessa a template string intacta.
const DISPLAY_SCRIPT = `try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {
}

$ErrorActionPreference = 'Stop'

try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public class DisplayCtl
{
    private const int ENUM_CURRENT_SETTINGS = -1;
    private const uint QDC_ONLY_ACTIVE_PATHS = 0x00000002;
    private const uint CDS_UPDATEREGISTRY = 0x00000001;
    private const uint DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x00000001;
    private const uint DISPLAY_DEVICE_PRIMARY_DEVICE = 0x00000004;
    private const int INFO_GET_SOURCE_NAME = 1;
    private const int INFO_GET_TARGET_NAME = 2;
    private const int INFO_GET_TARGET_PREFERRED_MODE = 3;
    private const int INFO_GET_DPI_SCALE = -3;
    private const int INFO_SET_DPI_SCALE = -4;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;
    private const int ERROR_NOT_FOUND = 1168;
    private const int ERROR_INVALID_PARAMETER = 87;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public ushort dmSpecVersion;
        public ushort dmDriverVersion;
        public ushort dmSize;
        public ushort dmDriverExtra;
        public uint dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public uint dmDisplayOrientation;
        public uint dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel;
        public uint dmPelsWidth;
        public uint dmPelsHeight;
        public uint dmDisplayFlags;
        public uint dmDisplayFrequency;
        public uint dmICMMethod;
        public uint dmICMIntent;
        public uint dmMediaType;
        public uint dmDitherType;
        public uint dmReserved1;
        public uint dmReserved2;
        public uint dmPanningWidth;
        public uint dmPanningHeight;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;
        public uint StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_PATH_SOURCE_INFO
    {
        public LUID adapterId;
        public uint id;
        public uint modeInfoIdx;
        public uint statusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_RATIONAL
    {
        public uint Numerator;
        public uint Denominator;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_PATH_TARGET_INFO
    {
        public LUID adapterId;
        public uint id;
        public uint modeInfoIdx;
        public uint outputTechnology;
        public uint rotation;
        public uint scaling;
        public DISPLAYCONFIG_RATIONAL refreshRate;
        public uint scanLineOrdering;
        public int targetAvailable;
        public uint statusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_PATH_INFO
    {
        public DISPLAYCONFIG_PATH_SOURCE_INFO sourceInfo;
        public DISPLAYCONFIG_PATH_TARGET_INFO targetInfo;
        public uint flags;
    }

    [StructLayout(LayoutKind.Sequential, Size = 64)]
    public struct DISPLAYCONFIG_MODE_INFO
    {
        public uint infoType;
        public uint id;
        public LUID adapterId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_DEVICE_INFO_HEADER
    {
        public int type;
        public uint size;
        public LUID adapterId;
        public uint id;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAYCONFIG_SOURCE_DEVICE_NAME
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string viewGdiDeviceName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAYCONFIG_TARGET_DEVICE_NAME
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public uint flags;
        public uint outputTechnology;
        public ushort edidManufactureId;
        public ushort edidProductCodeId;
        public uint connectorInstance;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string monitorFriendlyDeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string monitorDevicePath;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_DPI_SCALE
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public int minScaleRel;
        public int curScaleRel;
        public int maxScaleRel;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_SET_DPI_SCALE
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public int scaleRel;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_2DREGION
    {
        public uint cx;
        public uint cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_VIDEO_SIGNAL_INFO
    {
        public ulong pixelRate;
        public DISPLAYCONFIG_RATIONAL hSyncFreq;
        public DISPLAYCONFIG_RATIONAL vSyncFreq;
        public DISPLAYCONFIG_2DREGION activeSize;
        public DISPLAYCONFIG_2DREGION totalSize;
        public uint videoStandard;
        public uint scanLineOrdering;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_TARGET_MODE
    {
        public DISPLAYCONFIG_VIDEO_SIGNAL_INFO targetVideoSignalInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_TARGET_PREFERRED_MODE
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public uint width;
        public uint height;
        public DISPLAYCONFIG_TARGET_MODE targetMode;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumDisplaySettings(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref DEVMODE lpDevMode, IntPtr hwnd, uint dwflags, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);

    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(uint flags, ref uint numPathArrayElements, [Out] DISPLAYCONFIG_PATH_INFO[] pathInfoArray, ref uint numModeInfoArrayElements, [Out] DISPLAYCONFIG_MODE_INFO[] modeInfoArray, IntPtr currentTopologyId);

    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_SOURCE_DEVICE_NAME requestPacket);

    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_TARGET_DEVICE_NAME requestPacket);

    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_DPI_SCALE requestPacket);

    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_TARGET_PREFERRED_MODE requestPacket);

    [DllImport("user32.dll")]
    private static extern int DisplayConfigSetDeviceInfo(ref DISPLAYCONFIG_SET_DPI_SCALE packet);

    private static DEVMODE CreateDevMode()
    {
        DEVMODE dm = new DEVMODE();
        dm.dmDeviceName = string.Empty;
        dm.dmFormName = string.Empty;
        dm.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));
        return dm;
    }

    private static string JsonInt(int value)
    {
        return value.ToString(CultureInfo.InvariantCulture);
    }

    // Aspas (34) e barras (92) montadas por código: a fonte sobrevive intacta à
    // template string do TypeScript, sem depender de escapes.
    private static string JsonString(string value)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append((char)34);
        if (value != null)
        {
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c == (char)34)
                {
                    sb.Append((char)92).Append((char)34);
                }
                else if (c == (char)92)
                {
                    sb.Append((char)92).Append((char)92);
                }
                else if (c == (char)8)
                {
                    sb.Append((char)92).Append('b');
                }
                else if (c == (char)12)
                {
                    sb.Append((char)92).Append('f');
                }
                else if (c == (char)10)
                {
                    sb.Append((char)92).Append('n');
                }
                else if (c == (char)13)
                {
                    sb.Append((char)92).Append('r');
                }
                else if (c == (char)9)
                {
                    sb.Append((char)92).Append('t');
                }
                else if (c < (char)32)
                {
                    sb.Append((char)92).Append('u');
                    sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                }
                else
                {
                    sb.Append(c);
                }
            }
        }
        sb.Append((char)34);
        return sb.ToString();
    }

    private static void AppendMode(StringBuilder sb, ref int count, int width, int height, int refreshHz)
    {
        if (count > 0) sb.Append(',');
        sb.Append(@"{""width"":").Append(JsonInt(width));
        sb.Append(@",""height"":").Append(JsonInt(height));
        sb.Append(@",""refreshHz"":").Append(JsonInt(refreshHz));
        sb.Append('}');
        count++;
    }

    private static int QueryPaths(out DISPLAYCONFIG_PATH_INFO[] paths, out DISPLAYCONFIG_MODE_INFO[] modes)
    {
        paths = null;
        modes = null;
        for (int attempt = 0; attempt < 2; attempt++)
        {
            uint pathCount;
            uint modeCount;
            int err = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCount, out modeCount);
            if (err != 0) return err;
            if (pathCount == 0) return ERROR_NOT_FOUND;

            DISPLAYCONFIG_PATH_INFO[] foundPaths = new DISPLAYCONFIG_PATH_INFO[pathCount];
            DISPLAYCONFIG_MODE_INFO[] foundModes = new DISPLAYCONFIG_MODE_INFO[modeCount];
            uint currentPaths = pathCount;
            uint currentModes = modeCount;
            err = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref currentPaths, foundPaths, ref currentModes, foundModes, IntPtr.Zero);
            if (err == ERROR_INSUFFICIENT_BUFFER) continue;
            if (err != 0) return err;

            Array.Resize(ref foundPaths, (int)currentPaths);
            Array.Resize(ref foundModes, (int)currentModes);
            paths = foundPaths;
            modes = foundModes;
            return 0;
        }
        return ERROR_INSUFFICIENT_BUFFER;
    }

    private static int FindPathIndex(DISPLAYCONFIG_PATH_INFO[] paths, string deviceName)
    {
        for (int i = 0; i < paths.Length; i++)
        {
            string name = GetSourceName(paths[i]);
            if (name != null && string.Equals(name, deviceName, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }
        return -1;
    }

    private static string GetSourceName(DISPLAYCONFIG_PATH_INFO path)
    {
        DISPLAYCONFIG_SOURCE_DEVICE_NAME request = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
        request.viewGdiDeviceName = string.Empty;
        request.header.type = INFO_GET_SOURCE_NAME;
        request.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME));
        request.header.adapterId = path.sourceInfo.adapterId;
        request.header.id = path.sourceInfo.id;
        int err = DisplayConfigGetDeviceInfo(ref request);
        if (err != 0) return null;
        return request.viewGdiDeviceName;
    }

    private static bool TryGetScale(DISPLAYCONFIG_PATH_INFO path, out int minRel, out int curRel, out int maxRel)
    {
        minRel = 0;
        curRel = 0;
        maxRel = 0;
        DISPLAYCONFIG_DPI_SCALE request = new DISPLAYCONFIG_DPI_SCALE();
        request.header.type = INFO_GET_DPI_SCALE;
        request.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_DPI_SCALE));
        request.header.adapterId = path.sourceInfo.adapterId;
        request.header.id = path.sourceInfo.id;
        int err = DisplayConfigGetDeviceInfo(ref request);
        if (err != 0) return false;
        minRel = request.minScaleRel;
        curRel = request.curScaleRel;
        maxRel = request.maxScaleRel;
        return true;
    }

    private static bool TryGetPreferred(DISPLAYCONFIG_PATH_INFO path, out int width, out int height)
    {
        width = 0;
        height = 0;
        DISPLAYCONFIG_TARGET_PREFERRED_MODE request = new DISPLAYCONFIG_TARGET_PREFERRED_MODE();
        request.header.type = INFO_GET_TARGET_PREFERRED_MODE;
        request.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_TARGET_PREFERRED_MODE));
        request.header.adapterId = path.targetInfo.adapterId;
        request.header.id = path.targetInfo.id;
        int err = DisplayConfigGetDeviceInfo(ref request);
        if (err != 0) return false;
        width = (int)request.width;
        height = (int)request.height;
        return width > 0 && height > 0;
    }

    private static string TryGetFriendlyName(DISPLAYCONFIG_PATH_INFO path)
    {
        DISPLAYCONFIG_TARGET_DEVICE_NAME request = new DISPLAYCONFIG_TARGET_DEVICE_NAME();
        request.monitorFriendlyDeviceName = string.Empty;
        request.monitorDevicePath = string.Empty;
        request.header.type = INFO_GET_TARGET_NAME;
        request.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_TARGET_DEVICE_NAME));
        request.header.adapterId = path.targetInfo.adapterId;
        request.header.id = path.targetInfo.id;
        int err = DisplayConfigGetDeviceInfo(ref request);
        if (err != 0) return null;
        string name = request.monitorFriendlyDeviceName;
        if (name == null) return null;
        name = name.Trim();
        return name.Length > 0 ? name : null;
    }

    private static string GetFallbackName(string deviceName)
    {
        DISPLAY_DEVICE monitor = new DISPLAY_DEVICE();
        monitor.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
        if (!EnumDisplayDevices(deviceName, 0, ref monitor, 0)) return null;
        string name = monitor.DeviceString;
        if (name == null) return null;
        name = name.Trim();
        return name.Length > 0 ? name : null;
    }

    public static string Probe()
    {
        // Sem DisplayConfig (ex.: sessão RDP) resolução e Hz continuam
        // funcionando: só escala, nome amigável e modo preferido degradam.
        DISPLAYCONFIG_PATH_INFO[] paths;
        DISPLAYCONFIG_MODE_INFO[] modeInfos;
        int queryError = QueryPaths(out paths, out modeInfos);
        if (queryError != 0)
        {
            paths = new DISPLAYCONFIG_PATH_INFO[0];
            modeInfos = new DISPLAYCONFIG_MODE_INFO[0];
        }

        StringBuilder displaysJson = new StringBuilder();
        int displayCount = 0;

        for (uint adapter = 0; adapter < 32; adapter++)
        {
            DISPLAY_DEVICE device = new DISPLAY_DEVICE();
            device.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
            if (!EnumDisplayDevices(null, adapter, ref device, 0)) break;
            if ((device.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) continue;

            string deviceName = device.DeviceName;
            if (deviceName == null || deviceName.Length == 0) continue;

            DEVMODE current = CreateDevMode();
            if (!EnumDisplaySettings(deviceName, ENUM_CURRENT_SETTINGS, ref current)) continue;

            StringBuilder modesJson = new StringBuilder();
            int modeCount = 0;
            for (int i = 0; i < 10000; i++)
            {
                DEVMODE mode = CreateDevMode();
                if (!EnumDisplaySettings(deviceName, i, ref mode)) break;
                if (mode.dmBitsPerPel != 32) continue;
                int hz = (int)mode.dmDisplayFrequency;
                if (hz < 20 || hz > 1000) continue;
                int width = (int)mode.dmPelsWidth;
                int height = (int)mode.dmPelsHeight;
                if (width <= 0 || height <= 0) continue;
                AppendMode(modesJson, ref modeCount, width, height, hz);
            }

            // O modo atual nem sempre aparece na enumeração por índice; sem ele
            // a UI não conseguiria exibir o Hz vigente.
            if (current.dmBitsPerPel == 32)
            {
                int currentHz = (int)current.dmDisplayFrequency;
                if (currentHz >= 20 && currentHz <= 1000)
                {
                    AppendMode(modesJson, ref modeCount, (int)current.dmPelsWidth, (int)current.dmPelsHeight, currentHz);
                }
            }
            if (modeCount == 0) continue;

            int pathIndex = FindPathIndex(paths, deviceName);

            int minRel = 0;
            int curRel = 0;
            int maxRel = 0;
            bool scaleOk = pathIndex >= 0 && TryGetScale(paths[pathIndex], out minRel, out curRel, out maxRel);

            int preferredWidth = 0;
            int preferredHeight = 0;
            bool preferredOk = pathIndex >= 0 && TryGetPreferred(paths[pathIndex], out preferredWidth, out preferredHeight);

            string name = pathIndex >= 0 ? TryGetFriendlyName(paths[pathIndex]) : null;
            if (name == null) name = GetFallbackName(deviceName);
            if (name == null) name = "Monitor " + JsonInt(displayCount + 1);

            bool primary = (device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE) != 0;

            if (displayCount > 0) displaysJson.Append(',');
            displaysJson.Append(@"{""id"":").Append(JsonString(deviceName));
            displaysJson.Append(@",""name"":").Append(JsonString(name));
            displaysJson.Append(@",""primary"":").Append(primary ? "true" : "false");
            displaysJson.Append(@",""width"":").Append(JsonInt((int)current.dmPelsWidth));
            displaysJson.Append(@",""height"":").Append(JsonInt((int)current.dmPelsHeight));
            displaysJson.Append(@",""refreshHz"":").Append(JsonInt((int)current.dmDisplayFrequency));
            displaysJson.Append(@",""modes"":[").Append(modesJson.ToString()).Append(']');
            if (scaleOk)
            {
                displaysJson.Append(@",""scale"":{""minRel"":").Append(JsonInt(minRel));
                displaysJson.Append(@",""curRel"":").Append(JsonInt(curRel));
                displaysJson.Append(@",""maxRel"":").Append(JsonInt(maxRel)).Append('}');
            }
            else
            {
                displaysJson.Append(@",""scale"":null");
            }
            if (preferredOk)
            {
                displaysJson.Append(@",""preferred"":{""width"":").Append(JsonInt(preferredWidth));
                displaysJson.Append(@",""height"":").Append(JsonInt(preferredHeight)).Append('}');
            }
            else
            {
                displaysJson.Append(@",""preferred"":null");
            }
            displaysJson.Append('}');
            displayCount++;
        }

        if (displayCount == 0)
        {
            return @"{""ok"":false,""error"":""mode""}";
        }

        return @"{""ok"":true,""displays"":[" + displaysJson.ToString() + "]}";
    }

    public static int SetResolution(string deviceName, int width, int height, int refreshHz)
    {
        DEVMODE best = CreateDevMode();
        bool found = false;
        int bestRefresh = -1;
        for (int i = 0; i < 10000; i++)
        {
            DEVMODE mode = CreateDevMode();
            if (!EnumDisplaySettings(deviceName, i, ref mode)) break;
            if ((int)mode.dmPelsWidth != width || (int)mode.dmPelsHeight != height) continue;
            if (mode.dmBitsPerPel != 32) continue;
            int hz = (int)mode.dmDisplayFrequency;
            if (hz < 20 || hz > 1000) continue;
            if (refreshHz > 0 && hz != refreshHz) continue;
            if (!found || hz > bestRefresh)
            {
                best = mode;
                bestRefresh = hz;
                found = true;
            }
        }
        if (!found) return -100;
        return ChangeDisplaySettingsEx(deviceName, ref best, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
    }

    public static int SetScale(string deviceName, int scaleRel)
    {
        DISPLAYCONFIG_PATH_INFO[] paths;
        DISPLAYCONFIG_MODE_INFO[] modeInfos;
        int queryError = QueryPaths(out paths, out modeInfos);
        if (queryError != 0) return queryError;

        int firstError = 0;
        int successes = 0;
        int matches = 0;
        for (int i = 0; i < paths.Length; i++)
        {
            string name = GetSourceName(paths[i]);
            if (name == null || !string.Equals(name, deviceName, StringComparison.OrdinalIgnoreCase)) continue;
            matches++;

            int minRel;
            int curRel;
            int maxRel;
            if (!TryGetScale(paths[i], out minRel, out curRel, out maxRel))
            {
                if (firstError == 0) firstError = ERROR_INVALID_PARAMETER;
                continue;
            }
            if (scaleRel < minRel || scaleRel > maxRel)
            {
                if (firstError == 0) firstError = -100;
                continue;
            }

            DISPLAYCONFIG_SET_DPI_SCALE request = new DISPLAYCONFIG_SET_DPI_SCALE();
            request.header.type = INFO_SET_DPI_SCALE;
            request.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_SET_DPI_SCALE));
            request.header.adapterId = paths[i].sourceInfo.adapterId;
            request.header.id = paths[i].sourceInfo.id;
            request.scaleRel = scaleRel;
            int err = DisplayConfigSetDeviceInfo(ref request);
            if (err == 0) successes++;
            else if (firstError == 0) firstError = err;
        }

        if (matches == 0) return ERROR_NOT_FOUND;
        // Em mirroring a mesma source pode aparecer em mais de uma path: basta
        // uma ter aceitado para o desktop já estar na escala pedida.
        return successes > 0 ? 0 : firstError;
    }
}
'@
} catch {
    Write-Output '{"ok":false,"error":"load"}'
    exit 0
}

switch ($action) {
    'Info' {
        Write-Output ([DisplayCtl]::Probe())
    }
    'SetResolution' {
        $rc = [DisplayCtl]::SetResolution($argDevice, $argW, $argH, $argHz)
        if ($rc -eq 0) { Write-Output '{"ok":true,"rc":0}' } else { Write-Output ('{"ok":false,"rc":' + $rc + '}') }
    }
    'SetScale' {
        $rc = [DisplayCtl]::SetScale($argDevice, $argRel)
        if ($rc -eq 0) { Write-Output '{"ok":true,"rc":0}' } else { Write-Output ('{"ok":false,"rc":' + $rc + '}') }
    }
    default {
        Write-Output '{"ok":false,"error":"ps"}'
    }
}
`

function buildDisplayCommand(
  action: DisplayAction,
  values: {
    device?: string
    width?: number
    height?: number
    refreshHz?: number
    scaleRel?: number
  } = {}
): string {
  const header = [
    `$action = '${action}'`,
    `$argDevice = '${values.device ?? ''}'`,
    `$argW = ${values.width ?? 0}`,
    `$argH = ${values.height ?? 0}`,
    `$argHz = ${values.refreshHz ?? 0}`,
    `$argRel = ${values.scaleRel ?? 0}`,
    ''
  ].join('\n')
  return header + DISPLAY_SCRIPT
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Inteiro dentro da faixa; `null` para NaN, fração, string ou fora dos limites. */
function readInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < min || value > max) return null
  return value
}

/** Só aceita o nome GDI exato — o valor é interpolado no comando PowerShell. */
function readDisplayId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_DISPLAY_ID_LENGTH) return null
  return DISPLAY_ID_PATTERN.test(value) ? value : null
}

/** Última linha não vazia que começa com `{` — o resto do stdout é ruído. */
function lastJsonLine(raw: string): string | null {
  const lines = raw.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith('{')) return line
  }
  return null
}

function probeErrorText(token: unknown): string {
  if (typeof token === 'string') {
    const message = PROBE_ERROR_MESSAGES[token]
    if (message) return message
  }
  return GENERIC_PROBE_ERROR
}

function readRawScale(value: unknown): RawScale | null {
  if (!isRecord(value)) return null
  const minRel = readInt(value.minRel, -12, 12)
  const curRel = readInt(value.curRel, -12, 12)
  const maxRel = readInt(value.maxRel, 0, 12)
  if (minRel === null || curRel === null || maxRel === null) return null
  return { minRel, curRel, maxRel }
}

function readPreferred(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null
  const width = readInt(value.width, 1, MAX_WIDTH)
  const height = readInt(value.height, 1, MAX_HEIGHT)
  if (width === null || height === null) return null
  return { width, height }
}

function readRawModes(value: unknown): DisplayMode[] {
  if (!Array.isArray(value)) return []
  const modes: DisplayMode[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const width = readInt(entry.width, 1, MAX_WIDTH)
    const height = readInt(entry.height, 1, MAX_HEIGHT)
    const refreshHz = readInt(entry.refreshHz, MIN_REFRESH_HZ, MAX_REFRESH_HZ)
    if (width === null || height === null || refreshHz === null) continue
    modes.push({ width, height, refreshHz })
  }
  return modes
}

function readRawDisplay(value: unknown, index: number): RawDisplay | null {
  if (!isRecord(value)) return null

  const id = readDisplayId(value.id)
  if (id === null) return null

  const width = readInt(value.width, 1, MAX_WIDTH)
  const height = readInt(value.height, 1, MAX_HEIGHT)
  const refreshHz = readInt(value.refreshHz, 0, MAX_REFRESH_HZ)
  if (width === null || height === null || refreshHz === null) return null

  const modes = readRawModes(value.modes)
  if (modes.length === 0) return null

  const rawName = typeof value.name === 'string' ? value.name.trim() : ''
  const name =
    rawName.length > 0 && rawName.length <= MAX_DISPLAY_NAME_LENGTH
      ? rawName
      : `Monitor ${index + 1}`

  return {
    id,
    name,
    primary: value.primary === true,
    width,
    height,
    refreshHz,
    modes,
    scale: readRawScale(value.scale),
    preferred: readPreferred(value.preferred)
  }
}

function parseRawProbe(raw: string): RawProbeParse {
  const line = lastJsonLine(raw)
  if (!line) return { ok: false, error: GENERIC_PROBE_ERROR }

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { ok: false, error: GENERIC_PROBE_ERROR }
  }
  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') {
    return { ok: false, error: GENERIC_PROBE_ERROR }
  }
  if (!parsed.ok) return { ok: false, error: probeErrorText(parsed.error) }

  if (!Array.isArray(parsed.displays)) return { ok: false, error: probeErrorText('mode') }

  const displays: RawDisplay[] = []
  const seen = new Set<string>()
  for (const [index, entry] of parsed.displays.entries()) {
    const display = readRawDisplay(entry, index)
    if (!display || seen.has(display.id)) continue
    seen.add(display.id)
    displays.push(display)
  }
  if (displays.length === 0) return { ok: false, error: probeErrorText('mode') }

  return { ok: true, probe: { displays } }
}

/** Converte o stdout do script em `DisplayInfo`; nunca lança. */
export function parseDisplayProbe(raw: string): DisplayInfo {
  const parsed = parseRawProbe(raw)
  if (!parsed.ok) return { ok: false, displays: [], error: parsed.error }

  return {
    ok: true,
    displays: parsed.probe.displays.map((display) => ({
      id: display.id,
      name: display.name,
      primary: display.primary,
      width: display.width,
      height: display.height,
      refreshHz: display.refreshHz,
      resolutions: buildResolutions(display.modes, display.preferred),
      scale: display.scale
        ? buildScaleInfo(display.scale.minRel, display.scale.curRel, display.scale.maxRel)
        : null
    }))
  }
}

interface SetOutcome {
  ok: boolean
  rc: number
}

function parseSetOutcome(raw: string): SetOutcome | null {
  const line = lastJsonLine(raw)
  if (!line) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') return null

  const rc = readInt(parsed.rc, -100000, 100000)
  if (rc === null) return null
  return { ok: parsed.ok, rc }
}

async function readProbe(): Promise<RawProbe | null> {
  const result = await runPowerShellCommand(buildDisplayCommand('Info'), TIMEOUT_MS)
  if (result.timedOut) return null
  const parsed = parseRawProbe(result.stdout)
  return parsed.ok ? parsed.probe : null
}

function findDisplay(probe: RawProbe, id: string): RawDisplay | null {
  return probe.displays.find((display) => display.id === id) ?? null
}

/** Só roda o script e traduz o retorno; nunca agenda confirmação. */
async function executeMode(
  displayId: string,
  width: number,
  height: number,
  refreshHz: number
): Promise<{ ok: boolean; error?: string }> {
  const result = await runPowerShellCommand(
    buildDisplayCommand('SetResolution', { device: displayId, width, height, refreshHz }),
    TIMEOUT_MS
  )
  if (result.timedOut) {
    logger.warn('display', 'tempo esgotado ao alterar a resolução')
    return { ok: false, error: 'A alteração demorou demais e foi interrompida. Tente novamente.' }
  }

  const outcome = parseSetOutcome(result.stdout)
  if (!outcome) {
    logger.warn('display', 'resposta inválida ao alterar a resolução')
    return { ok: false, error: GENERIC_RESOLUTION_ERROR }
  }
  if (outcome.ok) {
    logger.info(
      'display',
      `${displayId}: resolução alterada para ${width}x${height}@${refreshHz}Hz`
    )
    return { ok: true }
  }

  logger.warn(
    'display',
    `${displayId}: resolução ${width}x${height}@${refreshHz}Hz recusada (rc ${outcome.rc})`
  )
  return { ok: false, error: resolutionErrorMessage(outcome.rc) }
}

/** Só roda o script e traduz o retorno; nunca agenda confirmação. */
async function executeScale(
  displayId: string,
  scaleRel: number
): Promise<{ ok: boolean; error?: string }> {
  const result = await runPowerShellCommand(
    buildDisplayCommand('SetScale', { device: displayId, scaleRel }),
    TIMEOUT_MS
  )
  if (result.timedOut) {
    logger.warn('display', 'tempo esgotado ao alterar a escala')
    return { ok: false, error: 'A alteração demorou demais e foi interrompida. Tente novamente.' }
  }

  const outcome = parseSetOutcome(result.stdout)
  if (!outcome) {
    logger.warn('display', 'resposta inválida ao alterar a escala')
    return { ok: false, error: GENERIC_SCALE_ERROR }
  }
  if (outcome.ok) {
    logger.info('display', `${displayId}: escala alterada (rel ${scaleRel})`)
    return { ok: true }
  }

  logger.warn('display', `${displayId}: escala rel ${scaleRel} recusada (rc ${outcome.rc})`)
  return { ok: false, error: scaleErrorMessage(outcome.rc) }
}

function readScalePercent(value: unknown): number | null {
  const percent = readInt(value, 100, 500)
  if (percent === null) return null
  return (DISPLAY_SCALE_STEPS as readonly number[]).includes(percent) ? percent : null
}

interface PendingConfirmation {
  id: number
  timer: ReturnType<typeof setTimeout>
  /** Reaplica o estado anterior — nunca agenda uma nova confirmação. */
  revert: () => Promise<{ ok: boolean; error?: string }>
}

let ipcContext: IpcContext | null = null
let pendingConfirmation: PendingConfirmation | null = null
// Revert automático em andamento: o confirm/revert manual aguarda para não
// responder antes de a tela voltar (corrida no limite dos 10 s).
let revertInFlight: Promise<{ ok: boolean; error?: string }> | null = null
let nextChangeId = 1

/** Confirma (commit) a mudança pendente sem tocar na tela. */
function clearPendingConfirmation(): void {
  if (!pendingConfirmation) return
  clearTimeout(pendingConfirmation.timer)
  pendingConfirmation = null
}

/** Executa o revert pendente imediatamente, se houver. */
function takePendingRevert(): (() => Promise<{ ok: boolean; error?: string }>) | null {
  if (!pendingConfirmation) return null
  const { revert } = pendingConfirmation
  clearPendingConfirmation()
  return revert
}

function sendReverted(event: DisplayRevertedEvent): void {
  const window = ipcContext?.getMainWindow()
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send('display:change-reverted', event)
  } catch {
    // Janela fechando entre a checagem e o envio: nada a fazer.
  }
}

function revertOnTimeout(
  changeId: number,
  revert: () => Promise<{ ok: boolean; error?: string }>
): void {
  logger.info('display', `confirmação ${changeId} expirou — revertendo`)
  const task = revert()
    .then((result) => {
      sendReverted({ changeId, ok: result.ok, error: result.error })
      return result
    })
    .catch((err: unknown) => {
      logger.warn('display', `revert automático falhou: ${String(err)}`)
      const error =
        'Não foi possível reverter a alteração automaticamente. Verifique as configurações de tela.'
      sendReverted({ changeId, ok: false, error })
      return { ok: false, error }
    })
  revertInFlight = task
  void task.finally(() => {
    if (revertInFlight === task) revertInFlight = null
  })
}

/**
 * Agenda a confirmação de uma mudança já aplicada. Só um pendente por vez:
 * iniciar outra alteração confirma a anterior (clearTimeout), como o Windows.
 */
function scheduleConfirmation(
  revert: () => Promise<{ ok: boolean; error?: string }>
): DisplayChangeTicket {
  clearPendingConfirmation()

  const id = nextChangeId++
  const timeoutMs = DISPLAY_CONFIRM_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const timer = setTimeout(() => {
    if (!pendingConfirmation || pendingConfirmation.id !== id) return
    pendingConfirmation = null
    revertOnTimeout(id, revert)
  }, timeoutMs)
  timer.unref?.()

  pendingConfirmation = { id, timer, revert }
  return { id, timeoutMs, deadline }
}

/** Apenas para testes: zera timer/pendente (sem reverter). */
export function resetDisplayConfirmationForTests(): void {
  clearPendingConfirmation()
  ipcContext = null
  revertInFlight = null
  nextChangeId = 1
}

/** Registra os canais IPC de monitor/escala/resolução/taxa de atualização. */
export function registerDisplayIpc(ctx: IpcContext): void {
  ipcContext = ctx

  ipcMain.handle('display:get', async (): Promise<DisplayInfo> => {
    try {
      const result = await runPowerShellCommand(buildDisplayCommand('Info'), TIMEOUT_MS)
      const info = parseDisplayProbe(result.stdout)
      if (info.ok) {
        const modes = info.displays
          .map((display) => `${display.id} ${display.width}x${display.height}@${display.refreshHz}`)
          .join(', ')
        logger.info('display', `monitores: ${modes}`)
      } else {
        logger.warn('display', `leitura das configurações de tela falhou: ${info.error ?? '?'}`)
      }
      return info
    } catch (err) {
      logger.warn('display', `falha inesperada na leitura de tela: ${String(err)}`)
      return { ok: false, displays: [], error: GENERIC_PROBE_ERROR }
    }
  })

  ipcMain.handle(
    'display:set-resolution',
    async (
      _event,
      displayId: unknown,
      width: unknown,
      height: unknown,
      refreshHz: unknown
    ): Promise<DisplaySetResult> => {
      const id = readDisplayId(displayId)
      if (id === null) return { ok: false, error: MONITOR_INVALID_ERROR }

      const nextWidth = readInt(width, MIN_WIDTH, MAX_WIDTH)
      const nextHeight = readInt(height, MIN_HEIGHT, MAX_HEIGHT)
      if (nextWidth === null || nextHeight === null) {
        return { ok: false, error: 'Resolução inválida.' }
      }
      const nextHz = readInt(refreshHz, MIN_REFRESH_HZ, MAX_REFRESH_HZ)
      if (nextHz === null) {
        return { ok: false, error: 'Taxa de atualização inválida.' }
      }

      try {
        const probe = await readProbe()
        if (!probe) return { ok: false, error: MONITOR_PROBE_ERROR }
        const display = findDisplay(probe, id)
        if (!display) return { ok: false, error: MONITOR_NOT_FOUND_ERROR }

        // Estado anterior do monitor: é o que o timeout/manual restaura.
        const previous = {
          width: display.width,
          height: display.height,
          refreshHz: display.refreshHz
        }

        const applied = await executeMode(id, nextWidth, nextHeight, nextHz)
        if (!applied.ok) return applied

        const change = scheduleConfirmation(() =>
          executeMode(id, previous.width, previous.height, previous.refreshHz)
        )
        return { ok: true, change }
      } catch (err) {
        logger.warn('display', `falha inesperada ao alterar a resolução: ${String(err)}`)
        return { ok: false, error: GENERIC_RESOLUTION_ERROR }
      }
    }
  )

  ipcMain.handle(
    'display:set-scale',
    async (_event, displayId: unknown, percent: unknown): Promise<DisplaySetResult> => {
      const id = readDisplayId(displayId)
      if (id === null) return { ok: false, error: MONITOR_INVALID_ERROR }

      const nextPercent = readScalePercent(percent)
      if (nextPercent === null) {
        return { ok: false, error: 'Escala inválida.' }
      }

      try {
        // O IPC recebe percentual; a API de DPI espera o índice relativo ao
        // recomendado daquele monitor, que só o probe atual informa.
        const probe = await readProbe()
        if (!probe) return { ok: false, error: MONITOR_PROBE_ERROR }
        const display = findDisplay(probe, id)
        if (!display) return { ok: false, error: MONITOR_NOT_FOUND_ERROR }

        const scaleInfo = display.scale
          ? buildScaleInfo(display.scale.minRel, display.scale.curRel, display.scale.maxRel)
          : null
        if (!display.scale || !scaleInfo) {
          logger.warn('display', `${id}: escala indisponível ao tentar alterar`)
          return { ok: false, error: 'Não foi possível ler a escala atual da tela.' }
        }

        const scaleRel = scaleRelForPercent(
          nextPercent,
          scaleInfo.recommended,
          display.scale.minRel,
          display.scale.maxRel
        )
        if (scaleRel === null) {
          logger.warn('display', `${id}: escala ${nextPercent}% fora dos degraus suportados`)
          return { ok: false, error: scaleErrorMessage(-100) }
        }

        // Índice relativo bruto anterior: o revert não depende do percentual.
        const previousRel = display.scale.curRel
        const applied = await executeScale(id, scaleRel)
        if (!applied.ok) return applied

        const change = scheduleConfirmation(() => executeScale(id, previousRel))
        return { ok: true, change }
      } catch (err) {
        logger.warn('display', `falha inesperada ao alterar a escala: ${String(err)}`)
        return { ok: false, error: GENERIC_SCALE_ERROR }
      }
    }
  )

  ipcMain.handle('display:confirm-change', async (): Promise<DisplayConfirmResult> => {
    const confirmed = pendingConfirmation !== null
    clearPendingConfirmation()
    // Se o timeout já disparou, o revert está em andamento: espera terminar
    // antes de responder, para a UI reler o estado real e não anunciar sucesso.
    if (!confirmed && revertInFlight) {
      await revertInFlight
    }
    return { ok: true, confirmed }
  })

  ipcMain.handle('display:revert-change', async (): Promise<{ ok: boolean; error?: string }> => {
    const revert = takePendingRevert()
    if (!revert) {
      // Sem pendente, mas com revert automático em andamento: devolve o
      // resultado real em vez de fingir que já reverteu.
      if (revertInFlight) return await revertInFlight
      return { ok: true }
    }

    try {
      return await revert()
    } catch (err) {
      logger.warn('display', `revert manual falhou: ${String(err)}`)
      return {
        ok: false,
        error: 'Não foi possível reverter a alteração. Verifique as configurações de tela.'
      }
    }
  })

  // Sair do Hub confirma (commit): nunca reverter durante o encerramento.
  app.once('will-quit', clearPendingConfirmation)
}
