import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { OverlayConfig, VoiceConfig } from '../../../shared/config'
import type { SimpleResult, StoreGetResult, VoiceStatusResult } from '../../../shared/ipc'
import { isOverlayPosition } from '../../../shared/overlay'
import type { VoiceSetDeviceRequest, VoiceStatus } from '../../../shared/voice'
import { VOICE_DEFAULT_SHORTCUT } from '../../../shared/voice'

/**
 * Aba Voz (task 11, T5).
 *
 * Dispositivos, atalhos, barge-in, limite de sessão, consentimento do microfone,
 * status do wake word e um teste local de microfone de 3 s. O teste nunca chama
 * o Gemini: apenas mede o nível do sinal no renderer.
 */

export const MIC_TEST_DURATION_MS = 3_000
export const MIN_SESSION_MINUTES = 5
export const MAX_SESSION_MINUTES = 30

export interface AudioDeviceOption {
  id: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

export interface VoiceTabApi {
  getVoiceConfig: () => Promise<StoreGetResult>
  setVoiceConfig: (config: VoiceConfig) => Promise<SimpleResult>
  getOverlayConfig: () => Promise<StoreGetResult>
  setOverlayConfig: (config: OverlayConfig) => Promise<SimpleResult>
  status: () => Promise<VoiceStatusResult>
  setDevice: (request: VoiceSetDeviceRequest) => Promise<VoiceStatusResult>
  setConsent: (granted: boolean) => Promise<VoiceStatusResult>
  listDevices?: () => Promise<AudioDeviceOption[]>
  probeMicrophone?: (onLevel: (level: number) => void, durationMs: number) => Promise<void>
}

export interface VoiceTabProps {
  api?: VoiceTabApi
}

function readVoiceConfig(value: unknown): VoiceConfig {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    enabled: raw.enabled === true,
    inputDeviceId: typeof raw.inputDeviceId === 'string' ? raw.inputDeviceId : null,
    outputDeviceId: typeof raw.outputDeviceId === 'string' ? raw.outputDeviceId : null,
    outputVolume: typeof raw.outputVolume === 'number' ? raw.outputVolume : 1,
    maxSessionMinutes: typeof raw.maxSessionMinutes === 'number' ? raw.maxSessionMinutes : 15,
    silenceTimeoutSeconds:
      typeof raw.silenceTimeoutSeconds === 'number' ? raw.silenceTimeoutSeconds : 20,
    bargeIn: raw.bargeIn !== false,
    shortcut: typeof raw.shortcut === 'string' ? raw.shortcut : VOICE_DEFAULT_SHORTCUT
  }
}

function readOverlayConfig(value: unknown): OverlayConfig {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    visible: raw.visible === true,
    position: isOverlayPosition(raw.position) ? raw.position : 'bottom-left',
    offsetX: typeof raw.offsetX === 'number' ? raw.offsetX : 0,
    offsetY: typeof raw.offsetY === 'number' ? raw.offsetY : 0,
    width: typeof raw.width === 'number' ? raw.width : 320,
    height: typeof raw.height === 'number' ? raw.height : 360,
    shortcut: typeof raw.shortcut === 'string' ? raw.shortcut : 'Control+Alt+A',
    hideOnFullscreen: raw.hideOnFullscreen !== false
  }
}

function clampSessionMinutes(value: number): number {
  if (!Number.isFinite(value)) return 15
  return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(value)))
}

/** Converte uma combinação de teclas no formato do Electron (`Control+Alt+K`). */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const key = event.key
  if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')
  const normalized = key.length === 1 ? key.toUpperCase() : key
  parts.push(normalized)
  return parts.join('+')
}

async function defaultProbeMicrophone(
  onLevel: (level: number) => void,
  durationMs: number
): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const context = new AudioContext()
  try {
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    const startedAt = Date.now()
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const sample of data) {
          const value = (sample - 128) / 128
          sum += value * value
        }
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3))
        if (Date.now() - startedAt >= durationMs) resolve()
        else requestAnimationFrame(tick)
      }
      tick()
    })
  } finally {
    for (const track of stream.getTracks()) track.stop()
    void context.close().catch(() => undefined)
  }
}

function defaultApi(): VoiceTabApi {
  return {
    getVoiceConfig: () => window.absolem.storeGet('voice'),
    setVoiceConfig: (config) => window.absolem.storeSet('voice', config),
    getOverlayConfig: () => window.absolem.storeGet('overlay'),
    setOverlayConfig: (config) => window.absolem.storeSet('overlay', config),
    status: () => window.absolem.voice.status(),
    setDevice: (request) => window.absolem.voice.setDevice(request),
    setConsent: (granted) => window.absolem.voice.setConsent(granted),
    listDevices: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return []
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices
        .filter(
          (device): device is MediaDeviceInfo =>
            device.kind === 'audioinput' || device.kind === 'audiooutput'
        )
        .map((device) => ({
          id: device.deviceId,
          label: device.label || 'Dispositivo sem nome',
          kind: device.kind as 'audioinput' | 'audiooutput'
        }))
    },
    probeMicrophone: defaultProbeMicrophone
  }
}

