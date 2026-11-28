import { describe, expect, it, vi } from 'vitest'
import type { CaptureFrameResultRequest, CaptureRequestPush } from '../../shared/ipc'
import type { CaptureGrabRequest, CapturedImage } from './controller'
import { createFrameGrabService } from './grabService'

const DATA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]).buffer

function request(requestId = 'req-1'): CaptureGrabRequest {
  return { requestId, sourceId: 'screen:0:0', pixelWidth: 1280, pixelHeight: 720, lossless: false }
}

function frame(overrides: Partial<CaptureFrameResultRequest> = {}): CaptureFrameResultRequest {
  return {
    requestId: 'req-1',
    ok: true,
    mime: 'image/jpeg',
    data: DATA,
    width: 1280,
    height: 720,
    ...overrides
  }
}

function image(bytes = DATA): CapturedImage {
  return { mime: 'image/jpeg', data: bytes, width: 1280, height: 720 }
}

describe('ponte de captura do frame', () => {
  it('resolve com o frame e libera o pedido', async () => {
    const sent: CaptureRequestPush[] = []
    const service = createFrameGrabService({
      sendRequest: (push) => {
        sent.push(push)
        return true
      }
    })

    const pending = service.request(request())
    expect(service.pendingCount()).toBe(1)
    expect(sent[0]).toEqual({
      requestId: 'req-1',
      sourceId: 'screen:0:0',
      pixelWidth: 1280,
      pixelHeight: 720,
      lossless: false
    })

    expect(service.handleResult(frame())).toEqual({ handled: true, ok: true })
    await expect(pending).resolves.toEqual({
      mime: 'image/jpeg',
      data: DATA,
      width: 1280,
      height: 720
    })
    expect(service.pendingCount()).toBe(0)
  })

  it('resposta inválida usa o fallback e encerra o pedido', async () => {
    const fallback = vi.fn(async () => image())
    const service = createFrameGrabService({ sendRequest: () => true, fallback })

    const pending = service.request(request())
    const handled = service.handleResult(frame({ data: new ArrayBuffer(0) }))

    expect(handled).toMatchObject({ handled: true, ok: false })
    await expect(pending).resolves.toMatchObject({ width: 1280 })
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(service.pendingCount()).toBe(0)
  })

  it('timeout usa o fallback e não deixa timer pendente', async () => {
    vi.useFakeTimers()
    try {
      const fallback = vi.fn(async () => image())
      const service = createFrameGrabService({
        sendRequest: () => true,
        fallback,
        timeoutMs: 1_000
      })
      const pending = service.request(request())

      await vi.advanceTimersByTimeAsync(1_001)
      await expect(pending).resolves.toMatchObject({ width: 1280 })
      expect(fallback).toHaveBeenCalledTimes(1)
      expect(service.pendingCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancelamento não usa fallback e limpa o pedido', async () => {
    const fallback = vi.fn(async () => image())
    const service = createFrameGrabService({ sendRequest: () => true, fallback })

    const pending = service.request(request())
    expect(service.cancel('req-1')).toBe(true)
    await expect(pending).rejects.toThrow('cancelada')
    expect(fallback).not.toHaveBeenCalled()
    expect(service.pendingCount()).toBe(0)
    expect(service.cancel('req-1')).toBe(false)
  })

  it('requestId duplicado não duplica pedido ao renderer', async () => {
    const sendRequest = vi.fn(() => true)
    const service = createFrameGrabService({ sendRequest })

    const first = service.request(request('dup'))
    const second = service.request(request('dup'))
    expect(sendRequest).toHaveBeenCalledTimes(1)

    service.handleResult(frame({ requestId: 'dup' }))
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(service.pendingCount()).toBe(0)
  })

  it('50 ciclos não deixam pedido nem timer pendente', async () => {
    const service = createFrameGrabService({ sendRequest: () => true })

    for (let index = 0; index < 50; index += 1) {
      const id = `cycle-${index}`
      const pending = service.request(request(id))
      service.handleResult(frame({ requestId: id }))
      await pending
    }

    expect(service.pendingCount()).toBe(0)
  })

  it('sem renderer cai no fallback', async () => {
    const service = createFrameGrabService({
      sendRequest: () => false,
      fallback: async () => image()
    })

    await expect(service.request(request())).resolves.toMatchObject({ width: 1280 })
    expect(service.pendingCount()).toBe(0)
  })

  it('100 frames concorrentes terminam sem deadlock e sem pedido pendente', async () => {
    const sent: string[] = []
    const service = createFrameGrabService({
      sendRequest: (push) => {
        sent.push(push.requestId)
        return true
      }
    })
    const startedAt = performance.now()
    const ids = Array.from({ length: 100 }, (_, index) => `many-${index}`)

    const pending = ids.map((id) => service.request(request(id)))
    expect(service.pendingCount()).toBe(100)
    for (const id of ids) service.handleResult(frame({ requestId: id }))

    const images = await Promise.all(pending)
    expect(images).toHaveLength(100)
    expect(sent).toHaveLength(100)
    expect(new Set(sent).size).toBe(100)
    expect(service.pendingCount()).toBe(0)
    expect(performance.now() - startedAt).toBeLessThan(2_000)
  })

  it('cancelAll rejeita todos os pedidos e libera os timers', async () => {
    const service = createFrameGrabService({ sendRequest: () => true })
    const pending = Array.from({ length: 100 }, (_, index) =>
      service.request(request(`cancel-${index}`))
    )
    const settled = pending.map((promise) => promise.catch((error: unknown) => error))

    service.cancelAll()

    const errors = await Promise.all(settled)
    expect(errors).toHaveLength(100)
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('cancelada')
    }
    expect(service.pendingCount()).toBe(0)
    expect(service.cancel('cancel-0')).toBe(false)
  })
})
