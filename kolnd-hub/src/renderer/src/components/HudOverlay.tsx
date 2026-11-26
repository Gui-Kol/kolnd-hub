import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HUD_DEFAULT_WIDTH } from '../../../shared/hud'
import { normalizeHudFpsReading, type HudFpsReason, type HudFpsReading } from '../../../shared/fps'
import { hudColumnCount } from '../lib/hudLayout'
import type { HudScale, HudUpdate } from '../types'

/**
 * Rota `#hud` do renderer — conteúdo da janela transparente de sobreposição.
 *
 * Sem interação de propósito: a janela usa `focusable: false` e clique
 * atravessando, então não existem botões, links ou drag aqui. Os dados chegam
 * somente por push (`hud:update`, ~1 Hz) do main — o overlay não faz polling
 * próprio nem acessa Node.
 *
 * Sem título/cabeçalho (pedido do usuário): o painel começa direto no CPU.
 * A altura é automática — este componente mede o conteúdo com `ResizeObserver`
 * e informa o main (`hud:report-size`), que aplica `setBounds`. Nada de
 * `overflow: hidden`: nomes longos quebram linha em vez de serem cortados.
 */

const DASH = '—'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHudScaleValue(value: unknown): value is HudScale {
  return value === 'compacta' || value === 'normal' || value === 'grande'
}

