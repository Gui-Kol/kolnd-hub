import { useEffect, useRef } from 'react'
import type { ThemeConfig } from '../../../shared/theme'
import type { AvatarHandle } from '../overlay/avatar'

/**
 * Preview ao vivo da aba Aparência (240x280).
 *
 * É uma segunda cena independente: contexto WebGL próprio, `pixelRatio` 1 e
 * metade das partículas do overlay. Nunca compartilha contexto nem cena com o
 * overlay, e o `cleanup` descarta tudo ao desmontar (ou quando a janela é
 * ocultada, ver `SettingsApp`).
 */
export interface AvatarPreviewProps {
  theme: ThemeConfig
}

export function AvatarPreview({ theme }: AvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<AvatarHandle | null>(null)
  const themeRef = useRef(theme)

  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let handle: AvatarHandle | null = null

    void import('../overlay/avatar')
      .then((module) => {
        if (disposed) return
        const reducedMotion =
          themeRef.current.reducedMotion ||
          (typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        handle = module.mountAvatar(canvas, {
          themeConfig: themeRef.current,
          particleScale: 0.5,
          pixelRatioCap: 1,
          visible: true,
          reducedMotion
        })
        handleRef.current = handle
      })
      .catch((err: unknown) => {
        console.warn('avatar preview: fallback', err)
      })

    return () => {
      disposed = true
      handleRef.current = null
      handle?.dispose()
      handle = null
    }
  }, [])

  useEffect(() => {
    const systemReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    handleRef.current?.applyTheme({
      ...theme,
      reducedMotion: theme.reducedMotion || systemReduced
    })
  }, [theme])

  return (
    <div
      className="flex h-[280px] w-[240px] items-center justify-center overflow-hidden rounded-lg border border-surface-2 bg-[#0b0f14]"
      role="img"
      aria-label="Prévia do avatar com o tema atual"
    >
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
    </div>
  )
}
