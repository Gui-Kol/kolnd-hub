#!/usr/bin/env node
// summarize.mjs -- consolida os JSONs de medicao de out/perf/ em uma tabela.
//
// Por que existe: o baseline roda cada cenario 3x e a comparacao antes/depois
// precisa de mediana, nao de "o numero da ultima execucao". Sem dependencias:
// `node scripts/perf/summarize.mjs`.
//
// Uso:
//   node scripts/perf/summarize.mjs [--dir out/perf]
//
// Le apenas arquivos gerados pelos specs perf-*.spec.ts (kind=scenario|frames|
// startup|b7-startup-with-hud). Nao calcula nada que nao esteja no JSON.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const dirIndex = args.indexOf('--dir')
const dir = resolve(dirIndex >= 0 ? args[dirIndex + 1] : 'out/perf')

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function range(values, decimals = 2) {
  if (values.length === 0) return '-'
  const min = Math.min(...values)
  const max = Math.max(...values)
  return `${round(min, decimals)}..${round(max, decimals)}`
}

function loadFiles() {
  let names = []
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    console.error(`[summarize] diretorio inexistente: ${dir}`)
    process.exit(1)
  }
  const items = []
  for (const name of names) {
    try {
      const payload = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (payload && typeof payload.kind === 'string') items.push({ name, payload })
    } catch {
      // JSON parcial (execucao interrompida): ignora sem derrubar o resumo.
    }
  }
  return items
}

const items = loadFiles()
const scenarios = new Map()
const startups = []
const frames = []
const b7 = []

for (const { payload } of items) {
  if (payload.kind === 'scenario') {
    const list = scenarios.get(payload.label) ?? []
    list.push(payload)
    scenarios.set(payload.label, list)
  } else if (payload.kind === 'startup') {
    startups.push(payload)
  } else if (payload.kind === 'frames') {
    // Janela oclusa faz o Chromium throttle rAF para ~1 Hz: amostra invalida,
    // nao regressao. O spec repete; aqui so entram tentativas com frames reais.
    if (Number(payload.stats?.frames ?? 0) >= 300) frames.push(payload)
  } else if (payload.kind === 'b7-startup-with-hud') {
    b7.push(payload)
  }
}

console.log(`# Medicoes em ${dir}`)
console.log('')

if (scenarios.size > 0) {
  console.log(
    '| cenario | runs | CPU media %1 nucleo (mediana/min..max) | CPU %maquina | RAM WS MB | RAM privada MB | spawns/min | carga da maquina % |'
  )
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const label of [...scenarios.keys()].sort()) {
    // B5 mede winget, nao CPU/RAM: tabela propria abaixo.
    if (label.startsWith('b5')) continue
    const runs = scenarios.get(label).sort((a, b) => String(a.measuredAt).localeCompare(String(b.measuredAt)))
    const cpu = runs.map((run) => Number(run.cpu?.avgCpuPercent ?? 0))
    const machine = runs.map((run) => Number(run.cpu?.avgCpuPercentOfMachine ?? 0))
    const ws = runs.map((run) => Number(run.cpu?.avgWorkingSetMb ?? 0))
    const priv = runs.map((run) => Number(run.cpu?.avgPrivateMb ?? 0))
    const perMinute = runs.map((run) => Number(run.spawns?.perMinute ?? 0))
    // Runs antigas nao tinham carga instrumentada: ausencia != 0%.
    const system = runs
      .map((run) => Number(run.cpu?.systemCpuPercent ?? NaN))
      .filter((value) => Number.isFinite(value))
    const systemCell = system.length > 0 ? `${round(median(system))} (${range(system)})` : 'n/d'
    console.log(
      `| ${label} | ${runs.length} | ${round(median(cpu))} (${range(cpu)}) | ${round(median(machine))} | ${round(median(ws))} | ${round(median(priv))} | ${round(median(perMinute))} | ${systemCell} |`
    )
  }
  console.log('')

  const b5 = scenarios.get('b5-updates') ?? []
  if (b5.length > 0) {
    console.log('### B5 -- invocacoes de winget')
    console.log('')
    console.log('| execucao | 1a ativacao | 2a ativacao |')
    console.log('| --- | --- | --- |')
    for (const run of b5.sort((a, b) => String(a.measuredAt).localeCompare(String(b.measuredAt)))) {
      console.log(
        `| ${run.measuredAt} | ${run.wingetFirstActivationDelta ?? '-'} | ${run.wingetSecondActivationDelta ?? '-'} |`
      )
    }
    console.log('')
  }
}

if (startups.length > 0) {
  const runs = startups.flatMap((payload) => payload.runs ?? [])
  console.log('## Abertura (T3)')
  console.log('')
  console.log('| execucao | FCP ms | first paint | DOMContentLoaded | load | parede ate heading |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const run of runs) {
    console.log(
      `| - | ${round(run.fcpMs ?? 0)} | ${round(run.firstPaintMs ?? 0)} | ${round(run.domContentLoadedMs ?? 0)} | ${round(run.loadEventEndMs ?? 0)} | ${round(run.wallClockToHeadingMs ?? 0)} |`
    )
  }
  const fcps = runs.map((run) => Number(run.fcpMs ?? 0))
  console.log('')
  console.log(`FCP mediana: ${round(median(fcps))} ms (min..max ${range(fcps)})`)
  console.log('')
}

if (b7.length > 0) {
  console.log('## B7 (abertura com HUD)')
  console.log('')
  console.log('| execucao | FCP ms | primeiro hud:update ms | spawns 10 s |')
  console.log('| --- | --- | --- | --- |')
  for (const payload of b7) {
    console.log(
      `| ${payload.measuredAt} | ${round(payload.startup?.fcpMs ?? 0)} | ${round(payload.firstHudUpdateMsSinceLaunch ?? 0)} | ${payload.spawnsFirst10s?.total ?? 0} |`
    )
  }
  console.log('')
}

if (frames.length > 0) {
  console.log('## Frames')
  console.log('')
  console.log('| cenario | runs | p50 ms | p95 ms | max ms | gaps >100 ms | long tasks | carga % |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
  const byLabel = new Map()
  for (const payload of frames) {
    const list = byLabel.get(payload.label) ?? []
    list.push(payload)
    byLabel.set(payload.label, list)
  }
  for (const label of [...byLabel.keys()].sort()) {
    const entries = byLabel.get(label)
    const stats = entries.map((entry) => entry.stats ?? {})
    const pick = (key) => stats.map((entry) => Number(entry[key] ?? 0))
    const system = entries
      .map((entry) => Number(entry.systemCpuPercent ?? NaN))
      .filter((value) => Number.isFinite(value))
    const loadCell = system.length > 0 ? round(median(system)) : 'n/d'
    console.log(
      `| ${label} | ${stats.length} | ${round(median(pick('p50GapMs')))} | ${round(median(pick('p95GapMs')))} | ${round(median(pick('maxGapMs')))} | ${Math.max(...pick('gapsOver100ms'))} | ${Math.max(...pick('longTasks'))} | ${loadCell} |`
    )
  }
  console.log('')
}
