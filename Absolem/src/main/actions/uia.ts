import type { PermissionDecision } from '../../shared/permissions'

/**
 * UIAutomation atrás de gate (task 08, T9).
 *
 * `uia.control` nasce `deny`; sem `allow` nenhum script roda. A árvore é lida
 * da janela em primeiro plano via PowerShell (`UIAutomationClient`) com
 * profundidade/limite/timeout e devolve uma árvore parcial em timeout.
 * `invokeElement` só aceita `name` + `role` EXATOS (nunca coordenada), recusa
 * campo `IsPassword` e limita a 1 ação por 2 s.
 *
 * O script é uma string embutida; não há arquivo no repo nem dependência npm.
 */

export const UIA_ROLES = [
  'button',
  'edit',
  'text',
  'window',
  'checkbox',
  'combobox',
  'list',
  'list_item',
  'menu',
  'menu_item',
  'pane',
  'link',
  'image',
  'tab',
  'tab_item',
  'radio',
  'slider',
  'tree',
  'tree_item',
  'other'
] as const

export type UiRole = (typeof UIA_ROLES)[number]

export const UIA_MAX_NODES = 500
export const UIA_TREE_TIMEOUT_MS = 10_000
export const UIA_INVOKE_TIMEOUT_MS = 5_000
export const UIA_MIN_INVOKE_INTERVAL_MS = 2_000

const CONTROL_TYPE_ROLES: Record<string, UiRole> = {
  Button: 'button',
  Edit: 'edit',
  Text: 'text',
  Window: 'window',
  CheckBox: 'checkbox',
  ComboBox: 'combobox',
  List: 'list',
  ListItem: 'list_item',
  Menu: 'menu',
  MenuItem: 'menu_item',
  Pane: 'pane',
  Hyperlink: 'link',
  Image: 'image',
  Tab: 'tab',
  TabItem: 'tab_item',
  RadioButton: 'radio',
  Slider: 'slider',
  Tree: 'tree',
  TreeItem: 'tree_item'
}

export interface UiBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface UiNode {
  name: string
  role: UiRole
  controlType: string
  enabled: boolean
  isPassword: boolean
  bounds?: UiBounds
  children: UiNode[]
}

export interface ScriptRunResult {
  stdout: string
  timedOut: boolean
}

export interface UiAutomationDeps {
  runScript: (script: string, args: string[], timeoutMs: number) => Promise<ScriptRunResult>
  getPermission: () => PermissionDecision
  now?: () => number
}

export type UiFailureCode = 'denied' | 'failed' | 'timeout' | 'password' | 'rate' | 'invalid'

export type UiTreeResult =
  | { ok: true; nodes: UiNode[]; partial: boolean; nodeCount: number }
  | { ok: false; code: UiFailureCode; error: string }

export type UiInvokeResult =
  { ok: true; role: UiRole; name: string } | { ok: false; code: UiFailureCode; error: string }

export interface UiAutomation {
  getUiTree: (input?: { maxNodes?: number }) => Promise<UiTreeResult>
  invokeElement: (input: {
    name: string
    role: UiRole
    windowTitle?: string
  }) => Promise<UiInvokeResult>
}

