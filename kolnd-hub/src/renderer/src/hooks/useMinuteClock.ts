// Relógio HH:MM do Big Picture — acorda uma vez por minuto, não a cada segundo.
//
// `msUntilNextMinute` devolve quanto falta para o próximo minuto cheio; o hook
// usa isso num único `setTimeout` e, a partir daí, um `setInterval` de 60 s.
// O guard de "só muda quando o texto muda" cobre atraso/jitter do timer (uma
// execução a mais no mesmo minuto não custa render).

import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000

function formatClock(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Milissegundos até o próximo minuto cheio (nunca zero: no :00 espera 60 s). */
export function msUntilNextMinute(now: Date): number {
  const elapsed = now.getSeconds() * 1000 + now.getMilliseconds()
  return MINUTE_MS - elapsed
}

/** Label `HH:MM` que atualiza no máximo 1× por minuto. */
export function useMinuteClock(): string {
  const [label, setLabel] = useState<string>(() => formatClock(new Date()))

  useEffect(() => {
    let interval: number | null = null

    const update = (): void => {
      setLabel((prev) => {
        const next = formatClock(new Date())
        return next === prev ? prev : next
      })
    }

    // Alinha no minuto cheio (não no minuto seguinte ao da montagem) e só
    // então passa ao intervalo fixo de 60 s.
    const timeout = window.setTimeout(() => {
      update()
      interval = window.setInterval(update, MINUTE_MS)
    }, msUntilNextMinute(new Date()))

    return (): void => {
      window.clearTimeout(timeout)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [])

  return label
}
