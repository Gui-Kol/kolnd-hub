import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createMediaPermissionHandlers } from '../permissions'
import { isAllowedNavigationUrl } from '../navigation'
import { parseAllowedExternalUrl } from '../../shared/search'
import {
  SECURE_WEB_PREFERENCES,
  blockWebviewAttach,
  isSecureWebPreferences
} from './webPreferences'

/**
 * Hardening do Electron (task 13/T5).
 *
 * Verifica as três janelas (Configurações, overlay e seleção de região), a CSP
 * de produção, o bloqueio de webview, a permissão de mídia restrita ao overlay
 * e as travas de navegação/links externos. O teste manual com DevTools fica no
 * checklist de release quando houver app interativo.
 */

const ROOT = process.cwd()

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function cspDirectives(html: string): Record<string, string> {
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)
  if (!match) throw new Error('CSP ausente no index.html')
  const directives: Record<string, string> = {}
  for (const part of (match[1] ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name) directives[name] = values.join(' ')
  }
  return directives
}

describe('hardening do Electron', () => {
  it('webPreferences seguras nas três janelas', () => {
    expect(isSecureWebPreferences({ ...SECURE_WEB_PREFERENCES })).toBe(true)

    const windows = [
      'src/main/lifecycle.ts',
      'src/main/overlay/overlayWindow.ts',
      'src/main/capture/instance.ts'
    ]
    for (const file of windows) {
      const text = source(file)
      expect(text, `${file} deve usar SECURE_WEB_PREFERENCES`).toContain(
        '...SECURE_WEB_PREFERENCES'
      )
      expect(text, `${file} deve negar webview`).toContain('blockWebviewAttach(')
    }
    expect(source('src/main/index.ts')).toContain('app.enableSandbox()')
  })

  it('CSP de produção não tem unsafe-eval e não libera script inline', () => {
    const directives = cspDirectives(source('src/renderer/index.html'))
    expect(directives['default-src']).toBe("'self'")
    expect(directives['script-src']).toBe("'self'")
    expect(directives['object-src']).toBe("'none'")
    expect(directives['base-uri']).toBe("'none'")
    expect(directives['form-action']).toBe("'none'")
    expect(directives['script-src']).not.toContain('unsafe-eval')
    expect(directives['script-src']).not.toContain('unsafe-inline')
    // Estilo inline é usado por atributos de tema/animação no avatar.
    expect(directives['style-src']).toContain("'unsafe-inline'")
  })

  it('webview negado em qualquer tentativa', () => {
    const state: {
      listener: ((event: { preventDefault: () => void }) => void) | null
    } = { listener: null }
    const contents = {
      on: (
        event: 'will-attach-webview',
        handler: (event: { preventDefault: () => void }) => void
      ) => {
        if (event === 'will-attach-webview') state.listener = handler
      }
    }
    blockWebviewAttach(contents)
    if (!state.listener) throw new Error('listener de webview não registrado')
    const preventDefault = vi.fn()
    state.listener({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('permissão de media só no overlay e com consentimento', () => {
    const overlay = { id: 'overlay' }
    const other = { id: 'settings' }
    const handlers = createMediaPermissionHandlers({
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn()
      },
      isOverlayContents: (contents) => contents === overlay,
      hasConsent: () => true
    })

    const allowed = vi.fn()
    handlers.request(overlay, 'media', allowed)
    expect(allowed).toHaveBeenLastCalledWith(true)

    handlers.request(other, 'media', allowed)
    expect(allowed).toHaveBeenLastCalledWith(false)

    handlers.request(overlay, 'geolocation', allowed)
    expect(allowed).toHaveBeenLastCalledWith(false)

    expect(handlers.check(overlay, 'media', 'file:///app/renderer/index.html')).toBe(true)
    expect(handlers.check(other, 'media', 'file:///app/renderer/index.html')).toBe(false)

    const denied = createMediaPermissionHandlers({
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn()
      },
      isOverlayContents: (contents) => contents === overlay,
      hasConsent: () => false
    })
    expect(denied.check(overlay, 'media', 'file:///app/renderer/index.html')).toBe(false)
  })

  it('navegação e link externo ficam na allowlist', () => {
    expect(isAllowedNavigationUrl('https://evil.example/', null)).toBe(false)
    expect(isAllowedNavigationUrl('https://evil.example/', 'http://localhost:5173')).toBe(false)
    expect(isAllowedNavigationUrl('http://localhost:5173/#overlay', 'http://localhost:5173')).toBe(
      true
    )
    expect(parseAllowedExternalUrl('https://aistudio.google.com/apikey')).toBe(
      'https://aistudio.google.com/apikey'
    )
    expect(parseAllowedExternalUrl('file:///C:/Users/joao/segredo.txt')).toBeNull()
    expect(parseAllowedExternalUrl('javascript:alert(1)')).toBeNull()
    expect(parseAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('overlay preserva foco desligado e clique atravessa', () => {
    const text = source('src/main/overlay/overlayWindow.ts')
    expect(text).toContain('focusable: false')
    expect(text).toContain('setIgnoreMouseEvents(true, { forward: true })')
    expect(text).toContain('setWindowOpenHandler')
    expect(text).toContain("'will-navigate'")
  })
})