/** O renderer não confia no IPC: valida a forma antes de renderizar qualquer número. */
function isHudUpdate(value: unknown): value is HudUpdate {
  if (!isRecord(value)) return false
  if (typeof value.capturedAt !== 'string') return false
  if (!isRecord(value.snapshot)) return false
  const snapshot = value.snapshot
  if (!isRecord(snapshot.power) || !isRecord(snapshot.cpu) || !isRecord(snapshot.ram)) return false
  if (!isRecord(snapshot.gpu)) return false
  if (typeof snapshot.capturedAt !== 'string') return false
  if (!isRecord(value.size)) return false
  if (typeof value.size.width !== 'number' || !Number.isFinite(value.size.width)) return false
  if (!isHudScaleValue(value.size.scale)) return false
  return true
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

function formatInt(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

function formatGhz(mhz: number): string {
  return formatDecimal(mhz / 1000, 2)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return DASH
  return date.toLocaleTimeString('pt-BR')
}

interface Typography {
  label: string
  value: string
  unit: string
}

/**
 * Escalas tipográficas (persistidas em `hud.scale`). Classes estáticas para o
 * Tailwind as encontrar no build; a largura é livre (180–560) e o grid quebra
 * o texto quando falta espaço.
 */
const TYPOGRAPHY: Record<HudScale, Typography> = {
  compacta: {
    label: 'text-[9px]',
    value: 'text-[12px]',
    unit: 'text-[9px]'
  },
  normal: {
    label: 'text-[9px]',
    value: 'text-[14px]',
    unit: 'text-[10px]'
  },
  grande: {
    label: 'text-[10px]',
    value: 'text-[16px]',
    unit: 'text-[11px]'
  }
}

function Dash(): JSX.Element {
  return <span className="text-white/35">{DASH}</span>
}

/**
 * Motivo curto do "—" (≤ 40 caracteres). A UI traduz a whitelist; o texto
 * nunca carrega número e nunca reaproveita o último valor medido.
 */
const FPS_REASON_TEXT: Record<HudFpsReason, string> = {
  'self-focus': 'Abra o jogo e volte a apertar o atalho',
  'foreground-ignored': 'Sem jogo em primeiro plano',
  'no-foreground': 'Sem app em primeiro plano',
  'no-presents': 'Em primeiro plano não apresenta',
  stale: 'Sem leitura recente',
  'engine-missing': 'Captura indisponível',
  outdated: 'Captura desatualizada',
  'not-activated': 'Captura não ativada',
  warming: 'Medindo…'
}

function fpsStateText(reading: HudFpsReading | null): string {
  if (!reading) return 'Aguardando leitura'
  if (reading.state === 'live') return 'ao vivo'
  return reading.reason ? FPS_REASON_TEXT[reading.reason] : 'Sem medição'
}

interface MetricProps {
  label: string
  value: ReactNode
  unit?: string
  testId?: string
  typography: Typography
}

function Metric({ label, value, unit, testId, typography }: MetricProps): JSX.Element {
  // Linha normal: rótulo à esquerda e valor à direita. `flex-wrap` + `ml-auto`
  // garantem que, quando o valor não couber ao lado do rótulo, ele desça para
  // a linha de baixo continuando alinhado à direita — nunca cortado. O
  // `whitespace-nowrap` impede que o número quebre no meio (ex.: `3.200` em
  // duas linhas), que é o que deixava dígitos fora do painel em 180 px.
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
      <dt
        className={`${typography.label} whitespace-nowrap font-medium uppercase tracking-[0.12em] text-white/40`}
      >
        {label}
      </dt>
      <dd
        className={`${typography.value} ml-auto whitespace-nowrap text-right font-semibold tabular-nums text-white/90`}
        data-testid={testId}
      >
        {value}
        {unit && (
          <span className={`${typography.unit} ml-1 font-normal text-white/40`}>{unit}</span>
        )}
      </dd>
    </div>
  )
}

interface SectionProps {
  title: string
  testId: string
  typography: Typography
  /** Nome longo (ex.: GPU) que quebra linha em vez de ser truncado. */
  subtitle?: string | null
  children: ReactNode
}

function Section({ title, testId, typography, subtitle, children }: SectionProps): JSX.Element {
  return (
    <section
      data-testid={testId}
      className="min-w-0 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-1.5 pb-1.5 pt-1"
    >
      <p
        className={`${typography.label} border-b border-white/[0.06] pb-1 font-semibold uppercase tracking-[0.18em] text-white/45`}
      >
        {title}
      </p>
      {subtitle && (
        <p className="mt-1 break-words text-[10px] leading-snug text-white/50">{subtitle}</p>
      )}
      <dl className="mt-1 space-y-0.5">{children}</dl>
    </section>
  )
}

interface FpsStripProps {
  reading: HudFpsReading | null
  typography: Typography
}

/**
 * Faixa de FPS no topo. Número grande + frametime + processo em `live`; em
 * qualquer outro estado, "—" e o motivo curto. Nada de largura fixa: o nome
 * quebra linha e a altura automática do overlay resolve (matriz 180–560).
 */
function FpsStrip({ reading, typography }: FpsStripProps): JSX.Element {
  const live = reading?.state === 'live' ? reading : null
  const fps = live?.fps ?? null
  const frametime = live?.frametimeMs ?? null
  const processName = live?.processName ?? null

  return (
    <section
      data-testid="hud-fps"
      className="min-w-0 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-2 pb-1.5 pt-1"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`${typography.label} font-semibold uppercase tracking-[0.18em] text-white/45`}
        >
          FPS
        </span>
        <span
          className="whitespace-nowrap text-[20px] font-bold leading-none tabular-nums text-white/90"
          data-testid="hud-fps-value"
        >
          {fps === null ? <Dash /> : formatInt(fps)}
        </span>
        <span
          className={`${typography.unit} whitespace-nowrap text-white/45`}
          data-testid="hud-fps-frametime"
        >
          {frametime === null ? <Dash /> : `${formatDecimal(frametime, 1)} ms`}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="min-w-0 break-words text-[10px] leading-snug text-white/60"
          data-testid="hud-fps-process"
        >
          {processName ?? DASH}
        </span>
        <span
          className="min-w-0 break-words text-[9px] leading-snug text-white/40"
          data-testid="hud-fps-state"
        >
          {fpsStateText(reading)}
        </span>
      </div>
    </section>
  )
}

