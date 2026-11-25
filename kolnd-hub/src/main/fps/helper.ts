import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, statSync, writeFileSync } from 'fs'
import { promises as fs } from 'fs'
import { isAbsolute, join } from 'path'
import { runPowerShell, runPowerShellCommand } from '../hwmon/powershell'
import { isUacCancelled } from '../hwmon/uac'
import { logger } from '../logger'
import { FPS_DIR_NAME, resolveFpsStagingPaths, type FpsStagingPaths } from './paths'

/**
 * Helper C# da medição de FPS/frametime por ETW (sem injeção).
 *
 * ── T1: de onde vêm as constantes (fonte primária, PresentMon/Intel, MIT) ──
 *
 * https://github.com/GameTechDev/PresentMon (PresentData/ETW/*.h)
 * - `Microsoft-Windows-DXGI`: GUID {CA11C036-0102-4A2D-A6AD-F03CFED5D3C9}
 *   (`Microsoft_Windows_DXGI.h`). `Present_Start` = 0x002a e `Present_Stop` =
 *   0x002b, keyword `0x8000000000000002` ("Analytic | Events").
 * - `Microsoft-Windows-DxgKrnl`: GUID {802EC45A-1E99-4B83-9920-87C98277BA9D}
 *   (`Microsoft_Windows_DxgKrnl.h`). `Keyword::Present` = 0x8000000.
 *   `PresentHistory_Start` = 0x00ab (versão 2) é o evento de apresentação
 *   usado pelo PresentMon (`HandleDXGKEvent`).
 *
 * Como o PresentMon conta intervalos (equivalente, não código copiado):
 * `HandleDXGIEvent` cria um `PresentEvent` em `Present_Start` usando
 * `EventHeader.ProcessId`; os eventos de DxgKrnl completam o mesmo frame. Para
 * uma taxa por processo, cada `Present_Start` é uma apresentação e o intervalo
 * entre timestamps consecutivos (QPC em unidades de 100 ns no header ETW) é o
 * frametime. Aqui agregamos só pelo `ProcessId` do header — não precisamos do
 * handshake de flip/DWM do PresentMon para FPS.
 *
 * Elevação (verificado nesta máquina): criar a sessão em tempo real
 * (`StartTrace` com `EVENT_TRACE_REAL_TIME_MODE`) retorna "Acesso negado" em
 * integridade média; é o mesmo requisito do `logman create trace -ets`. Por
 * isso o helper só roda por clique e via `Start-Process -Verb RunAs` (UAC),
 * igual ao instalador do PawnIO.
 *
 * Limites conhecidos e assumidos na UI: só provedores DXGI/DxgKrnl são
 * habilitados (D3D11/12 e a maioria dos jogos Vulkan via WSI); D3D9 puro não
 * aparece. Nada é injetado no processo do jogo e nenhuma DLL é carregada nele.
 *
 * Encerramento sem órfão: o main não pode matar um processo elevado. O helper
 * se autoencerra pelo arquivo de stop, pelo heartbeat (main morto, 20 s) ou
 * pelo limite de 4 h — sempre parando a sessão com `ControlTrace` antes de
 * sair. Na próxima subida, uma sessão órfã com o mesmo nome é parada antes do
 * `StartTrace`.
 */

