/**
 * Scripts CIM compartilhados entre o caminho legado (um PowerShell por tick) e
 * o coletor persistente.
 *
 * O corpo fica num módulo próprio por dois motivos: (1) o coletor precisa do
 * MESMO texto para não haver divergência de dados entre helper e fallback; (2)
 * `nativeSensors.ts` reexporta `buildCimDynamicScript` para preservar a API e os
 * testes existentes.
 *
 * `getCim` permite trocar o cmdlet: o helper injeta `Get-KolndCim`, que decide
 * entre a `CimSession` aberta uma vez e a consulta local (quando a sessão não
 * pôde ser criada). O caminho legado continua usando `Get-CimInstance`.
 */

export type CimCommand = string

/**
 * Consulta CIM estática (RAM, CPU, placa e temperatura ACPI) — uma execução por
 * sessão. `[Console]::OutputEncoding` força UTF-8 no stdout mesmo em console
 * localizado; `$ErrorActionPreference` evita que uma classe ausente escreva lixo
 * no JSON.
 *
 * A temperatura entra AQUI (e não no tick) porque `MSAcpi_ThermalZoneTemperature`
 * não existe em muitos desktops — medido nesta máquina: a consulta falha. Pagar
 * a falha uma vez por sessão evita custo e log repetido a cada segundo.
 */
export function buildCimStaticScript(getCim: CimCommand = 'Get-CimInstance'): string {
  return [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    "$ErrorActionPreference='SilentlyContinue'",
    `$ram=@(${getCim} Win32_PhysicalMemory | Select-Object Capacity,ConfiguredClockSpeed,ConfiguredVoltage,SMBIOSMemoryType)`,
    `$cpu=${getCim} Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed`,
    `$board=${getCim} Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product`,
    `$acpi=@(${getCim} -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object InstanceName,CurrentTemperature)`,
    `$thermal=@(${getCim} Win32_PerfFormattedData_Counters_ThermalZoneInformation | Select-Object Name,HighPrecisionTemperature,Temperature)`,
    // GPU é estática (modelo/driver/VRAM não mudam no tick). A VRAM real vem do
    // registro: `AdapterRAM` satura em ~4 GiB e mentiria numa placa de 8 GB.
    `$video=@(${getCim} Win32_VideoController | Select-Object Name,PNPDeviceID,DriverVersion,DriverDate,AdapterRAM)`,
    `$gpuReg=@(Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}" | ForEach-Object { $p=Get-ItemProperty $_.PSPath; [pscustomobject]@{DriverDesc=$p.DriverDesc;DriverVersion=$p.DriverVersion;MatchingDeviceId=$p.MatchingDeviceId;'HardwareInformation.qwMemorySize'=$p.'HardwareInformation.qwMemorySize'} })`,
    '[pscustomobject]@{ram=@($ram);cpu=$cpu;board=$board;acpi=@($acpi);thermal=@($thermal);video=@($video);gpuRegistry=@($gpuReg)} | ConvertTo-Json -Depth 6 -Compress'
  ].join('; ')
}

/**
 * Consulta CIM dinâmica (GPU + performance do processador) por tick.
 *
 * Por que a agregação acontece aqui: o contador `\GPU Engine(*)\Utilization
 * Percentage` tem o caminho LOCALIZADO (pt-BR quebra), mas as classes CIM
 * `Win32_PerfFormattedData_GPUPerformanceCounters_*` são independentes de
 * idioma. A regra de uso é a mesma do Gerenciador de Tarefas: somar as
 * instâncias do motor 3D por adaptador (LUID) e ler o adaptador primário —
 * `Copy`, `VideoDecode`, `Security` e afins não são "uso da GPU" para o
 * usuário. O adaptador primário é o de maior memória dedicada; um adaptador
 * virtual (ex.: Parsec) tem 0 dedicado e não zera a leitura da GPU real.
 *
 * O bloco de uso é CONDICIONAL: em NVIDIA o `nvidia-smi` já entrega o uso com
 * mais precisão, e consultar o `GPUEngine` custa ~300 ms por tick (medido:
 * 486 instâncias). Com ele o tick ia de ~610 ms para ~960 ms; sem ele a máquina
 * NVIDIA continua no orçamento antigo e AMD/Intel pagam só quando precisam.
 *
 * Tudo é agregado no PowerShell e só os totais voltam: o JSON por tick precisa
 * continuar pequeno (1 processo por tick, sem custo extra de parsing).
 *
 * Medição empírica nesta máquina (RTX 5060 Ti, 18/11/2026), comparando com
 * `nvidia-smi --query-gpu=utilization.gpu`: em repouso 2% (CIM) × 2%
 * (nvidia-smi); com carga leve ~25% × 26–28%; saturada 97–100% × 99–100%.
 * A memória dedicada acompanhou `memory.used` dentro de ~15 MiB. Agregar só o
 * `3D` por LUID é o que replica o Gerenciador de Tarefas; somar todas as
 * instâncias (Copy/VideoDecode) inflaria o número sem relação com o uso.
 */
export function buildCimDynamicScript(
  includeGpuEngine: boolean,
  getCim: CimCommand = 'Get-CimInstance'
): string {
  const lines = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    "$ErrorActionPreference='SilentlyContinue'",
    `$mem=@(${getCim} Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name,DedicatedUsage,SharedUsage)`,
    `$rows=@($mem | ForEach-Object { $p=$_.Name -split '_'; [pscustomobject]@{ luid="$($p[1])_$($p[2])"; dedicated=[double]$_.DedicatedUsage; shared=[double]$_.SharedUsage } })`,
    `$primary=$rows | Sort-Object -Property @{Expression='dedicated';Descending=$true},@{Expression='shared';Descending=$true} | Select-Object -First 1`,
    '$usage=$null'
  ]

  if (includeGpuEngine) {
    lines.push(
      `$eng=@(${getCim} Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -match '_engtype_3D$' } | Select-Object Name,UtilizationPercentage)`,
      '$sums=@{}',
      `foreach ($e in $eng) { $p=$e.Name -split '_'; $key="$($p[3])_$($p[4])"; $v=[double]$e.UtilizationPercentage; if ($sums.ContainsKey($key)) { $sums[$key]=$sums[$key]+$v } else { $sums[$key]=$v } }`,
      'if ($primary -and $sums.ContainsKey($primary.luid)) { $usage=$sums[$primary.luid] } elseif ($sums.Count -gt 0) { $usage=($sums.Values | Measure-Object -Maximum).Maximum }',
      'if ($usage -ne $null) { $usage=[math]::Min(100,[math]::Max(0,$usage)) }'
    )
  }

  lines.push(
    '$dedicated=$null',
    '$shared=$null',
    'if ($primary) { $dedicated=$primary.dedicated; $shared=$primary.shared }',
    `$perf=${getCim} Win32_PerfFormattedData_Counters_ProcessorInformation | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1 PercentProcessorPerformance`,
    '[pscustomobject]@{gpuUsagePercent=$usage;gpuDedicatedBytes=$dedicated;gpuSharedBytes=$shared;processor=$perf} | ConvertTo-Json -Depth 6 -Compress'
  )

  return lines.join('; ')
}
