/**
 * Registradores MSR/SMN usados pelo monitor de hardware.
 *
 * Fica num módulo próprio porque o `cpuPower` (decodificação) e o agente
 * elevado (`agent.ts`) precisam da MESMA lista: se o agente importasse o
 * `cpuPower`, o `cpuPower` importaria o agente de volta para ler o sink — um
 * ciclo em tempo de execução.
 *
 * AMD:
 * - RAPL: `0xC0010299` (unidade) e `0xC001029B` (contador de energia).
 * - Tctl: SMN `0x00059800` (via `ioctl_read_smn` do módulo `AMDFamily17`).
 * - Tensão SVI2: bloco SVI0 em `0x0005A000`; TFN em `+0x8` e o plano 0
 *   (`VDDCR_CPU`) em `+0xC` ou `+0x10` conforme o modelo (ver `cpuVoltage`).
 *
 * Intel:
 * - RAPL: `0x606` (unidade) e `0x611` (contador).
 * - `0x1A2` (TjMax) e os status térmicos `0x1B1`/`0x19C`.
 * - Tensão: `0x198` (`IA32_PERF_STATUS`).
 */

export const MSR_AMD_RAPL_POWER_UNIT = 0xc0010299
export const MSR_AMD_PACKAGE_ENERGY_STATUS = 0xc001029b
export const SMN_THM_TCON_CUR_TMP = 0x00059800

/** Base do bloco SVI0 da telemetria SVI2 (LibreHardwareMonitor `Amd17Cpu.cs`). */
export const SMN_AMD_SVI0 = 0x0005a000
/** `SVI0_TFN_PLANE0`: bit 0 setado = leitura do plano 0 inválida. */
export const SMN_AMD_SVI0_TFN = 0x0005a008
/** Plano 0 (`VDDCR_CPU`) em `SVI + 0xC` — Zen/Zen+. */
export const SMN_AMD_SVI0_PLANE0_0C = 0x0005a00c
/** Plano 0 (`VDDCR_CPU`) em `SVI + 0x10` — Threadripper 3000, Zen 2–5. */
export const SMN_AMD_SVI0_PLANE0_10 = 0x0005a010

export const MSR_INTEL_RAPL_POWER_UNIT = 0x606
export const MSR_INTEL_PACKAGE_ENERGY_STATUS = 0x611
export const MSR_INTEL_TEMPERATURE_TARGET = 0x1a2
export const MSR_INTEL_PACKAGE_THERM_STATUS = 0x1b1
export const MSR_INTEL_THERM_STATUS = 0x19c
/** `IA32_PERF_STATUS`: volts no campo de 16 bits (ver `decodeIntelVoltage`). */
export const MSR_INTEL_PERF_STATUS = 0x198
