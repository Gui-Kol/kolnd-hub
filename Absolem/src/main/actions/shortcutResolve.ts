/**
 * Resolução em lote de atalhos `.lnk` via PowerShell (task 29).
 *
 * O catálogo chamava `powershell -Command <script> path1 path2`, mas com
 * `-Command` os caminhos não chegam a `$args`: o script devolvia vazio e o cache
 * gravava 0 apps. Aqui o script e a lista de caminhos vão embutidos na própria
 * linha de comando e são transportados como base64 UTF-16LE
 * (`-EncodedCommand`), o formato aceito pelo PowerShell. Nada de texto do
 * modelo: os caminhos são fixos do Menu Iniciar.
 *
 * Funções puras (sem Electron) para poderem ser testadas isoladamente.
 */

/** Base64 (UTF-8) do JSON com os caminhos: evita aspas/quebras no script. */
function encodePathsJson(paths: string[]): string {
  return Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
}

/**
 * Monta o script que resolve cada `.lnk` para `{ path, target }` e devolve JSON
 * compacto. Os caminhos entram como JSON em base64, decodificado no PowerShell.
 */
export function buildShortcutResolveScript(paths: string[]): string {
  const encodedPaths = encodePathsJson(Array.isArray(paths) ? paths : [])
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPaths}'))`,
    '$paths=ConvertFrom-Json -InputObject $json',
    '$shell=New-Object -ComObject WScript.Shell',
    '$out=@()',
    'foreach ($p in @($paths)) {',
    '  try {',
    '    $s=$shell.CreateShortcut([string]$p)',
    '    if ($s.TargetPath) { $out += [pscustomobject]@{ path=[string]$p; target=$s.TargetPath } }',
    '  } catch {}',
    '}',
    'ConvertTo-Json -Compress -Depth 4 -InputObject @($out)'
  ].join('\n')
}

/** `-EncodedCommand` exige o script em UTF-16LE codificado em base64. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Limite prático da linha de comando do Windows é 32.767 caracteres. O catálogo
 * real tem >100 atalhos e o comando inteiro passa disso, então os caminhos são
 * divididos em lotes que cabem em `-EncodedCommand`. A margem cobre os
 * argumentos fixos (`-NoProfile -NonInteractive -EncodedCommand `).
 */
export const MAX_ENCODED_COMMAND_CHARS = 28_000

/**
 * Divide os caminhos em lotes cujo script codificado cabe na linha de comando.
 * Preserva a ordem e nunca devolve lote vazio (lista vazia -> `[]`).
 */
export function batchShortcutPaths(
  paths: string[],
  maxEncodedChars: number = MAX_ENCODED_COMMAND_CHARS
): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  for (const item of paths) {
    const candidate = [...current, item]
    const tooLong =
      current.length > 0 &&
      encodePowerShell(buildShortcutResolveScript(candidate)).length > maxEncodedChars
    if (tooLong) {
      batches.push(current)
      current = [item]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}