const CSHARP_SOURCE = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class KolndFpsEtw
{
    // Fonte primaria (Intel PresentMon, MIT):
    // https://github.com/GameTechDev/PresentMon/blob/main/PresentData/ETW/Microsoft_Windows_DXGI.h
    // https://github.com/GameTechDev/PresentMon/blob/main/PresentData/ETW/Microsoft_Windows_DxgKrnl.h
    // DXGI Present_Start = 0x002a / Present_Stop = 0x002b, keyword 0x8000000000000002.
    // DxgKrnl Keyword::Present = 0x8000000 e PresentHistory_Start = 0x00ab (v2).
    private static readonly Guid DxgiProvider = new Guid("CA11C036-0102-4A2D-A6AD-F03CFED5D3C9");
    private static readonly Guid DxgkrnlProvider = new Guid("802EC45A-1E99-4B83-9920-87C98277BA9D");
    private const ulong DxgiKeywordPresent = 0x8000000000000002UL;
    private const ulong DxgkrnlKeywordPresent = 0x0000000008000000UL;
    private const ushort DxgiPresentStartId = 0x002a;
    private const ushort DxgkrnlPresentHistoryStartId = 0x00ab;

    private const uint EVENT_TRACE_REAL_TIME_MODE = 0x00000100;
    private const uint PROCESS_TRACE_MODE_REAL_TIME = 0x00000100;
    private const uint PROCESS_TRACE_MODE_EVENT_RECORD = 0x10000000;
    private const uint EVENT_CONTROL_CODE_ENABLE_PROVIDER = 1;
    private const uint EVENT_TRACE_CONTROL_STOP = 1;
    private const uint ERROR_SUCCESS = 0;
    private const uint ERROR_ALREADY_EXISTS = 183;
    private const uint ERROR_WMI_INSTANCE_NOT_FOUND = 4201;
    private const ulong INVALID_TRACE_HANDLE = 0xFFFFFFFFFFFFFFFFUL;
    private const uint WNODE_FLAG_TRACED_GUID = 0x00020000;

    // Offsets do EVENT_HEADER no inicio do EVENT_RECORD (x64, winnt.h):
    // ProcessId 12, TimeStamp 16, ProviderId 24, EVENT_DESCRIPTOR.Id 40.
    private const int ProcessIdOffset = 12;
    private const int TimeStampOffset = 16;
    private const int ProviderIdOffset = 24;
    private const int EventIdOffset = 40;

    private static readonly object Sync = new object();
    private static readonly object WriterSync = new object();
    private static readonly Dictionary<int, Counter> Counters = new Dictionary<int, Counter>();
    private static StreamWriter _writer;
    private static EventRecordCallback _callback;
    private static volatile bool _stop;
    private static string _stopPath;
    private static string _heartbeatPath;
    private static string _sinkDir;
    private static int _heartbeatTimeoutSeconds = 20;
    private static string _sessionName = "KolndHubFps";

    private sealed class Counter
    {
        public long DxgiCount;
        public long DxgkCount;
        public long LastDxgiTs;
        public long LastDxgkTs;
        public double DxgiDeltaSumMs;
        public double DxgkDeltaSumMs;
        public long DxgiDeltaCount;
        public long DxgkDeltaCount;
    }

    private sealed class FlushEntry
    {
        public int Pid;
        public long Count;
        public long DeltaCount;
        public double DeltaSumMs;
        public bool UseDxgi;
        public string Name;
    }

    private delegate void EventRecordCallback(IntPtr eventRecord);

    [StructLayout(LayoutKind.Sequential)]
    private struct WNODE_HEADER
    {
        public uint BufferSize;
        public uint ProviderId;
        public ulong HistoricalContext;
        public ulong TimeStamp;
        public Guid Guid;
        public uint ClientContext;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct EVENT_TRACE_PROPERTIES
    {
        public WNODE_HEADER Wnode;
        public uint BufferSize;
        public uint MinimumBuffers;
        public uint MaximumBuffers;
        public uint MaximumFileSize;
        public uint LogFileMode;
        public uint FlushTimer;
        public uint EnableFlags;
        public int AgeLimit;
        public uint NumberOfBuffers;
        public uint FreeBuffers;
        public uint EventsLost;
        public uint BuffersWritten;
        public uint LogBuffersLost;
        public uint RealTimeBuffersLost;
        public IntPtr LoggerThreadId;
        public uint LogFileNameOffset;
        public uint LoggerNameOffset;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEMTIME
    {
        public ushort Year;
        public ushort Month;
        public ushort DayOfWeek;
        public ushort Day;
        public ushort Hour;
        public ushort Minute;
        public ushort Second;
        public ushort Milliseconds;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct TIME_ZONE_INFORMATION
    {
        public int Bias;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string StandardName;
        public SYSTEMTIME StandardDate;
        public int StandardBias;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DaylightName;
        public SYSTEMTIME DaylightDate;
        public int DaylightBias;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct EVENT_TRACE_HEADER
    {
        public ushort Size;
        public ushort FieldTypeFlags;
        public uint Version;
        public uint ThreadId;
        public uint ProcessId;
        public long TimeStamp;
        public Guid Guid;
        public uint KernelTime;
        public uint UserTime;
        public uint ClientContext;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct EVENT_TRACE
    {
        public EVENT_TRACE_HEADER Header;
        public uint InstanceId;
        public uint ParentInstanceId;
        public Guid ParentGuid;
        public IntPtr MofData;
        public uint MofLength;
        public uint ClientContext;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TRACE_LOGFILE_HEADER
    {
        public uint BufferSize;
        public uint Version;
        public uint ProviderVersion;
        public uint NumberOfProcessors;
        public long EndTime;
        public long TimerResolution;
        public uint MaximumFileSize;
        public uint LogFileMode;
        public uint BuffersWritten;
        public Guid LogInstanceGuid;
        public IntPtr LoggerName;
        public IntPtr LogFileName;
        public TIME_ZONE_INFORMATION TimeZone;
        public long BootTime;
        public long PerfFreq;
        public long StartTime;
        public uint ReservedFlags;
        public uint BuffersLost;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct EVENT_TRACE_LOGFILE
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string LogFileName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string LoggerName;
        public long CurrentTime;
        public uint BuffersRead;
        public uint ProcessTraceMode;
        public EVENT_TRACE CurrentEvent;
        public TRACE_LOGFILE_HEADER LogfileHeader;
        public IntPtr BufferCallback;
        public uint BufferSize;
        public uint Filled;
        public uint EventsLost;
        [MarshalAs(UnmanagedType.FunctionPtr)]
        public EventRecordCallback EventRecordCallback;
        public uint IsKernelTrace;
        public IntPtr Context;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint StartTraceW(out ulong sessionHandle, string sessionName, IntPtr properties);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint ControlTraceW(ulong traceHandle, string instanceName, IntPtr properties, uint controlCode);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint EnableTraceEx2(
        ulong traceHandle,
        ref Guid providerId,
        uint controlCode,
        byte level,
        ulong matchAnyKeyword,
        ulong matchAllKeyword,
        uint timeout,
        IntPtr enableParameters);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ulong OpenTraceW(ref EVENT_TRACE_LOGFILE logfile);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint ProcessTrace([In] ulong[] handleArray, uint handleCount, IntPtr startTime, IntPtr endTime);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint CloseTrace(ulong traceHandle);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static int Main(string[] args)
    {
        string outPath = null;
        _stopPath = null;
        _heartbeatPath = null;
        _sinkDir = null;
        var minutes = 240;
        var selfTest = false;
        var selfTestEvents = false;
        var selfTestStop = false;
        var session = "KolndHubFps";

        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg == "--self-test")
            {
                selfTest = true;
                continue;
            }
            if (arg == "--self-test-events")
            {
                selfTestEvents = true;
                continue;
            }
            if (arg == "--self-test-stop")
            {
                selfTestStop = true;
                continue;
            }
            if (arg == "--out" && i + 1 < args.Length) { outPath = args[++i]; continue; }
            if (arg == "--sink" && i + 1 < args.Length) { _sinkDir = args[++i]; continue; }
            if (arg == "--stop" && i + 1 < args.Length) { _stopPath = args[++i]; continue; }
            if (arg == "--heartbeat" && i + 1 < args.Length) { _heartbeatPath = args[++i]; continue; }
            if (arg == "--heartbeat-timeout" && i + 1 < args.Length)
            {
                if (!int.TryParse(args[++i], NumberStyles.Integer, CultureInfo.InvariantCulture, out _heartbeatTimeoutSeconds) ||
                    _heartbeatTimeoutSeconds < 5 || _heartbeatTimeoutSeconds > 300)
                {
                    Console.Error.WriteLine("invalid --heartbeat-timeout");
                    return 2;
                }
                continue;
            }
            if (arg == "--minutes" && i + 1 < args.Length)
            {
                if (!int.TryParse(args[++i], NumberStyles.Integer, CultureInfo.InvariantCulture, out minutes) ||
                    minutes < 0 || minutes > 100000)
                {
                    Console.Error.WriteLine("invalid --minutes");
                    return 2;
                }
                continue;
            }
            if (arg == "--session" && i + 1 < args.Length) { session = args[++i]; continue; }
            Console.Error.WriteLine("unknown argument: " + arg);
            return 2;
        }

        if (selfTest)
        {
            // Smoke sem elevacao: confere o layout dos structs usados no P/Invoke.
            Console.WriteLine("EVENT_TRACE_PROPERTIES=" + Marshal.SizeOf(typeof(EVENT_TRACE_PROPERTIES)));
            Console.WriteLine("EVENT_TRACE_LOGFILE=" + Marshal.SizeOf(typeof(EVENT_TRACE_LOGFILE)));
            Console.WriteLine("EVENT_TRACE_HEADER=" + Marshal.SizeOf(typeof(EVENT_TRACE_HEADER)));
            Console.WriteLine("TRACE_LOGFILE_HEADER=" + Marshal.SizeOf(typeof(TRACE_LOGFILE_HEADER)));
            Console.WriteLine("TIME_ZONE_INFORMATION=" + Marshal.SizeOf(typeof(TIME_ZONE_INFORMATION)));
            Console.WriteLine("WNODE_HEADER=" + Marshal.SizeOf(typeof(WNODE_HEADER)));
            Console.WriteLine("offset.LoggerName=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_LOGFILE), "LoggerName"));
            Console.WriteLine("offset.ProcessTraceMode=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_LOGFILE), "ProcessTraceMode"));
            Console.WriteLine("offset.CurrentEvent=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_LOGFILE), "CurrentEvent"));
            Console.WriteLine("offset.LogfileHeader=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_LOGFILE), "LogfileHeader"));
            Console.WriteLine("offset.EventRecordCallback=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_LOGFILE), "EventRecordCallback"));
            Console.WriteLine("offset.Context=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_LOGFILE), "Context"));
            Console.WriteLine("offset.TraceLoggerName=" + (long)Marshal.OffsetOf(typeof(TRACE_LOGFILE_HEADER), "LoggerName"));
            Console.WriteLine("offset.TraceTimeZone=" + (long)Marshal.OffsetOf(typeof(TRACE_LOGFILE_HEADER), "TimeZone"));
            Console.WriteLine("offset.PropsLoggerNameOffset=" + (long)Marshal.OffsetOf(typeof(EVENT_TRACE_PROPERTIES), "LoggerNameOffset"));
            return 0;
        }

        if (selfTestEvents)
        {
            // Sem elevacao nao da para abrir a sessao ETW; este modo valida o
            // parser do header, o matching por provider/evento, a agregacao por
            // PID e o calculo de fps/frametime com registros sinteticos.
            _writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            _writer.AutoFlush = true;
            try
            {
                SelfTestEvents();
            }
            finally
            {
                _writer.Dispose();
                _writer = null;
            }
            return 0;
        }

        if (selfTestStop)
        {
            // Sem elevacao nao da para abrir a sessao ETW. Este modo roda o
            // MESMO WaitLoop do modo --sink e prova que o arquivo --stop
            // encerra o coletor no ritmo do loop (200 ms), sem depender do
            // Stop-Process de fallback do script do agente.
            if (string.IsNullOrEmpty(_stopPath))
            {
                Console.Error.WriteLine("missing required --stop for --self-test-stop");
                return 2;
            }
            if (!string.IsNullOrEmpty(_sinkDir))
            {
                try
                {
                    Directory.CreateDirectory(Path.GetFullPath(_sinkDir));
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("cannot create sink: " + ex.Message);
                    return 3;
                }
            }
            _writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            _writer.AutoFlush = true;
            try
            {
                WriteLine("{\"type\":\"ready\",\"pid\":" + Process.GetCurrentProcess().Id +
                          ",\"selfTestStop\":true}");
                var testReason = WaitLoop(minutes, () => 0u);
                WriteLine("{\"type\":\"stopped\",\"reason\":" + JsonString(testReason) + "}");
                return 0;
            }
            finally
            {
                _writer.Dispose();
                _writer = null;
            }
        }

        if (string.IsNullOrEmpty(_sinkDir))
        {
            // Modo interativo (UAC por uso): NDJSON + stop-file + heartbeat.
            if (string.IsNullOrEmpty(outPath) || string.IsNullOrEmpty(_stopPath) || string.IsNullOrEmpty(_heartbeatPath))
            {
                Console.Error.WriteLine("missing required --out/--stop/--heartbeat");
                return 2;
            }
        }
        if (!IsSafeSessionName(session))
        {
            Console.Error.WriteLine("invalid session name");
            return 2;
        }
        _sessionName = session;

        if (!string.IsNullOrEmpty(_sinkDir))
        {
            // Modo agent (tarefa no logon): sem NDJSON/heartbeat — o Hub lê
            // latest.json e detecta parada pelo timestamp (> 3 s = stale).
            try
            {
                Directory.CreateDirectory(Path.GetFullPath(_sinkDir));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("cannot create sink: " + ex.Message);
                return 3;
            }
        }
        else
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath)));
                _writer = new StreamWriter(outPath, false, new UTF8Encoding(false));
                _writer.AutoFlush = true;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("cannot open output: " + ex.Message);
                return 3;
            }
        }

        try
        {
            return Run(minutes);
        }
        catch (Exception ex)
        {
            WriteLine("{\"type\":\"error\",\"message\":" + JsonString(ex.Message) + "}");
            return 1;
        }
        finally
        {
            try { if (_writer != null) _writer.Dispose(); } catch { }
        }
    }

    private static int Run(int minutes)
    {
        StopStaleSession();

        var props = AllocProperties(_sessionName);
        ulong sessionHandle;
        var status = StartTraceW(out sessionHandle, _sessionName, props);
        if (status == ERROR_ALREADY_EXISTS)
        {
            // Sessao irma ainda fechando (helper anterior morreu sem parar): o ETW
            // libera o nome em instantes, entao uma unica nova tentativa basta.
            Thread.Sleep(500);
            status = StartTraceW(out sessionHandle, _sessionName, props);
        }
        FreeProperties(props);

        if (status != ERROR_SUCCESS)
        {
            WriteLine("{\"type\":\"error\",\"stage\":\"start-trace\",\"code\":" + status +
                      ",\"message\":" + JsonString(DescribeWin32(status)) + "}");
            return 5;
        }

        var dxgiEnabled = EnableProvider(sessionHandle, DxgiProvider, DxgiKeywordPresent);
        // DxgKrnl e apenas fallback: se o provider recusar, o DXGI continua valendo.
        var dxgkEnabled = EnableProvider(sessionHandle, DxgkrnlProvider, DxgkrnlKeywordPresent);

        if (!dxgiEnabled)
        {
            var enableCode = Marshal.GetLastWin32Error();
            StopSession(sessionHandle);
            WriteLine("{\"type\":\"error\",\"stage\":\"enable-dxgi\",\"code\":" + enableCode +
                      ",\"message\":" + JsonString("nao foi possivel habilitar o provider DXGI") + "}");
            return 6;
        }

        _callback = OnEventRecord;
        var logfile = new EVENT_TRACE_LOGFILE();
        logfile.LoggerName = _sessionName;
        logfile.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
        logfile.EventRecordCallback = _callback;

        var traceHandle = OpenTraceW(ref logfile);
        if (traceHandle == INVALID_TRACE_HANDLE)
        {
            var openCode = Marshal.GetLastWin32Error();
            StopSession(sessionHandle);
            WriteLine("{\"type\":\"error\",\"stage\":\"open-trace\",\"code\":" + openCode +
                      ",\"message\":" + JsonString("nao foi possivel abrir a sessao em tempo real") + "}");
            return 7;
        }

        var traceError = 0u;
        var traceThread = new Thread(() =>
        {
            traceError = ProcessTrace(new[] { traceHandle }, 1, IntPtr.Zero, IntPtr.Zero);
        });
        traceThread.IsBackground = true;
        traceThread.Start();

        WriteLine("{\"type\":\"ready\",\"pid\":" + Process.GetCurrentProcess().Id +
                  ",\"session\":" + JsonString(_sessionName) +
                  ",\"dxgi\":true,\"dxgk\":" + (dxgkEnabled ? "true" : "false") + "}");

        var reason = WaitLoop(minutes, () => traceError);

        // Ordem importa: parar a sessao faz ProcessTrace retornar; so entao o
        // handle de consumo pode ser fechado. Sessao orfa deixaria o ETW aberto.
        StopSession(sessionHandle);

        if (!traceThread.Join(4000))
        {
            CloseTrace(traceHandle);
            traceThread.Join(1000);
        }
        else
        {
            CloseTrace(traceHandle);
        }

        if (traceError != 0)
        {
            WriteLine("{\"type\":\"error\",\"stage\":\"process-trace\",\"code\":" + traceError +
                      ",\"message\":" + JsonString(DescribeWin32(traceError)) + "}");
            return 8;
        }

        WriteLine("{\"type\":\"stopped\",\"reason\":" + JsonString(reason) + "}");
        return 0;
    }

    /**
     * Loop comum ao modo --out/manual e ao modo --sink/agente. O stop-file e
     * checado a cada 200 ms em AMBOS os modos; o --self-test-stop chama este
     * mesmo metodo para provar o comportamento sem ETW/elevacao.
     */
    private static string WaitLoop(int minutes, Func<uint> traceError)
    {
        var started = Stopwatch.StartNew();
        var lastFlush = Stopwatch.StartNew();
        var reason = "timeout";

        while (!_stop)
        {
            Thread.Sleep(200);

            if (_stopPath != null && File.Exists(_stopPath))
            {
                reason = "stop-file";
                break;
            }
            if (_heartbeatPath != null && HeartbeatExpired())
            {
                reason = "heartbeat";
                break;
            }
            if (minutes > 0 && started.Elapsed.TotalMinutes >= minutes)
            {
                reason = "max-duration";
                break;
            }
            if (traceError() != 0)
            {
                reason = "trace-error";
                break;
            }
            if (lastFlush.ElapsedMilliseconds >= 1000)
            {
                FlushSample(lastFlush.Elapsed.TotalMilliseconds);
                lastFlush.Restart();
            }
        }

        _stop = true;
        return reason;
    }

    private static void SelfTestEvents()
    {
        var record = Marshal.AllocHGlobal(128);
        try
        {
            for (var i = 0; i < 128; i++) Marshal.WriteByte(record, i, 0);

            var baseTs = 10000000L;
            // 60 presents DXGI em 1 s, um a cada ~16,667 ms.
            for (var i = 0; i < 60; i++)
            {
                WriteSynthetic(record, DxgiProvider, DxgiPresentStartId, 4242, baseTs + i * 166667L);
                OnEventRecord(record);
            }
            // 30 presents DxgKrnl (fallback) em 1 s, um a cada ~33,333 ms.
            for (var i = 0; i < 30; i++)
            {
                WriteSynthetic(record, DxgkrnlProvider, DxgkrnlPresentHistoryStartId, 4243, baseTs + i * 333333L);
                OnEventRecord(record);
            }

            FlushSample(1000.0);
        }
        finally
        {
            Marshal.FreeHGlobal(record);
        }
    }

    private static void WriteSynthetic(IntPtr record, Guid provider, ushort eventId, int pid, long ts)
    {
        Marshal.WriteInt32(record, ProcessIdOffset, pid);
        Marshal.WriteInt64(record, TimeStampOffset, ts);
        Marshal.StructureToPtr(provider, new IntPtr(record.ToInt64() + ProviderIdOffset), false);
        Marshal.WriteInt16(record, EventIdOffset, (short)eventId);
    }

    private static bool HeartbeatExpired()
    {
        try
        {
            if (!File.Exists(_heartbeatPath)) return false;
            var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(_heartbeatPath);
            return age.TotalSeconds > _heartbeatTimeoutSeconds;
        }
        catch
        {
            return false;
        }
    }

    private static bool EnableProvider(ulong sessionHandle, Guid provider, ulong keyword)
    {
        var status = EnableTraceEx2(
            sessionHandle,
            ref provider,
            EVENT_CONTROL_CODE_ENABLE_PROVIDER,
            0,
            keyword,
            0,
            0,
            IntPtr.Zero);
        return status == ERROR_SUCCESS;
    }

    private static void StopSession(ulong sessionHandle)
    {
        if (sessionHandle == 0) return;
        var props = AllocProperties(_sessionName);
        ControlTraceW(sessionHandle, _sessionName, props, EVENT_TRACE_CONTROL_STOP);
        FreeProperties(props);
    }

    private static void StopStaleSession()
    {
        // Um helper morto sem parar a sessao impediria StartTrace (183). Parar
        // pelo nome e barato e idempotente quando nao existe nada.
        var props = AllocProperties(_sessionName);
        ControlTraceW(0, _sessionName, props, EVENT_TRACE_CONTROL_STOP);
        FreeProperties(props);
    }

    private static IntPtr AllocProperties(string sessionName)
    {
        var size = Marshal.SizeOf(typeof(EVENT_TRACE_PROPERTIES));
        var total = size + (sessionName.Length + 1) * 2;
        var buffer = Marshal.AllocHGlobal(total);
        for (var i = 0; i < total; i++) Marshal.WriteByte(buffer, i, 0);

        var props = new EVENT_TRACE_PROPERTIES();
        props.Wnode.BufferSize = (uint)total;
        props.Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        props.Wnode.ClientContext = 1;
        props.Wnode.Guid = Guid.NewGuid();
        props.BufferSize = 64;
        props.MinimumBuffers = 4;
        props.MaximumBuffers = 16;
        props.LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
        props.FlushTimer = 1;
        props.LoggerNameOffset = (uint)size;

        Marshal.StructureToPtr(props, buffer, false);
        return buffer;
    }

    private static void FreeProperties(IntPtr buffer)
    {
        if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
    }

    private static void OnEventRecord(IntPtr record)
    {
        if (record == IntPtr.Zero) return;
        var eventId = (ushort)Marshal.ReadInt16(record, EventIdOffset);
        var provider = Marshal.PtrToStructure<Guid>(new IntPtr(record.ToInt64() + ProviderIdOffset));

        var isDxgi = eventId == DxgiPresentStartId && provider == DxgiProvider;
        var isDxgk = eventId == DxgkrnlPresentHistoryStartId && provider == DxgkrnlProvider;
        if (!isDxgi && !isDxgk) return;

        var pid = Marshal.ReadInt32(record, ProcessIdOffset);
        if (pid <= 0) return;
        var ts = Marshal.ReadInt64(record, TimeStampOffset);

        lock (Sync)
        {
            Counter counter;
            if (!Counters.TryGetValue(pid, out counter))
            {
                counter = new Counter();
                Counters[pid] = counter;
            }
            AddPresent(counter, ts, isDxgi);
        }
    }

    private static void AddPresent(Counter counter, long ts, bool dxgi)
    {
        if (dxgi)
        {
            if (counter.LastDxgiTs != 0 && ts > counter.LastDxgiTs)
            {
                var deltaMs = (ts - counter.LastDxgiTs) / 10000.0;
                // Intervalo > 2 s e pausa (janela minimizada), nao frametime.
                if (deltaMs < 2000)
                {
                    counter.DxgiDeltaSumMs += deltaMs;
                    counter.DxgiDeltaCount++;
                }
            }
            counter.LastDxgiTs = ts;
            counter.DxgiCount++;
        }
        else
        {
            if (counter.LastDxgkTs != 0 && ts > counter.LastDxgkTs)
            {
                var deltaMs = (ts - counter.LastDxgkTs) / 10000.0;
                if (deltaMs < 2000)
                {
                    counter.DxgkDeltaSumMs += deltaMs;
                    counter.DxgkDeltaCount++;
                }
            }
            counter.LastDxgkTs = ts;
            counter.DxgkCount++;
        }
    }

    private static void FlushSample(double windowMs)
    {
        if (windowMs < 200) return;
        var windowSec = windowMs / 1000.0;
        var foregroundPid = 0u;
        string foregroundName = null;

        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd != IntPtr.Zero)
            {
                GetWindowThreadProcessId(hwnd, out foregroundPid);
                if (foregroundPid != 0) foregroundName = SafeProcessName((int)foregroundPid);
            }
        }
        catch
        {
            foregroundPid = 0;
        }

        var entries = new List<string>();
        var snapshot = new List<FlushEntry>();
        lock (Sync)
        {
            foreach (var pair in Counters)
            {
                if (pair.Value.DxgiCount == 0 && pair.Value.DxgkCount == 0) continue;
                var useDxgi = pair.Value.DxgiCount > 0;
                snapshot.Add(new FlushEntry
                {
                    Pid = pair.Key,
                    UseDxgi = useDxgi,
                    Count = useDxgi ? pair.Value.DxgiCount : pair.Value.DxgkCount,
                    DeltaCount = useDxgi ? pair.Value.DxgiDeltaCount : pair.Value.DxgkDeltaCount,
                    DeltaSumMs = useDxgi ? pair.Value.DxgiDeltaSumMs : pair.Value.DxgkDeltaSumMs
                });
                pair.Value.DxgiCount = 0;
                pair.Value.DxgkCount = 0;
                pair.Value.DxgiDeltaSumMs = 0;
                pair.Value.DxgkDeltaSumMs = 0;
                pair.Value.DxgiDeltaCount = 0;
                pair.Value.DxgkDeltaCount = 0;
            }
        }

        // Resolver nome de processo fora do lock: o callback do ETW nao pode
        // esperar por uma consulta ao SO a cada PID da janela.
        foreach (var item in snapshot)
        {
            item.Name = SafeProcessName(item.Pid);
            entries.Add(BuildPidJson(item, windowSec));
        }

        if (!string.IsNullOrEmpty(_sinkDir)) WriteLatestSample(snapshot, foregroundPid, foregroundName, windowSec);

        // Uma linha por segundo; 64 PIDs e o teto para nao inflar o NDJSON com
        // processos de sistema que apresentam em segundo plano.
        entries.Sort();
        if (entries.Count > 64) entries.RemoveRange(64, entries.Count - 64);

        var sb = new StringBuilder();
        sb.Append("{\"type\":\"sample\",\"ts\":\"");
        sb.Append(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
        sb.Append("\",\"windowMs\":");
        sb.Append(windowMs.ToString("F1", CultureInfo.InvariantCulture));
        sb.Append(",\"foregroundPid\":");
        sb.Append(foregroundPid == 0 ? "null" : foregroundPid.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"foregroundName\":");
        sb.Append(foregroundName == null ? "null" : JsonString(foregroundName));
        sb.Append(",\"pids\":[");
        sb.Append(string.Join(",", entries.ToArray()));
        sb.Append("]}");
        WriteLine(sb.ToString());
    }

    private static string BuildPidJson(FlushEntry entry, double windowSec)
    {
        var fps = entry.Count / windowSec;
        var frametime = 0.0;
        if (entry.DeltaCount > 0) frametime = entry.DeltaSumMs / entry.DeltaCount;
        else if (fps > 0) frametime = 1000.0 / fps;

        return "{\"pid\":" + entry.Pid +
               ",\"name\":" + (entry.Name == null ? "null" : JsonString(entry.Name)) +
               ",\"presents\":" + entry.Count +
               ",\"source\":\"" + (entry.UseDxgi ? "dxgi" : "dxgk") + "\"" +
               ",\"fps\":" + fps.ToString("F2", CultureInfo.InvariantCulture) +
               ",\"frametimeMs\":" + frametime.ToString("F2", CultureInfo.InvariantCulture) + "}";
    }

    // Mesma lista de processos "casca" do Hub (target.ts): nunca publicar o
    // Explorer/DWM/Hub como FPS do jogo.
    private static bool IsIgnoredTarget(string name)
    {
        if (string.IsNullOrEmpty(name)) return true;
        var lower = name.Trim().ToLowerInvariant();
        if (lower.EndsWith(".exe")) lower = lower.Substring(0, lower.Length - 4);
        switch (lower)
        {
            case "explorer":
            case "dwm":
            case "electron":
            case "kolnd hub":
            case "searchhost":
            case "startmenuexperiencehost":
            case "shellexperiencehost":
            case "textinputhost":
            case "lockapp":
                return true;
            default:
                return false;
        }
    }

    /**
     * Modo agent: grava a amostra do alvo em primeiro plano em latest.json de
     * forma atômica (tmp + Replace/Move). O Hub lê o arquivo sem privilégio;
     * timestamp sempre presente para a detecção de stale (> 3 s).
     */
    private static void WriteLatestSample(List<FlushEntry> snapshot, uint foregroundPid, string foregroundName, double windowSec)
    {
        FlushEntry target = null;
        if (foregroundPid != 0 && !IsIgnoredTarget(foregroundName))
        {
            foreach (var item in snapshot)
            {
                if (item.Pid == (int)foregroundPid && item.Count > 0) { target = item; break; }
            }
            // Apps multi-processo (Chromium/Electron): o primeiro plano pode ser
            // o processo dono da janela, com os presents no filho GPU.
            if (target == null)
            {
                foreach (var item in snapshot)
                {
                    if (item.Count <= 0) continue;
                    if (!string.Equals(item.Name, foregroundName, StringComparison.OrdinalIgnoreCase)) continue;
                    if (target == null || item.Count > target.Count) target = item;
                }
            }
        }

        var sb = new StringBuilder();
        if (target == null)
        {
            // Sem alvo o Hub precisa saber POR QUE nao ha FPS: primeiro plano
            // que nao apresenta (Explorer/DWM/Hub) ou app sem presents na janela.
            var reason = (foregroundPid == 0 || IsIgnoredTarget(foregroundName))
                ? "no-target"
                : "no-presents";
            sb.Append("{\"pid\":null,\"name\":null,\"fps\":null,\"frametimeMs\":null,\"reason\":");
            sb.Append(JsonString(reason));
        }
        else
        {
            var fps = target.Count / windowSec;
            var frametime = 0.0;
            if (target.DeltaCount > 0) frametime = target.DeltaSumMs / target.DeltaCount;
            else if (fps > 0) frametime = 1000.0 / fps;

            sb.Append("{\"pid\":");
            sb.Append(target.Pid.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"name\":");
            sb.Append(JsonString(target.Name ?? foregroundName));
            sb.Append(",\"fps\":");
            sb.Append(fps.ToString("F2", CultureInfo.InvariantCulture));
            sb.Append(",\"frametimeMs\":");
            sb.Append(frametime.ToString("F2", CultureInfo.InvariantCulture));
        }
        sb.Append(",\"timestamp\":");
        sb.Append(JsonString(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)));
        sb.Append("}");

        try
        {
            var dest = Path.Combine(_sinkDir, "latest.json");
            var tmp = dest + ".tmp";
            File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
            if (File.Exists(dest))
            {
                try { File.Replace(tmp, dest, null); }
                catch { try { File.Delete(dest); } catch { } File.Move(tmp, dest); }
            }
            else
            {
                File.Move(tmp, dest);
            }
        }
        catch
        {
            // Sink indisponível (ACL/disco): tentamos de novo no próximo flush;
            // o timestamp antigo vira stale e a UI mostra "—".
        }
    }

    private static string SafeProcessName(int pid)
    {
        try
        {
            return Process.GetProcessById(pid).ProcessName;
        }
        catch
        {
            return null;
        }
    }

    private static void WriteLine(string line)
    {
        lock (WriterSync)
        {
            if (_writer == null) return;
            try
            {
                _writer.WriteLine(line);
            }
            catch
            {
                // Arquivo removido/fechado: encerrar sem derrubar o helper.
                _stop = true;
            }
        }
    }

    private static string DescribeWin32(uint code)
    {
        if (code == 5) return "acesso negado (a medicao de FPS exige permissao de administrador)";
        try
        {
            return new System.ComponentModel.Win32Exception((int)code).Message;
        }
        catch
        {
            return "erro " + code;
        }
    }

    private static bool IsSafeSessionName(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Length > 64) return false;
        foreach (var c in name)
        {
            if (!(char.IsLetterOrDigit(c) || c == '-' || c == '_')) return false;
        }
        return true;
    }

    private static string JsonString(string value)
    {
        if (value == null) return "null";
        var sb = new StringBuilder(value.Length + 2);
        sb.Append('"');
        foreach (var c in value)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }
}
`

const HELPER_DIR = FPS_DIR_NAME
const RUN_DIR = 'run'
const HELPER_EXE = 'KolndFpsEtw.exe'
const OUTPUT_FILE = 'fps.ndjson'
const STOP_FILE = 'fps.stop'
const HEARTBEAT_FILE = 'fps.heartbeat'
const PROTECTED_DIR = 'Kolnd Hub'
const PROTECTED_BIN_DIR = 'bin'
const SESSION_NAME = 'KolndHubFps'
const HELPER_MAX_MINUTES = 240
const HEARTBEAT_TIMEOUT_SECONDS = 20
const COMPILE_TIMEOUT_MS = 60_000
const UAC_TIMEOUT_MS = 60_000
const MAX_READ_BYTES = 256 * 1024
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

/** Staging gravável (userData): onde o main escreve o `.cs` e compila o `.exe`. */
export type { FpsStagingPaths } from './paths'
export { resolveFpsStagingPaths } from './paths'

/**
 * Arquivos de controle da execução interativa em userData. Só o main (não
 * elevado) escreve stop/heartbeat; o NDJSON não fica aqui.
 */
export interface FpsRunPaths {
  runDir: string
  stopPath: string
  heartbeatPath: string
}

/** Cópia elevada e protegida (ProgramData), a única que a tarefa/execução usa. */
export interface FpsProtectedPaths {
  root: string
  binDir: string
  /** `<root>\run` — NDJSON do helper elevado. Opcional só para fixtures antigas. */
  runDir?: string
  exePath: string
}

export interface FpsHelperPaths extends FpsStagingPaths, FpsRunPaths {
  /** NDJSON escrito pelo helper ELEVADO — sempre sob `FpsProtectedPaths.runDir`. */
  outputPath: string
}

/** Caminhos puros (recebem a base para não depender de Electron nos testes). */
export function resolveFpsRunPaths(userDataDir: string): FpsRunPaths {
  const runDir = join(userDataDir, HELPER_DIR, RUN_DIR)
  return {
    runDir,
    stopPath: join(runDir, STOP_FILE),
    heartbeatPath: join(runDir, HEARTBEAT_FILE)
  }
}

/**
 * Caminhos do artefato elevado. Vive em `%ProgramData%` porque nenhum processo
 * do usuário pode substituir o `.exe` que a tarefa `HIGHEST` executa no logon
 * (era uma escalação de privilégio quando morava em `%APPDATA%`) nem apontar
 * `run\fps.ndjson` para um link criado pelo usuário.
 */
export function resolveFpsProtectedPaths(programDataDir: string): FpsProtectedPaths {
  const root = join(programDataDir, PROTECTED_DIR, HELPER_DIR)
  const binDir = join(root, PROTECTED_BIN_DIR)
  return {
    root,
    binDir,
    runDir: join(root, RUN_DIR),
    exePath: join(binDir, HELPER_EXE)
  }
}

/**
 * `run` sob o root protegido. Deriva do root quando o chamador não informou
 * (fixtures antigas do agent passam só root/bin/exe); o resolvedor real sempre
 * devolve `protectedPaths.runDir`.
 */
function protectedRunDir(paths: FpsProtectedPaths): string {
  return paths.runDir ?? join(paths.root, RUN_DIR)
}

/**
 * Staging/controle em userData + o NDJSON no diretório protegido: o helper
 * elevado nunca escreve em caminho gravável pelo usuário.
 */
export function resolveFpsHelperPaths(userDataDir: string, programDataDir: string): FpsHelperPaths {
  const protectedPaths = resolveFpsProtectedPaths(programDataDir)
  return {
    ...resolveFpsStagingPaths(userDataDir),
    ...resolveFpsRunPaths(userDataDir),
    outputPath: join(protectedRunDir(protectedPaths), OUTPUT_FILE)
  }
}

export function currentFpsHelperPaths(): FpsHelperPaths {
  return resolveFpsHelperPaths(
    app.getPath('userData'),
    process.env.ProgramData ?? 'C:\\ProgramData'
  )
}

export interface FpsHelperPidEntry {
  pid: number
  name: string | null
  presents: number
  source: 'dxgi' | 'dxgk'
  fps: number
  frametimeMs: number
}

export interface FpsHelperSample {
  type: 'sample'
  ts: string
  windowMs: number
  foregroundPid: number | null
  foregroundName: string | null
  pids: FpsHelperPidEntry[]
}

export type FpsHelperMessage =
  | { type: 'ready'; pid: number | null; session: string; dxgi: boolean; dxgk: boolean }
  | FpsHelperSample
  | { type: 'stopped'; reason: string }
  | { type: 'error'; stage?: string; code?: number; message: string }

export interface FpsHelperStartResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  paths?: FpsHelperPaths
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isPid(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff
  )
}

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

function safeName(value: unknown, maxLength = 260): string | null {
  if (typeof value !== 'string') return null
  if (!value || value.length > maxLength) return null
  // Nome de processo com caractere de controle não é nome de processo: descarta.
  if (hasControlChars(value)) return null
  return value
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

/**
 * Parser do NDJSON do helper — puro, exportado para testes. Qualquer linha
 * fora do contrato vira `null` (o main ignora em vez de confiar).
 */
export function parseFpsHelperLine(line: string): FpsHelperMessage | null {
  const text = line.replace(/^\uFEFF/, '').trim()
  if (!text) return null

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  if (value.type === 'ready') {
    return {
      type: 'ready',
      pid: isPid(value.pid) ? value.pid : null,
      session: safeText(value.session, 64) ?? '',
      dxgi: value.dxgi === true,
      dxgk: value.dxgk === true
    }
  }

  if (value.type === 'stopped') {
    return { type: 'stopped', reason: safeText(value.reason, 64) ?? 'unknown' }
  }

  if (value.type === 'error') {
    const message = safeText(value.message, 500)
    if (!message) return null
    return {
      type: 'error',
      stage: safeText(value.stage, 64) ?? undefined,
      code: typeof value.code === 'number' && Number.isFinite(value.code) ? value.code : undefined,
      message
    }
  }

  if (value.type !== 'sample') return null
  if (!isFiniteInRange(value.windowMs, 100, 60_000)) return null

  const foregroundPid =
    value.foregroundPid === null ? null : isPid(value.foregroundPid) ? value.foregroundPid : null
  const foregroundName = value.foregroundName === null ? null : safeName(value.foregroundName)

  const rawPids = Array.isArray(value.pids) ? value.pids : []
  if (rawPids.length > 128) return null

  const pids: FpsHelperPidEntry[] = []
  for (const raw of rawPids) {
    if (!isRecord(raw)) continue
    if (!isPid(raw.pid)) continue
    if (!Number.isSafeInteger(raw.presents) || (raw.presents as number) < 0) continue
    if (!isFiniteInRange(raw.fps, 0, 1_000_000)) continue
    if (!isFiniteInRange(raw.frametimeMs, 0, 60_000)) continue
    const source = raw.source === 'dxgi' || raw.source === 'dxgk' ? raw.source : null
    if (!source) continue
    pids.push({
      pid: raw.pid,
      name: raw.name === null ? null : safeName(raw.name),
      presents: raw.presents as number,
      source,
      fps: raw.fps,
      frametimeMs: raw.frametimeMs
    })
  }

  return {
    type: 'sample',
    ts: safeText(value.ts, 64) ?? '',
    windowMs: value.windowMs,
    foregroundPid,
    foregroundName,
    pids
  }
}

/** Separa linhas completas de um buffer, preservando a última linha parcial. */
export function takeCompleteLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return {
    lines: parts.map((line) => line.replace(/\r$/, '')),
    rest
  }
}

export interface FpsChunk {
  text: string
  offset: number
  truncated: boolean
}

/**
 * Lê apenas os bytes novos do NDJSON. Se o main ficou parado e o arquivo
 * cresceu além do teto, descarta o começo (a primeira linha parcial é cortada)
 * para não carregar um backlog inteiro na memória.
 */
export async function readFpsChunk(path: string, offset: number): Promise<FpsChunk> {
  let stat: { size: number }
  try {
    stat = await fs.stat(path)
  } catch {
    return { text: '', offset, truncated: false }
  }

  let start = stat.size < offset ? 0 : offset
  if (stat.size === start) return { text: '', offset: start, truncated: false }

  let truncated = false
  if (stat.size - start > MAX_READ_BYTES) {
    start = stat.size - MAX_READ_BYTES
    truncated = true
  }

  const length = stat.size - start
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(path, 'r')
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    if (truncated) {
      const newline = text.indexOf('\n')
      text = newline >= 0 ? text.slice(newline + 1) : ''
    }
    return { text, offset: start + bytesRead, truncated }
  } catch {
    return { text: '', offset: start, truncated }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/** `true` quando há aspas duplas, quebra de linha ou caractere de controle. */
function hasUnsafePathChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

/**
 * Caminho que pode entrar num script elevado: absoluto, curto e sem aspas
 * duplas/controle. Aspa simples é escapada por `psQuote`.
 */
function isSafeScriptPath(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    isAbsolute(value) &&
    !hasUnsafePathChars(value)
  )
}

function assertSafeScriptPath(value: string, message: string): void {
  if (!isSafeScriptPath(value)) throw new Error(message)
}

/** SHA-256 binário do arquivo (usado para amarrar a cópia elevada ao staging). */
export async function sha256File(path: string): Promise<string> {
  const data = await fs.readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Script pronto para `powershell.exe -EncodedCommand`: UTF-16LE em base64. É o
 * substituto do `.ps1` gravado em `%APPDATA%` e executado com UAC (o arquivo
 * podia ser trocado entre a gravação e o clique no UAC).
 */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export interface EnsureProtectedHelperOptions {
  stagingExePath: string
  expectedSha256: string
  protectedPaths: FpsProtectedPaths
}

/**
 * Script que roda ELEVADO. A ordem importa: cria `root`/`bin`/`run`, TRANCA a
 * ACL (`/inheritance:r`, sem Creator Owner; SYSTEM/Administradores `F`,
 * Usuários `RX`) e só então copia o helper — a cópia nasce num diretório onde
 * nenhum processo do usuário consegue escrever, fechando a janela em que o
 * binário recém-copiado ainda herdava escrita. O `run` é criado antes da ACL
 * para herdar a mesma trava: o helper elevado escreve o NDJSON ali. Por fim
 * confere o SHA-256 do DESTINO (abortando e apagando a cópia se divergir). O
 * caminho de userData aparece só como origem do `Copy-Item`.
 */
export function buildEnsureProtectedHelperScript(options: EnsureProtectedHelperOptions): string {
  const { stagingExePath, protectedPaths } = options
  const runDir = protectedRunDir(protectedPaths)
  assertSafeScriptPath(stagingExePath, 'Caminho do helper compilado inválido.')
  assertSafeScriptPath(protectedPaths.root, 'Caminho protegido do helper inválido.')
  assertSafeScriptPath(protectedPaths.binDir, 'Caminho protegido do helper inválido.')
  assertSafeScriptPath(runDir, 'Caminho protegido do helper inválido.')
  assertSafeScriptPath(protectedPaths.exePath, 'Caminho protegido do helper inválido.')

  const expected = typeof options.expectedSha256 === 'string' ? options.expectedSha256.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('Hash SHA-256 do helper inválido.')
  }

  return [
    "$ErrorActionPreference = 'Stop'",
    `New-Item -ItemType Directory -Force -Path '${psQuote(protectedPaths.root)}' | Out-Null`,
    `New-Item -ItemType Directory -Force -Path '${psQuote(protectedPaths.binDir)}' | Out-Null`,
    `New-Item -ItemType Directory -Force -Path '${psQuote(runDir)}' | Out-Null`,
    `& icacls.exe '${psQuote(protectedPaths.root)}' /inheritance:r ` +
      `/grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' ` +
      '/T /C | Out-Null',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    `Copy-Item -LiteralPath '${psQuote(stagingExePath)}' -Destination '${psQuote(
      protectedPaths.exePath
    )}' -Force`,
    `$hash = (Get-FileHash -LiteralPath '${psQuote(
      protectedPaths.exePath
    )}' -Algorithm SHA256).Hash.ToLowerInvariant()`,
    `if ($hash -ne '${expected}') {`,
    `  Remove-Item -LiteralPath '${psQuote(
      protectedPaths.exePath
    )}' -Force -ErrorAction SilentlyContinue`,
    "  throw 'O helper de FPS não confere com o hash esperado.'",
    '}'
  ].join('\r\n')
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

function needsCompile(sourcePath: string, exePath: string): boolean {
  if (!existsSync(exePath)) return true
  try {
    return statSync(sourcePath).mtimeMs > statSync(exePath).mtimeMs
  } catch {
    return true
  }
}

/** Script que roda ELEVADO: garante a cópia protegida e executa o helper. */
export interface FpsHelperStartScriptOptions {
  paths: FpsHelperPaths
  protectedPaths: FpsProtectedPaths
  expectedSha256: string
}

export function buildFpsHelperStartScript(options: FpsHelperStartScriptOptions): string {
  const { paths, protectedPaths } = options
  // O NDJSON é escrito pelo helper ELEVADO: sempre sob o diretório protegido.
  const outputPath = join(protectedRunDir(protectedPaths), OUTPUT_FILE)
  assertSafeScriptPath(outputPath, 'Caminho de saída do helper inválido.')
  assertSafeScriptPath(paths.stopPath, 'Caminho de parada do helper inválido.')
  assertSafeScriptPath(paths.heartbeatPath, 'Caminho de heartbeat do helper inválido.')

  return [
    buildEnsureProtectedHelperScript({
      stagingExePath: paths.stagingExePath,
      expectedSha256: options.expectedSha256,
      protectedPaths
    }),
    // O main não pode apagar no diretório protegido: limpar aqui evita que o
    // polling leia a amostra da execução anterior antes do UAC terminar.
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(outputPath)}'`,
    `& '${psQuote(protectedPaths.exePath)}' --out '${psQuote(outputPath)}' ` +
      `--stop '${psQuote(paths.stopPath)}' --heartbeat '${psQuote(paths.heartbeatPath)}' ` +
      `--heartbeat-timeout ${HEARTBEAT_TIMEOUT_SECONDS} --minutes ${HELPER_MAX_MINUTES} --session '${SESSION_NAME}'`,
    'exit $LASTEXITCODE'
  ].join('\r\n')
}

/**
 * Comando externo que pede o UAC e roda o script elevado por
 * `-EncodedCommand`. Sem `-Wait`: o helper segue vivo depois que o PowerShell
 * externo retorna; o acompanhamento é feito pelo NDJSON/heartbeat.
 */
export function buildFpsHelperElevationCommand(script: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodePowerShell(
        script
      )}') -Verb RunAs | Out-Null`,
    'exit 0'
  ].join('; ')
}

