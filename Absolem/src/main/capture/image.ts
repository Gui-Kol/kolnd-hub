import { nativeImage } from 'electron'
import type { PixelRect } from './activeWindow'
import type { CapturedImage } from './controller'

/**
 * Recorte da imagem no main (task 07, T4/T5).
 *
 * A imagem chega na resolução devolvida pelo renderer e o retângulo já foi
 * convertido para esse espaço pelo controlador (task 04). `nativeImage.crop`
 * trabalha em pixels; o formato original é preservado (PNG para texto, JPEG
 * qualidade 0.75 caso contrário). Nada é salvo em disco.
 */

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return copy.buffer
}

export function cropCapturedImage(image: CapturedImage, rect: PixelRect): CapturedImage {
  const source = nativeImage.createFromBuffer(Buffer.from(new Uint8Array(image.data)))
  if (source.isEmpty()) throw new Error('imagem de captura inválida para recorte')
  const cropped = source.crop({
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  })
  if (cropped.isEmpty()) throw new Error('recorte da captura veio vazio')
  const size = cropped.getSize()
  const buffer = image.mime === 'image/png' ? cropped.toPNG() : cropped.toJPEG(75)
  return {
    mime: image.mime,
    data: toArrayBuffer(buffer),
    width: size.width,
    height: size.height
  }
}
