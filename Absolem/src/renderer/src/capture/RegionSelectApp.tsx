import { useEffect, useRef, useState } from 'react'
import {
  computeRegionRect,
  isValidRegionRect,
  regionKeyAction,
  type ScreenRect
} from '../../../shared/screen'
import { regionDisplayId } from './regionRoute'

/**
 * Tela de seleção de região (task 07, T5).
 *
 * A janela cobre um display inteiro. O usuário arrasta para desenhar o
 * retângulo; `Enter` confirma (mínimo 32x32 DIPs) e `Esc` cancela. O resultado
 * volta em DIPs locais ao display - a conversão para pixels físicos acontece
 * no main, com o `scaleFactor` do monitor correto.
 *
 * Nada é capturado aqui: a janela só devolve a seleção.
 */
export function RegionSelectApp() {
  const displayId = regionDisplayId(window.location.hash)
  const [selection, setSelection] = useState<ScreenRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const selectionRef = useRef<ScreenRect | null>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    const finish = (value: 'confirm' | 'cancel'): void => {
      if (submittedRef.current) return
      if (value === 'cancel') {
        submittedRef.current = true
        void window.absolem.capture.cancel({ kind: 'region' })
        return
      }
      const rect = selectionRef.current
      if (!rect || !isValidRegionRect(rect) || !displayId) return
      submittedRef.current = true
      void window.absolem.capture.submitRegion({ displayId, rect })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const action = regionKeyAction(event.key)
      if (!action) return
      event.preventDefault()
      finish(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [displayId])

  const update = (x: number, y: number): void => {
    const start = startRef.current
    if (!start) return
    setSelection(computeRegionRect(start.x, start.y, x, y))
  }

  return (
    <div
      className="region-root"
      data-region-display={displayId ?? ''}
      onPointerDown={(event) => {
        if (event.button !== 0 || submittedRef.current) return
        event.currentTarget.setPointerCapture(event.pointerId)
        startRef.current = { x: event.clientX, y: event.clientY }
        setSelection(null)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (!dragging) return
        update(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        if (!dragging) return
        update(event.clientX, event.clientY)
        setDragging(false)
      }}
      onPointerCancel={() => {
        setDragging(false)
        startRef.current = null
        setSelection(null)
      }}
    >
      <div className="region-hint" role="status">
        Arraste para selecionar a região. Enter confirma, Esc cancela. Mínimo 32x32.
      </div>
      {selection && selection.width > 0 && selection.height > 0 ? (
        <>
          <div
            className="region-selection"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height
            }}
          />
          <div
            className="region-size"
            style={{ left: selection.x, top: Math.max(0, selection.y - 22) }}
          >
            {Math.round(selection.width)} x {Math.round(selection.height)}
          </div>
        </>
      ) : null}
    </div>
  )
}