export function VoiceTab({ api }: VoiceTabProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [config, setConfig] = useState<VoiceConfig>(() => readVoiceConfig(undefined))
  const [overlay, setOverlay] = useState<OverlayConfig>(() => readOverlayConfig(undefined))
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [devices, setDevices] = useState<AudioDeviceOption[]>([])
  const [minutesDraft, setMinutesDraft] = useState('15')
  const [micLevel, setMicLevel] = useState(0)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      client.getVoiceConfig().catch(() => null),
      client.getOverlayConfig().catch(() => null),
      client.status().catch(() => null),
      client.listDevices?.().catch(() => []) ?? Promise.resolve([])
    ]).then(([voiceResult, overlayResult, statusResult, deviceList]) => {
      if (cancelled) return
      if (voiceResult?.ok) {
        const next = readVoiceConfig(voiceResult.value)
        setConfig(next)
        setMinutesDraft(String(clampSessionMinutes(next.maxSessionMinutes)))
      }
      if (overlayResult?.ok) setOverlay(readOverlayConfig(overlayResult.value))
      if (statusResult?.ok) setStatus(statusResult.status)
      setDevices(deviceList ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [client])

  async function saveVoice(patch: Partial<VoiceConfig>): Promise<void> {
    const next = { ...config, ...patch }
    setConfig(next)
    const result = await client.setVoiceConfig(next)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
  }

  async function chooseDevice(kind: 'input' | 'output', value: string): Promise<void> {
    const request: VoiceSetDeviceRequest =
      kind === 'input' ? { inputDeviceId: value || null } : { outputDeviceId: value || null }
    const result = await client.setDevice(request)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatus(result.status)
    await saveVoice(
      kind === 'input'
        ? { inputDeviceId: result.status.inputDeviceId }
        : { outputDeviceId: result.status.outputDeviceId }
    )
    setNotice('Dispositivo salvo. A próxima sessão de voz usa a escolha.')
  }

  async function saveMinutes(): Promise<void> {
    const clamped = clampSessionMinutes(Number(minutesDraft))
    setMinutesDraft(String(clamped))
    await saveVoice({ maxSessionMinutes: clamped })
    if (String(clamped) !== minutesDraft) {
      setNotice(
        `Limite ajustado para ${clamped} minutos (faixa ${MIN_SESSION_MINUTES}-${MAX_SESSION_MINUTES}).`
      )
    }
  }

  async function grantConsent(): Promise<void> {
    const result = await client.setConsent(true)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatus(result.status)
    setNotice('Consentimento do microfone concedido. Clique no avatar para falar.')
  }

  async function revokeConsent(): Promise<void> {
    const result = await client.setConsent(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatus(result.status)
    setNotice('Consentimento do microfone revogado. A conversa por texto continua disponível.')
  }

  async function testMicrophone(): Promise<void> {
    if (!client.probeMicrophone || testing) return
    setTesting(true)
    setError(null)
    setNotice('Testando o microfone por 3 s. O áudio não é enviado ao modelo.')
    try {
      await client.probeMicrophone((level) => setMicLevel(level), MIC_TEST_DURATION_MS)
      setNotice('Teste de microfone concluído.')
    } catch {
      setError('Não foi possível acessar o microfone.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section aria-labelledby="voice-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 id="voice-title" className="text-base font-semibold text-ink-primary">
          Voz
        </h2>
        <p className="text-xs text-ink-tertiary">
          A conversa por voz usa o Gemini Live. O microfone só é aberto com consentimento e o
          indicador fica visível no avatar. O áudio não é gravado em disco.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded border border-red-400/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded border border-surface-2 px-3 py-2 text-xs text-ink-secondary"
        >
          {notice}
        </p>
      ) : null}

      <section aria-labelledby="voice-devices-title" className="flex flex-col gap-3">
        <h3 id="voice-devices-title" className="text-sm font-semibold text-ink-primary">
          Dispositivos
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="voice-input-device" className="text-xs text-ink-secondary">
              Microfone
            </label>
            <select
              id="voice-input-device"
              value={config.inputDeviceId ?? ''}
              onChange={(event) => {
                void chooseDevice('input', event.target.value)
              }}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            >
              <option value="">Padrão do sistema</option>
              {devices
                .filter((device) => device.kind === 'audioinput')
                .map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="voice-output-device" className="text-xs text-ink-secondary">
              Saída de áudio
            </label>
            <select
              id="voice-output-device"
              value={config.outputDeviceId ?? ''}
              onChange={(event) => {
                void chooseDevice('output', event.target.value)
              }}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            >
              <option value="">Padrão do sistema</option>
              {devices
                .filter((device) => device.kind === 'audiooutput')
                .map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void testMicrophone()
            }}
            disabled={testing}
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
          >
            {testing ? 'Testando…' : 'Testar microfone (3s)'}
          </button>
          <div
            role="meter"
            aria-label="Nível do microfone"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(micLevel.toFixed(2))}
            className="h-2 w-40 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              data-mic-level
              className="h-full bg-accent transition-[width] duration-100"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
            />
          </div>
          <span className="text-xs text-ink-tertiary">
            Mede só o nível local; nada é enviado ao modelo.
          </span>
        </div>
        <p className="text-xs text-ink-tertiary">
          Microfone:{' '}
          <strong className="text-ink-secondary">
            {status?.consentGranted ? 'consentido' : 'não consentido'}
          </strong>
          {' · '}
          Estado: <span data-voice-status>{status ? status.state : 'desconhecido'}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {status?.consentGranted ? null : (
            <button
              type="button"
              onClick={() => {
                void grantConsent()
              }}
              className="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-surface-base"
            >
              Permitir microfone
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void revokeConsent()
            }}
            className="self-start rounded border border-amber-400/50 px-3 py-1.5 text-xs text-amber-200 hover:border-amber-300"
          >
            Revogar consentimento de microfone
          </button>
        </div>
      </section>

      <section aria-labelledby="voice-shortcuts-title" className="flex flex-col gap-3">
        <h3 id="voice-shortcuts-title" className="text-sm font-semibold text-ink-primary">
          Atalhos
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="voice-shortcut" className="text-xs text-ink-secondary">
              Atalho de escuta
            </label>
            <input
              id="voice-shortcut"
              readOnly
              value={config.shortcut ?? VOICE_DEFAULT_SHORTCUT}
              onKeyDown={(event) => {
                event.preventDefault()
                const accelerator = acceleratorFromEvent(event)
                if (accelerator) void saveVoice({ shortcut: accelerator })
              }}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              aria-describedby="voice-shortcut-hint"
            />
            <p id="voice-shortcut-hint" className="text-xs text-ink-tertiary">
              Clique no campo e pressione a combinação. Aplicado ao reiniciar o app.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="voice-overlay-shortcut" className="text-xs text-ink-secondary">
              Atalho do overlay
            </label>
            <input
              id="voice-overlay-shortcut"
              readOnly
              value={overlay.shortcut}
              onKeyDown={(event) => {
                event.preventDefault()
                const accelerator = acceleratorFromEvent(event)
                if (!accelerator) return
                const next = { ...overlay, shortcut: accelerator }
                setOverlay(next)
                void client.setOverlayConfig(next).then((result) => {
                  if (!result.ok) setError(result.error)
                  else setNotice('Atalho do overlay salvo. Aplicado pela task 02.')
                })
              }}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              aria-describedby="voice-overlay-shortcut-hint"
            />
            <p id="voice-overlay-shortcut-hint" className="text-xs text-ink-tertiary">
              Mesmo atalho global do overlay (aplicado ao reiniciar o app).
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="voice-session-title" className="flex flex-col gap-3">
        <h3 id="voice-session-title" className="text-sm font-semibold text-ink-primary">
          Sessão
        </h3>
        <label
          htmlFor="voice-barge-in"
          className="flex items-center gap-2 text-sm text-ink-primary"
        >
          <input
            id="voice-barge-in"
            type="checkbox"
            checked={config.bargeIn !== false}
            onChange={(event) => {
              void saveVoice({ bargeIn: event.target.checked })
            }}
          />
          Interromper ao falar (barge-in)
        </label>
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <label htmlFor="voice-max-minutes" className="text-xs text-ink-secondary">
            Limite de sessão em minutos ({MIN_SESSION_MINUTES}-{MAX_SESSION_MINUTES})
          </label>
          <input
            id="voice-max-minutes"
            type="number"
            min={MIN_SESSION_MINUTES}
            max={MAX_SESSION_MINUTES}
            value={minutesDraft}
            onChange={(event) => setMinutesDraft(event.target.value)}
            onBlur={() => {
              void saveMinutes()
            }}
            className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
          />
        </div>
      </section>

      <section aria-labelledby="voice-wake-title" className="flex flex-col gap-2">
        <h3 id="voice-wake-title" className="text-sm font-semibold text-ink-primary">
          Wake word
        </h3>
        <p className="text-xs text-ink-secondary">
          Desligada na v1. Clique no avatar ou use o atalho para falar.{' '}
          <a
            href="docs/wake-word.md"
            className="text-accent underline"
            onClick={(event) => event.preventDefault()}
          >
            Absolem/docs/wake-word.md
          </a>
        </p>
      </section>
    </section>
  )
}
