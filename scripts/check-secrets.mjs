#!/usr/bin/env node
/**
 * Guard de vazamento de credenciais do Kolnd Hub.
 *
 * Uso: node scripts/check-secrets.mjs
 *
 * Verifica apenas arquivos RASTREADOS pelo git (git ls-files):
 *  1. caminhos proibidos (chaves, certificados, bancos de dados de usuário,
 *     diretórios de credenciais/crash);
 *  2. conteúdo de arquivos de texto < 1 MB em busca de chave do Google e de
 *     chave privada PEM.
 *
 * Nunca imprime o trecho sensível encontrado — apenas o caminho e o tipo.
 * Exit 0 quando limpo; exit 1 quando há achados ou erro de execução.
 *
 * Sem dependências externas (Node ESM).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const MAX_CONTENT_BYTES = 1024 * 1024

// --- Regras de caminho -------------------------------------------------------
// Basenames que nunca devem estar no índice do git.
const FORBIDDEN_BASENAMES = [
  { test: (name) => name === 'secrets.bin', label: 'segredo local (secrets.bin)' },
  { test: (name) => name === 'api_keys.json', label: 'chave de API (api_keys.json)' },
  {
    test: (name) => name.startsWith('.env') && !name.startsWith('.env.example'),
    label: 'arquivo de ambiente (.env)'
  },
  {
    test: (name) => /^client_secret.*\.json$/i.test(name),
    label: 'client secret (client_secret*.json)'
  },
  { test: (name) => /^token.*\.json$/i.test(name), label: 'token (token*.json)' },
  { test: (name) => /credentials.*\.json$/i.test(name), label: 'credencial (*credentials*.json)' },
  { test: (name) => /\.(pem|pfx|p12)$/i.test(name), label: 'certificado/chave (*.pem|*.pfx|*.p12)' },
  {
    // Apenas bancos de dados tipicos de dados de usuario (ex.: memory.sqlite).
    // Nao bloqueia .db/.sqlite genericos de fixture (ex.: kloud-games).
    test: (name) =>
      /^(memor(y|ies)|absolem|conversations?|chats?|history|messages?|users?|data|secrets?|credentials?|sessions?)([._-][\w.-]+)?\.(sqlite3?|db)$/i.test(
        name
      ),
    label: 'banco de dados de usuário (*.sqlite|*.sqlite3|*.db)'
  }
]

// Trechos de caminho que nunca devem estar no índice do git.
const FORBIDDEN_PATH_FRAGMENTS = [
  { fragment: 'config/certs/', label: 'diretório config/certs/' },
  { fragment: 'config/whatsapp_web/', label: 'diretório config/whatsapp_web/' },
  { fragment: 'crashpad/', label: 'diretório Crashpad/' },
  { fragment: 'local storage/', label: 'diretório Local Storage/' }
]

// Caminhos isentos da varredura de conteúdo: testes/fixtures contêm chaves
// falsas de propósito (ex.: redaction.test.ts).
const CONTENT_EXEMPT = [
  /(^|\/)(tests?|fixtures)\//i,
  /\.(test|spec)\.[^/]+$/i
]

const CONTENT_RULES = [
  { re: /AIza[0-9A-Za-z_-]{30,}/, label: 'chave do Google (padrão AIza…)' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'chave privada PEM' }
]

// --- Coleta de arquivos rastreados ------------------------------------------
function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return out.split('\0').filter(Boolean)
}

function basename(p) {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

function checkPath(tracked) {
  const findings = []
  for (const file of tracked) {
    const name = basename(file)
    const lower = file.toLowerCase()

    for (const rule of FORBIDDEN_BASENAMES) {
      if (rule.test(name)) {
        findings.push({ file, why: rule.label })
        break
      }
    }

    for (const rule of FORBIDDEN_PATH_FRAGMENTS) {
      if (lower.includes(rule.fragment)) {
        findings.push({ file, why: rule.label })
        break
      }
    }
  }
  return findings
}

function checkContent(tracked) {
  const findings = []
  let scanned = 0
  let skippedBinary = 0
  let skippedUnreadable = 0

  for (const file of tracked) {
    if (CONTENT_EXEMPT.some((re) => re.test(file))) continue

    let buf
    try {
      buf = readFileSync(file)
    } catch {
      // Deletado no worktree, mas ainda no índice: nada a varrer agora.
      skippedUnreadable++
      continue
    }

    if (buf.length >= MAX_CONTENT_BYTES) continue
    // Heurística de binário: byte NUL nos primeiros 8 KB.
    if (buf.subarray(0, 8192).includes(0)) {
      skippedBinary++
      continue
    }

    const text = buf.toString('utf8')
    scanned++

    for (const rule of CONTENT_RULES) {
      if (rule.re.test(text)) {
        findings.push({ file, why: rule.label })
        break
      }
    }
  }

  return { findings, scanned, skippedBinary, skippedUnreadable }
}

// --- Main --------------------------------------------------------------------
function main() {
  let tracked
  try {
    tracked = listTrackedFiles()
  } catch (err) {
    console.error('[check-secrets] Falha ao executar "git ls-files":', err.message)
    process.exit(1)
  }

  const pathFindings = checkPath(tracked)
  const content = checkContent(tracked)
  const findings = [...pathFindings, ...content.findings]

  if (findings.length > 0) {
    console.error('[check-secrets] FALHOU: credenciais ou dados pessoais rastreados pelo git.\n')
    for (const f of findings) {
      console.error(`  - ${f.file}  (${f.why})`)
    }
    console.error(
      '\nRemova do índice do git (ex.: git rm --cached <arquivo>), adicione a regra no .gitignore' +
        ' e, se a chave era real, revogue/rotacione no provedor (Google AI Studio).\n' +
        'Obs.: este guard não reescreve histórico; um segredo já publicado continua no passado do repo.'
    )
    process.exit(1)
  }

  console.log(
    `[check-secrets] OK: ${tracked.length} arquivos rastreados; ` +
      `${content.scanned} arquivos de texto varridos, ` +
      `${content.skippedBinary} binários ignorados. Nenhum segredo encontrado.`
  )
  process.exit(0)
}

main()