let assetsPromise: Promise<FpsHelperPaths> | null = null

async function ensureAssets(): Promise<FpsHelperPaths> {
  const paths = currentFpsHelperPaths()
  await fs.mkdir(paths.dir, { recursive: true })
  await fs.mkdir(paths.runDir, { recursive: true })

  await writeIfChanged(paths.sourcePath, CSHARP_SOURCE)

  if (needsCompile(paths.sourcePath, paths.stagingExePath)) {
    const command = [
      `Add-Type -Path '${psQuote(paths.sourcePath)}'`,
      `-OutputAssembly '${psQuote(paths.stagingExePath)}'`,
      '-OutputType ConsoleApplication'
    ].join(' ')
    const result = await runPowerShell([...PS_ARGS, command], COMPILE_TIMEOUT_MS)
    if (result.timedOut) {
      throw new Error('A compilação do helper de FPS excedeu o tempo limite.')
    }
    if (!existsSync(paths.stagingExePath)) {
      const detail = result.stderr.trim() || `código ${result.code ?? 'desconhecido'}`
      throw new Error(`Não foi possível compilar o helper de FPS: ${detail}`)
    }
  }

  return paths
}

function getAssets(): Promise<FpsHelperPaths> {
  if (!assetsPromise) {
    assetsPromise = ensureAssets().catch((err) => {
      assetsPromise = null
      throw err
    })
  }
  return assetsPromise
}