export function HudOverlay(): JSX.Element {
  const [update, setUpdate] = useState<HudUpdate | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Assinatura única: o main só envia enquanto a janela está visível.
    return window.api.onHudUpdate((value) => {
      if (isHudUpdate(value)) setUpdate(value)
    })
  }, [])

  // Mede o conteúdo e pede a altura ao main. O `ResizeObserver` reage a fonte,
  // escala e nomes longos; o filtro de 1 px evita loop de resize quando o
  // Chromium arredonda a borda.
  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    let lastHeight = 0

    const report = (): void => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height <= 0 || Math.abs(height - lastHeight) < 1) return
      lastHeight = height
      void window.api.hudReportSize(height).catch(() => undefined)
    }

    const observer = new ResizeObserver(() => report())
    observer.observe(element)
    report()
    return () => observer.disconnect()
  }, [])

  const typography = TYPOGRAPHY[update?.size.scale ?? 'normal']
  const snapshot = update?.snapshot ?? null
  // Valida de novo: um `fps` ausente/inválido vira null e a faixa mostra "—".
  const fpsReading = normalizeHudFpsReading(update?.fps)

  const cpu = snapshot?.cpu ?? null
  const gpu = snapshot?.gpu ?? null
  const ram = snapshot?.ram ?? null
  const power = snapshot?.power ?? null

  const cpuUsage = finite(cpu?.usagePercent)
  const cpuClock = finite(cpu?.clockMhz)
  const cpuTemp = finite(cpu?.tempC)
  // Vcore só existe quando a leitura elevada (SVI2/IA32_PERF_STATUS) responde;
  // `null` continua "—" para não exibir estimativa como medição.
  const cpuVoltage = finite(cpu?.voltageV)
  const cpuWatts = finite(power?.cpuW) ?? finite(cpu?.watts) ?? finite(power?.cpuEstimatedW)

  const gpuUsage = finite(gpu?.usagePercent)
  const gpuCoreClock = finite(gpu?.coreClockMhz)
  const gpuTemp = finite(gpu?.tempC)
  const gpuWatts = finite(power?.gpuW) ?? finite(gpu?.watts)
  const vramUsed = finite(gpu?.vramUsedMb)
  const vramTotal = finite(gpu?.vramTotalMb)
  const gpuMemClock = finite(gpu?.memClockMhz)
  const gpuFan = finite(gpu?.fanPercent)

  const ramUsed = finite(ram?.usedGb)
  const ramTotal = finite(ram?.installedGb)
  const ramPercent = finite(ram?.usedPercent)
  const ramSpeed = finite(ram?.speedMhz)
  const ramVoltage = finite(ram?.voltageV)

  const measuredTotal = finite(power?.totalMeasuredW)
  const estimatedTotal = finite(power?.totalEstimatedW)
  const platformW = finite(power?.platformEstimatedW)
  const totalW = measuredTotal ?? estimatedTotal
  const totalSource =
    measuredTotal !== null ? 'medido' : estimatedTotal !== null ? 'estimado' : null

  // D1: 1 coluna abaixo de 300 px (180–290); 2 colunas de 300 a 560 — o padrão
  // 300 usa o layout compacto, que cabe na altura de uma área de trabalho 720p.
  // Antes do primeiro push usamos o padrão 300, que já é 2 colunas.
  const columns = hudColumnCount(update?.size.width ?? HUD_DEFAULT_WIDTH)

  return (
    <div
      ref={rootRef}
      data-testid="hud-overlay"
      className="flex w-full flex-col gap-2 overflow-visible rounded-[14px] border border-white/[0.08] bg-[rgba(8,12,17,0.86)] p-2.5 text-white"
    >
      <FpsStrip reading={fpsReading} typography={typography} />

      <div className={`grid gap-2 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Section title="CPU" testId="hud-cpu" typography={typography} subtitle={cpu?.model ?? null}>
          <Metric
            label="Uso"
            value={cpuUsage === null ? <Dash /> : formatDecimal(cpuUsage, 1)}
            unit="%"
            testId="hud-cpu-usage"
            typography={typography}
          />
          <Metric
            label="Clock"
            value={cpuClock === null ? <Dash /> : formatGhz(cpuClock)}
            unit="GHz"
            testId="hud-cpu-clock"
            typography={typography}
          />
          <Metric
            label="Temp."
            value={cpuTemp === null ? <Dash /> : formatDecimal(cpuTemp, 1)}
            unit="°C"
            testId="hud-cpu-temp"
            typography={typography}
          />
          <Metric
            label="Vcore"
            value={cpuVoltage === null ? <Dash /> : formatDecimal(cpuVoltage, 3)}
            unit="V"
            testId="hud-cpu-voltage"
            typography={typography}
          />
          <Metric
            label="Potência"
            value={cpuWatts === null ? <Dash /> : formatDecimal(cpuWatts, 1)}
            unit="W"
            testId="hud-cpu-power"
            typography={typography}
          />
        </Section>

        <Section title="GPU" testId="hud-gpu" typography={typography} subtitle={gpu?.model ?? null}>
          <Metric
            label="Uso"
            value={gpuUsage === null ? <Dash /> : formatInt(gpuUsage)}
            unit="%"
            testId="hud-gpu-usage"
            typography={typography}
          />
          <Metric
            label="Clock"
            value={gpuCoreClock === null ? <Dash /> : formatInt(gpuCoreClock)}
            unit="MHz"
            testId="hud-gpu-clock"
            typography={typography}
          />
          <Metric
            label="Temp."
            value={gpuTemp === null ? <Dash /> : formatDecimal(gpuTemp, 1)}
            unit="°C"
            testId="hud-gpu-temp"
            typography={typography}
          />
          <Metric
            label="Potência"
            value={gpuWatts === null ? <Dash /> : formatDecimal(gpuWatts, 1)}
            unit="W"
            testId="hud-gpu-power"
            typography={typography}
          />
          <Metric
            label="VRAM"
            value={
              vramUsed === null || vramTotal === null ? (
                <Dash />
              ) : (
                `${formatInt(vramUsed)}/${formatInt(vramTotal)}`
              )
            }
            unit="MB"
            testId="hud-gpu-vram"
            typography={typography}
          />
          <Metric
            label="VRAM clock"
            value={gpuMemClock === null ? <Dash /> : formatInt(gpuMemClock)}
            unit="MHz"
            testId="hud-gpu-mem-clock"
            typography={typography}
          />
          <Metric
            label="Ventoinha"
            value={gpuFan === null ? <Dash /> : formatInt(gpuFan)}
            unit="%"
            testId="hud-gpu-fan"
            typography={typography}
          />
        </Section>

        <Section title="RAM" testId="hud-ram" typography={typography}>
          <Metric
            label="Uso"
            value={
              ramUsed === null ? (
                <Dash />
              ) : ramTotal === null ? (
                `${formatDecimal(ramUsed, 1)} GB`
              ) : (
                `${formatDecimal(ramUsed, 1)}/${formatDecimal(ramTotal, 1)}`
              )
            }
            unit="GB"
            testId="hud-ram-usage"
            typography={typography}
          />
          <Metric
            label="Ocupação"
            value={ramPercent === null ? <Dash /> : formatDecimal(ramPercent, 1)}
            unit="%"
            testId="hud-ram-percent"
            typography={typography}
          />
          <Metric
            label="Clock"
            value={ramSpeed === null ? <Dash /> : formatInt(ramSpeed)}
            unit="MHz"
            testId="hud-ram-clock"
            typography={typography}
          />
          <Metric
            label="Tensão"
            value={ramVoltage === null ? <Dash /> : formatDecimal(ramVoltage, 2)}
            unit="V"
            testId="hud-ram-voltage"
            typography={typography}
          />
        </Section>

        <Section title="Energia" testId="hud-energy" typography={typography}>
          <Metric
            label="Total"
            value={
              totalW === null ? (
                <Dash />
              ) : (
                <>
                  {formatDecimal(totalW, 1)}
                  {totalSource && (
                    <span className={`${typography.unit} ml-1 font-normal text-white/40`}>
                      {totalSource}
                    </span>
                  )}
                </>
              )
            }
            unit="W"
            testId="hud-energy-total"
            typography={typography}
          />
          <Metric
            label="CPU"
            value={cpuWatts === null ? <Dash /> : formatDecimal(cpuWatts, 1)}
            unit="W"
            testId="hud-energy-cpu"
            typography={typography}
          />
          <Metric
            label="GPU"
            value={gpuWatts === null ? <Dash /> : formatDecimal(gpuWatts, 1)}
            unit="W"
            testId="hud-energy-gpu"
            typography={typography}
          />
          <Metric
            label="Plataforma"
            value={platformW === null ? <Dash /> : formatDecimal(platformW, 1)}
            unit="W"
            testId="hud-energy-platform"
            typography={typography}
          />
        </Section>
      </div>

      <div className="flex items-center border-t border-white/[0.07] pt-1">
        <span
          className={`${typography.label} whitespace-nowrap text-white/35`}
          data-testid="hud-updated"
        >
          {update ? formatTime(update.capturedAt) : 'aguardando…'}
        </span>
      </div>
    </div>
  )
}