export function mapControlType(controlType: string): UiRole {
  return CONTROL_TYPE_ROLES[controlType] ?? 'other'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseBounds(value: unknown): UiBounds | undefined {
  if (!isRecord(value)) return undefined
  const { x, y, width, height } = value
  if (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof width === 'number' &&
    typeof height === 'number'
  ) {
    return { x, y, width, height }
  }
  return undefined
}

function normalizeNode(raw: unknown, budget: { left: number }): UiNode | null {
  if (budget.left <= 0 || !isRecord(raw)) return null
  budget.left -= 1
  const controlType = typeof raw.controlType === 'string' ? raw.controlType : 'Unknown'
  const isPassword = raw.isPassword === true
  const node: UiNode = {
    name: isPassword ? '' : typeof raw.name === 'string' ? raw.name.slice(0, 500) : '',
    role: mapControlType(controlType),
    controlType: controlType.slice(0, 100),
    enabled: raw.enabled === true,
    isPassword,
    children: []
  }
  const bounds = parseBounds(raw.bounds)
  if (bounds) node.bounds = bounds
  if (Array.isArray(raw.children)) {
    for (const child of raw.children) {
      const normalized = normalizeNode(child, budget)
      if (!normalized) break
      node.children.push(normalized)
    }
  }
  return node
}

function parseJsonObject(stdout: string): Record<string, unknown> | null {
  const match = /\{[\s\S]*\}/.exec(stdout)
  if (!match) return null
  try {
    const parsed: unknown = JSON.parse(match[0])
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const TREE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName UIAutomationClient',
  'Add-Type -AssemblyName UIAutomationTypes',
  '$limit=[int]$args[0]',
  '$deadline=(Get-Date).AddSeconds(8)',
  '$count=0',
  '$partial=$false',
  'function Convert-Node($el) {',
  '  if ($count -ge $limit) { $script:partial=$true; return $null }',
  '  if ((Get-Date) -gt $deadline) { $script:partial=$true; return $null }',
  '  $script:count++',
  '  $c=$el.Current',
  '  $r=$c.BoundingRectangle',
  '  $node=[ordered]@{',
  '    controlType=$c.ControlType.ProgrammaticName.Replace("ControlType.","")',
  '    name=$c.Name',
  '    enabled=$c.IsEnabled',
  '    isPassword=$c.IsPassword',
  '    bounds=@{x=[int]$r.X;y=[int]$r.Y;width=[int]$r.Width;height=[int]$r.Height}',
  '    children=@()',
  '  }',
  '  $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker',
  '  $child=$walker.GetFirstChild($el)',
  '  while ($child -ne $null) {',
  '    $converted=Convert-Node $child',
  '    if ($converted -ne $null) { $node.children += $converted }',
  '    if ($script:partial) { break }',
  '    $child=$walker.GetNextSibling($child)',
  '  }',
  '  return $node',
  '}',
  '$root=[System.Windows.Automation.AutomationElement]::FocusedElement',
  '$nodes=@()',
  'if ($root -ne $null) { $converted=Convert-Node $root; if ($converted -ne $null) { $nodes += $converted } }',
  'Write-Output (ConvertTo-Json -Compress -Depth 100 -InputObject @{nodes=$nodes;partial=$partial})'
].join('\n')

const INVOKE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName UIAutomationClient',
  'Add-Type -AssemblyName UIAutomationTypes',
  '$targetName=$args[0]',
  '$targetRole=$args[1]',
  '$windowTitle=$args[2]',
  '$deadline=(Get-Date).AddSeconds(4)',
  '$roleMap=@{button="Button";edit="Edit";text="Text";checkbox="CheckBox";combobox="ComboBox";list="List";list_item="ListItem";menu="Menu";menu_item="MenuItem";pane="Pane";link="Hyperlink";radio="RadioButton";slider="Slider";tree="Tree";tree_item="TreeItem";tab="Tab";tab_item="TabItem"}',
  'if (-not $roleMap.ContainsKey($targetRole)) { Write-Output \'{"ok":false,"reason":"invalid"}\'; exit 0 }',
  '$root=[System.Windows.Automation.AutomationElement]::FocusedElement',
  'if ($windowTitle -ne "") {',
  '  $desktop=[System.Windows.Automation.AutomationElement]::RootElement',
  '  $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$windowTitle)',
  '  $root=$desktop.FindFirst([System.Windows.Automation.TreeScope]::Children,$cond)',
  '}',
  'if ($root -eq $null) { Write-Output \'{"ok":false,"reason":"notfound"}\'; exit 0 }',
  '$condition=New-Object System.Windows.Automation.AndCondition(',
  '  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$targetName)),',
  '  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]$roleMap[$targetRole]))',
  ')',
  '$element=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)',
  'if ($element -eq $null) { Write-Output \'{"ok":false,"reason":"notfound"}\'; exit 0 }',
  'if ($element.Current.IsPassword) { Write-Output \'{"ok":false,"reason":"password"}\'; exit 0 }',
  'if (-not $element.Current.IsEnabled) { Write-Output \'{"ok":false,"reason":"disabled"}\'; exit 0 }',
  'if ((Get-Date) -gt $deadline) { Write-Output \'{"ok":false,"reason":"timeout"}\'; exit 0 }',
  'try {',
  '  $pattern=$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)',
  '  $pattern.Invoke()',
  '  Write-Output \'{"ok":true}\'',
  '} catch { Write-Output \'{"ok":false,"reason":"failed"}\' }'
].join('\n')

export function createUiAutomation(deps: UiAutomationDeps): UiAutomation {
  const now = deps.now ?? (() => Date.now())
  let lastInvokeAt: number | null = null

  async function getUiTree(input?: { maxNodes?: number }): Promise<UiTreeResult> {
    if (deps.getPermission() !== 'allow') {
      return {
        ok: false,
        code: 'denied',
        error: 'uia.control está desativado. Habilite com ciência do risco nas permissões.'
      }
    }
    const requested =
      typeof input?.maxNodes === 'number' ? Math.floor(input.maxNodes) : UIA_MAX_NODES
    const maxNodes = Math.min(UIA_MAX_NODES, Math.max(1, requested))
    let run: ScriptRunResult
    try {
      run = await deps.runScript(TREE_SCRIPT, [String(maxNodes)], UIA_TREE_TIMEOUT_MS)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, code: 'failed', error: `UIAutomation falhou: ${message}` }
    }
    const parsed = parseJsonObject(run.stdout)
    const rawNodes = parsed && Array.isArray(parsed.nodes) ? parsed.nodes : []
    const budget = { left: maxNodes }
    const nodes: UiNode[] = []
    for (const raw of rawNodes) {
      const node = normalizeNode(raw, budget)
      if (!node) break
      nodes.push(node)
    }
    if (!parsed) {
      return {
        ok: false,
        code: run.timedOut ? 'timeout' : 'failed',
        error: 'Resposta inválida do UIAutomation.'
      }
    }
    const partial = run.timedOut || parsed.partial === true || budget.left <= 0
    return { ok: true, nodes, partial, nodeCount: countNodes(nodes) }
  }

  async function invokeElement(input: {
    name: string
    role: UiRole
    windowTitle?: string
  }): Promise<UiInvokeResult> {
    if (deps.getPermission() !== 'allow') {
      return {
        ok: false,
        code: 'denied',
        error: 'uia.control está desativado. Habilite com ciência do risco nas permissões.'
      }
    }
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 500) {
      return { ok: false, code: 'invalid', error: 'Nome do elemento inválido.' }
    }
    if (!(UIA_ROLES as readonly string[]).includes(input.role)) {
      return { ok: false, code: 'invalid', error: 'Papel (role) inválido.' }
    }
    if (input.windowTitle !== undefined && typeof input.windowTitle !== 'string') {
      return { ok: false, code: 'invalid', error: 'Título de janela inválido.' }
    }
    const windowTitle = (input.windowTitle ?? '').slice(0, 200)

    const instant = now()
    if (lastInvokeAt !== null && instant - lastInvokeAt < UIA_MIN_INVOKE_INTERVAL_MS) {
      return { ok: false, code: 'rate', error: 'Aguarde 2 s entre ações de UIAutomation.' }
    }
    lastInvokeAt = instant

    let run: ScriptRunResult
    try {
      run = await deps.runScript(
        INVOKE_SCRIPT,
        [name, input.role, windowTitle],
        UIA_INVOKE_TIMEOUT_MS
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, code: 'failed', error: `UIAutomation falhou: ${message}` }
    }
    const parsed = parseJsonObject(run.stdout)
    if (!parsed) {
      return {
        ok: false,
        code: run.timedOut ? 'timeout' : 'failed',
        error: 'Resposta inválida do UIAutomation.'
      }
    }
    if (parsed.ok === true) return { ok: true, role: input.role, name }
    const reason = typeof parsed.reason === 'string' ? parsed.reason : 'failed'
    if (reason === 'password') {
      return { ok: false, code: 'password', error: 'Campo de senha não pode ser acionado.' }
    }
    if (reason === 'timeout') {
      return { ok: false, code: 'timeout', error: 'UIAutomation não respondeu a tempo.' }
    }
    return { ok: false, code: 'failed', error: `UIAutomation recusou a ação (${reason}).` }
  }

  return { getUiTree, invokeElement }
}

function countNodes(nodes: UiNode[]): number {
  let total = 0
  for (const node of nodes) total += 1 + countNodes(node.children)
  return total
}
