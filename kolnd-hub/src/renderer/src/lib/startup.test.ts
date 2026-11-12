import { describe, it, expect } from 'vitest'
import { executableName, matchesProcess, classifyImportance } from './startup'
import type { AppConfig, SystemProcess, StartupItem } from '../types'

const baseApp: AppConfig = {
  id: 'app-x',
  name: 'App X',
  description: 'test',
  icon: '📦',
  color: '#000000',
  gradient: 'from-black to-black',
  command: '',
  cwd: '%USERPROFILE%',
  category: 'dev',
  tags: []
}

const proc = (name: string, path = ''): SystemProcess => ({ name, id: 1, path })

describe('executableName', () => {
  it('extrai o executável de comandos simples', () => {
    expect(executableName('MarkLVI.exe')).toBe('marklvi')
    expect(executableName('code.exe')).toBe('code')
  })

  it('extrai de caminhos com aspas e remove a extensão', () => {
    expect(executableName('"C:\\Program Files\\App\\app.exe"')).toBe('app')
    expect(executableName('"%ProgramFiles%\\KLOUD_GAMES\\KLOUD_GAMES.exe" /arg')).toBe(
      'kloud_games'
    )
  })

  it('extrai de caminhos sem aspas', () => {
    expect(executableName('C:\\Tools\\tool.cmd --flag')).toBe('tool')
  })

  it('retorna vazio para comando vazio', () => {
    expect(executableName('')).toBe('')
    expect(executableName('   ')).toBe('')
  })
})

describe('matchesProcess', () => {
  const app = { ...baseApp, command: '"C:\\Program Files\\App\\App.exe"' }

  it('casa por nome do processo', () => {
    expect(matchesProcess(app, proc('app.exe'))).toBe(true)
    expect(matchesProcess(app, proc('APP.EXE'))).toBe(true)
  })

  it('casa por caminho do processo', () => {
    expect(matchesProcess(app, proc('other.exe', 'C:\\Program Files\\App\\app.exe'))).toBe(true)
  })

  it('não casa processos diferentes', () => {
    expect(matchesProcess(app, proc('notepad.exe'))).toBe(false)
    expect(matchesProcess(app, proc('appx.exe'))).toBe(false)
  })

  it('não casa quando o comando não resolve um executável', () => {
    expect(matchesProcess({ ...baseApp, command: '' }, proc('app.exe'))).toBe(false)
  })
})

describe('classifyImportance', () => {
  const item = (name: string, path = ''): StartupItem => ({
    id: name,
    name,
    path,
    location: 'registro',
    scope: 'usuario'
  })

  it('marca drivers/segurança como crítico', () => {
    expect(classifyImportance(item('Windows Defender Firewall'))).toBe('critico')
    expect(classifyImportance(item('Realtek Audio', 'C:\\drivers\\rtk.exe'))).toBe('critico')
  })

  it('marca apps de chat como recomendado', () => {
    expect(classifyImportance(item('Discord Updater'))).toBe('recomendado')
    expect(classifyImportance(item('Steam Client', 'C:\\Steam\\steam.exe'))).toBe('recomendado')
  })

  it('marca bloatware como inútil', () => {
    expect(classifyImportance(item('QuickTime Task'))).toBe('inutil')
  })

  it('cai em opcional para o desconhecido', () => {
    expect(classifyImportance(item('Totally Unknown App'))).toBe('opcional')
  })
})