/**
 * Garante o `.cs` compilado (staging em userData) e devolve os caminhos. O agent
 * de FPS automático precisa do `.exe` para copiar ao diretório protegido.
 */
export function ensureStagedHelper(): Promise<FpsHelperPaths> {
  return getAssets()
}

/** Grava o batimento que o helper usa para detectar um main morto (sem órfão). */
export async function touchFpsHeartbeat(paths?: FpsHelperPaths): Promise<void> {
  const target = paths ?? currentFpsHelperPaths()
  try {
    await fs.writeFile(target.heartbeatPath, String(Date.now()), 'utf8')
  } catch {
    // Sem heartbeat o helper se encerra sozinho; o stop explícito continua valendo.
  }
}

/**
 * Sobe o helper ELEVADO. O processo retornado pelo PowerShell não é o helper:
 * ele é filho elevado, então o acompanhamento é feito pelo NDJSON/heartbeat.
 * Nunca lança — falhas viram `{ ok: false }` com mensagem amigável.
 */
export async function startFpsHelper(): Promise<FpsHelperStartResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A medição de FPS por ETW só é suportada no Windows.' }
  }

  try {
    const paths = await getAssets()

    // O helper trunca o NDJSON ao abrir; o main não apaga no diretório protegido.
    await fs.rm(paths.stopPath, { force: true })
    await touchFpsHeartbeat(paths)

    const protectedPaths = resolveFpsProtectedPaths(process.env.ProgramData ?? 'C:\\ProgramData')
    const script = buildFpsHelperStartScript({
      paths,
      protectedPaths,
      expectedSha256: await sha256File(paths.stagingExePath)
    })

    const result = await runPowerShellCommand(
      buildFpsHelperElevationCommand(script),
      UAC_TIMEOUT_MS
    )
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelled(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.'
      }
    }
    if (result.timedOut) {
      return {
        ok: false,
        error: 'A solicitação de permissão demorou demais. Tente novamente.'
      }
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      logger.warn(
        'fps',
        `não foi possível elevar o helper de FPS (código ${result.code})${
          detail ? `: ${detail}` : ''
        }`
      )
      return {
        ok: false,
        error: 'Não foi possível iniciar a medição com permissão de administrador.'
      }
    }

    logger.info('fps', 'helper de FPS elevado iniciado')
    return { ok: true, paths }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('fps', `falha ao preparar o helper de FPS: ${message}`)
    return {
      ok: false,
      error: 'Não foi possível preparar o helper de FPS. Tente novamente.'
    }
  }
}

/** Sinaliza parada pelo arquivo (o helper elevado não aceita sinal do main). */
export async function requestFpsHelperStop(reason = 'stop'): Promise<void> {
  try {
    await fs.writeFile(currentFpsHelperPaths().stopPath, reason, 'utf8')
  } catch {
    // O heartbeat vencido também encerra o helper; nada a fazer aqui.
  }
}

/**
 * Variante síncrona usada no `will-quit`: o processo pode encerrar logo depois,
 * então a escrita do sinal precisa acontecer antes de retornar.
 */
export function requestFpsHelperStopSync(reason = 'quit'): void {
  try {
    writeFileSync(currentFpsHelperPaths().stopPath, reason, 'utf8')
  } catch {
    // idem: sem sinal, o helper cai pelo heartbeat.
  }
}
