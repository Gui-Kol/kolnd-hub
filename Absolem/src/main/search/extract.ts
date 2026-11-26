import { parseHTML } from 'linkedom'

/**
 * Extração de conteúdo legível de uma página (task 10, T1).
 *
 * O parser é o `linkedom` (única dependência nova aprovada no gate): DOM leve,
 * sem binário nativo e sem canvas. A extração:
 * - remove `script`, `style`, `noscript`, `svg`, `iframe` e `form` ANTES de
 *   ler texto: conteúdo executável e formulário nunca viram contexto do modelo;
 * - prefere `article`, `main` e `[role=main]` (nessa ordem) e cai para `body`;
 * - preserva títulos e parágrafos como blocos separados por linha em branco;
 * - normaliza espaços e corta em 8.000 caracteres com marcador explícito.
 *
 * Nada aqui toca rede, disco ou Electron; o teste usa fixtures locais.
 */

export const MAX_EXTRACT_CHARS = 8_000

export const TRUNCATION_MARKER = '\n\n[... conteúdo truncado em 8.000 caracteres]'

const REMOVE_SELECTORS = ['script', 'style', 'noscript', 'svg', 'iframe', 'form'] as const

const PREFERRED_SELECTORS = ['article', 'main', '[role="main"]'] as const

const BLOCK_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TD',
  'TH',
  'DT',
  'DD',
  'FIGCAPTION'
])

export interface ExtractedPage {
  /** Título do documento (ou do primeiro `h1`); vazio quando não existe. */
  title: string
  /** Texto legível, com blocos separados por linha em branco. */
  text: string
  /** `true` quando o texto foi cortado em `MAX_EXTRACT_CHARS`. */
  truncated: boolean
  /** Tamanho final de `text`, já com o marcador de truncamento. */
  chars: number
}

interface DomNode {
  tagName?: string
  textContent?: string | null
  children?: ArrayLike<DomNode>
  remove?: () => void
  querySelector?: (selector: string) => unknown
  querySelectorAll?: (selector: string) => ArrayLike<DomNode>
}

function normalizeInline(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

function normalizeBlock(value: string): string {
  return normalizeInline(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** Junta blocos sem duplicar o mesmo texto consecutivo. */
function joinBlocks(blocks: string[]): string {
  const unique: string[] = []
  for (const block of blocks) {
    if (!block) continue
    if (unique.length > 0 && unique[unique.length - 1] === block) continue
    unique.push(block)
  }
  return unique.join('\n\n')
}

function collectBlocks(root: DomNode | null): string[] {
  if (!root) return []
  const blocks: string[] = []
  const visit = (node: DomNode): void => {
    const children = node.children
    if (!children) return
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (!child) continue
      const tag = typeof child.tagName === 'string' ? child.tagName.toUpperCase() : ''
      if (BLOCK_TAGS.has(tag)) {
        // O bloco leva o texto inteiro (inclusive filhos); não desce de novo
        // para não duplicar parágrafo dentro de lista/citação.
        const text = normalizeBlock(child.textContent ?? '')
        if (text) blocks.push(text)
        continue
      }
      visit(child)
    }
  }
  visit(root)
  return blocks
}

function firstText(node: DomNode | null): string {
  if (!node) return ''
  return normalizeBlock(node.textContent ?? '')
}

function titleFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function extractReadable(html: string, url?: string): ExtractedPage {
  const source = typeof html === 'string' ? html : ''
  const { document } = parseHTML(source) as unknown as {
    document: DomNode & Record<string, unknown>
  }

  for (const selector of REMOVE_SELECTORS) {
    const nodes = document.querySelectorAll?.(selector)
    if (!nodes) continue
    for (let index = 0; index < nodes.length; index += 1) {
      nodes[index]?.remove?.()
    }
  }

  const documentTitle =
    typeof (document as { title?: unknown }).title === 'string'
      ? normalizeBlock(String((document as { title?: unknown }).title))
      : ''
  const firstHeading = firstText(document.querySelector?.('h1') as DomNode | null)

  let root: DomNode | null = null
  for (const selector of PREFERRED_SELECTORS) {
    const candidate = document.querySelector?.(selector) as DomNode | null
    if (candidate && firstText(candidate)) {
      root = candidate
      break
    }
  }
  if (!root) root = document.querySelector?.('body') as DomNode | null
  if (!root) root = document

  const blocks = collectBlocks(root)
  let text = blocks.length > 0 ? joinBlocks(blocks) : normalizeBlock(root.textContent ?? '')

  let truncated = false
  if (text.length > MAX_EXTRACT_CHARS) {
    const keep = Math.max(1, MAX_EXTRACT_CHARS - TRUNCATION_MARKER.length)
    text = `${text.slice(0, keep).trimEnd()}${TRUNCATION_MARKER}`
    truncated = true
  }

  const title = documentTitle || firstHeading || titleFromUrl(url)
  return { title, text, truncated, chars: text.length }
}
