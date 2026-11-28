import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Validação de URL contra SSRF (task 10, T2).
 *
 * Toda URL vinda do usuário ou de uma citação é hostil. A validação é
 * bloqueante e acontece ANTES de qualquer requisição e DE NOVO em cada salto
 * de redirecionamento:
 * - só `http:` e `https:`;
 * - URL com usuário/senha é recusada (evita credencial em log/redirect);
 * - `localhost`, `.localhost` e `.local` nunca resolvem;
 * - IP literal privado/reservado é recusado sem DNS;
 * - host que resolva para QUALQUER endereço privado/reservado é recusado.
 *
 * `dns.lookup` e `net.isIP` são injetados para o teste cobrir faixas privadas
 * sem rede. As faixas cobertas: 127/8, 10/8, 172.16/12, 192.168/16,
 * 169.254/16, ::1, fc00::/7 e fe80::/10 (além de reservadas adjacentes).
 */

export interface UrlLookupAddress {
  address: string
  family?: number
}

export interface ValidateUrlDeps {
  lookup: (hostname: string) => Promise<UrlLookupAddress[]>
  isIP: (value: string) => number
}

export type UrlValidationReason =
  'invalid' | 'protocol' | 'credentials' | 'hostname' | 'private-ip' | 'dns'

export type UrlValidation =
  { ok: true; url: URL } | { ok: false; reason: UrlValidationReason; message: string }

function privateError(message: string): UrlValidation {
  return { ok: false, reason: 'private-ip', message }
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const values: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value < 0 || value > 255) return null
    values.push(value)
  }
  return values
}

/** `true` para qualquer IPv4 que não seja roteável na internet pública. */
export function isPrivateIpv4(address: string): boolean {
  const parts = parseIpv4(address)
  if (!parts) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true
  if (a === 10) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0) return true
  if (a >= 224) return true
  return false
}

function mappedIpv4(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (dotted) return dotted[1] ?? null
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (!hex) return null
  const high = Number.parseInt(hex[1] as string, 16)
  const low = Number.parseInt(hex[2] as string, 16)
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/** `true` para IPv6 loopback, link-local, ULA ou IPv4 mapeado privado. */
export function isPrivateIpv6(address: string): boolean {
  let value = address.trim().toLowerCase()
  const zone = value.indexOf('%')
  if (zone >= 0) value = value.slice(0, zone)
  if (value === '::1' || value === '::') return true
  const mapped = mappedIpv4(value)
  if (mapped) return isPrivateIpv4(mapped)
  const first = /^([0-9a-f]{1,4})/.exec(value)
  if (!first) return false
  const hextet = Number.parseInt(first[1] as string, 16)
  if ((hextet & 0xfe00) === 0xfc00) return true
  if ((hextet & 0xffc0) === 0xfe80) return true
  return false
}

/** Aceita endereço IPv4 ou IPv6; `false` para qualquer valor inválido. */
export function isPrivateAddress(address: string, isIp: (value: string) => number = isIP): boolean {
  const version = isIp(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return true
}

function normalizeHostname(hostname: string): string {
  let value = hostname.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  while (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

function isBlockedHostname(hostname: string): boolean {
  const value = normalizeHostname(hostname)
  if (!value) return true
  if (value === 'localhost') return true
  if (value.endsWith('.localhost')) return true
  if (value.endsWith('.local')) return true
  return false
}

export function defaultValidateUrlDeps(): ValidateUrlDeps {
  return {
    lookup: async (hostname) => lookup(hostname, { all: true, verbatim: true }),
    isIP: (value) => isIP(value)
  }
}

export async function validateUrl(
  raw: string,
  deps: ValidateUrlDeps = defaultValidateUrlDeps()
): Promise<UrlValidation> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'invalid', message: 'URL vazia.' }
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'invalid', message: 'URL inválida.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol', message: 'Apenas http e https são permitidos.' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials', message: 'URL com usuário/senha é recusada.' }
  }

  const hostname = normalizeHostname(url.hostname)
  if (!hostname) {
    return { ok: false, reason: 'hostname', message: 'URL sem host.' }
  }
  if (isBlockedHostname(hostname)) {
    return {
      ok: false,
      reason: 'hostname',
      message: `Host bloqueado pela política de segurança: ${hostname}.`
    }
  }

  const literalVersion = deps.isIP(hostname)
  if (literalVersion !== 0) {
    if (isPrivateAddress(hostname, deps.isIP)) {
      return privateError(`Endereço privado ou reservado recusado: ${hostname}.`)
    }
    return { ok: true, url }
  }

  let addresses: UrlLookupAddress[]
  try {
    addresses = await deps.lookup(hostname)
  } catch {
    return { ok: false, reason: 'dns', message: `Não foi possível resolver o host ${hostname}.` }
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { ok: false, reason: 'dns', message: `Host sem endereço resolvível: ${hostname}.` }
  }
  for (const entry of addresses) {
    if (!entry || typeof entry.address !== 'string') {
      return { ok: false, reason: 'dns', message: `Resposta de DNS inválida para ${hostname}.` }
    }
    if (isPrivateAddress(entry.address, deps.isIP)) {
      return privateError(`Host ${hostname} resolve para endereço privado (${entry.address}).`)
    }
  }
  return { ok: true, url }
}
