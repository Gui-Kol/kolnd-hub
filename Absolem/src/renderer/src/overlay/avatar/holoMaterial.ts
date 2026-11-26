import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'
import type { IUniform } from 'three'

/**
 * Material de holograma: fresnel na borda, scanlines animadas, ruído leve e
 * blending aditivo. `depthWrite: false` evita que as camadas do corpo se
 * escondam entre si; o brilho vem da soma, não de uma superfície plástica.
 *
 * O tempo é um uniform em segundos reais, alimentado pelo loop. Em
 * `prefers-reduced-motion` a cena congela `uTime`, o que para scanlines e
 * ruído sem precisar de outro shader.
 */
export interface HoloMaterialOptions {
  color?: string
  /** 0 desliga qualquer contribuição do shader (alpha 0). */
  intensity?: number
  /** Hz aproximado da varredura vertical; manter abaixo de 3 Hz. */
  scanlineSpeed?: number
  /** 0..1 de ruído; a degradação da T7 zera este valor. */
  noise?: number
  fresnelPower?: number
}

export interface HoloAlphaInput {
  intensity: number
  fresnel: number
  scanline: number
  noise: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Espelho puro da composição de alpha do shader. Mantém o teste em Node sem
 * GPU e documenta a fórmula usada no GLSL.
 */
export function computeHoloAlpha(input: HoloAlphaInput): number {
  const base =
    0.22 +
    clamp01(input.fresnel) * 0.62 +
    clamp01(input.scanline) * 0.16 +
    clamp01(input.noise) * 0.22
  return clamp01(clamp01(input.intensity) * base)
}

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewPosition = -mvPosition.xyz;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uNoise;
  uniform float uScanlineSpeed;
  uniform float uFresnelPower;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), uFresnelPower);
    float scanline = 0.5 + 0.5 * sin(vWorldPosition.y * 34.0 - uTime * uScanlineSpeed);
    float noise = hash(floor(vWorldPosition.xy * 150.0) + floor(uTime * 24.0)) * uNoise;
    float alpha = (0.22 + fresnel * 0.62 + scanline * 0.16 + noise * 0.22) * uIntensity;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uColor * (0.65 + fresnel * 0.7 + scanline * 0.25), clamp(alpha, 0.0, 1.0));
  }
`

export function createHoloMaterial(options: HoloMaterialOptions = {}): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uColor: { value: new Color(options.color ?? '#3b82f6') },
    uIntensity: { value: clamp01(options.intensity ?? 1) },
    uNoise: { value: clamp01(options.noise ?? 0.35) },
    uScanlineSpeed: { value: Math.max(0, options.scanlineSpeed ?? 1.6) },
    uFresnelPower: { value: Math.max(0.5, options.fresnelPower ?? 2.2) }
  }

  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide
  })
}
