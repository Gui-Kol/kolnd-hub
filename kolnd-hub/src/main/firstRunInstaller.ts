import { BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'events'
import { checkDependencies, formatDependencyReport } from './dependencyChecker'
import { installPython, installKloudGames } from './silentInstaller'
import { deployPrograms, formatDeployReport } from './programsDeployer'
import { markFirstRunComplete } from './firstRun'

export interface FirstRunProgress {
  stepId: string
  status: 'running' | 'done' | 'error'
  progress: number
  message?: string
}

export type FirstRunLogLine = string

class FirstRunInstaller extends EventEmitter {
  private isInstalling = false
  private isCancelled = false
  private dependencyResult?: import('./dependencyChecker').DependencyCheckResult

  /** Inicia a instalação automática. Emite eventos para o renderer. */
  async install(): Promise<void> {
    if (this.isInstalling) return

    this.isInstalling = true
    this.isCancelled = false

    try {
      await this.runDependencyCheck()
      if (this.isCancelled) return this.abort()

      await this.runPythonInstall()
      if (this.isCancelled) return this.abort()

      await this.runKloudGamesInstall()
      if (this.isCancelled) return this.abort()

      await this.runProgramsSetup()
      if (this.isCancelled) return this.abort()

      await this.runStep('finalize', 'Finalizando instalação…', 1000)
      if (this.isCancelled) return this.abort()

      // Marca a primeira execução como concluída para que nas próximas
      // aberturas o app vá direto para o dashboard.
      markFirstRunComplete()
      this.emit('log', '[KolndHub] Marcador de primeira execução salvo.\n')

      this.emit('complete', { success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('complete', { success: false, error: message })
    } finally {
      this.isInstalling = false
      this.isCancelled = false
    }
  }

  /** Solicita cancelamento da instalação em andamento. */
  cancel(): void {
    this.isCancelled = true
  }

  /** Executa a verificação real de dependências e emite eventos/logs. */
  private async runDependencyCheck(): Promise<void> {
    this.emit('progress', {
      stepId: 'check',
      status: 'running',
      progress: 0,
      message: 'Verificando dependências do sistema…'
    })
    this.emit('log', '[check] Verificando dependências do sistema…\n')

    try {
      const result = await checkDependencies()
      this.dependencyResult = result
      const report = formatDependencyReport(result)
      this.emit('log', report + '\n')

      if (!result.allInstalled) {
        const missing: string[] = []
        if (!result.pythonInstalled) missing.push('Python')
        else if (!result.pipInstalled) missing.push('pip')

        this.emit('log', `[check] Faltam: ${missing.join(', ')}\n`)
        // Não interrompe o fluxo; as etapas seguintes tentarão instalar.
      } else {
        this.emit('log', '[check] Todas as dependências já estão instaladas.\n')
      }

      this.emit('progress', {
        stepId: 'check',
        status: 'done',
        progress: 100,
        message: 'Dependências verificadas'
      })
      this.emit('log', '[check] Concluído.\n')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('log', `[check] Erro ao verificar dependências: ${message}\n`)
      this.emit('progress', {
        stepId: 'check',
        status: 'error',
        progress: 0,
        message: `Erro: ${message}`
      })
      throw err
    }
  }

  /** Instala Python/pip silenciosamente se necessário. */
  private async runPythonInstall(): Promise<void> {
    const alreadyInstalled = this.dependencyResult?.pythonInstalled && this.dependencyResult?.pipInstalled

    this.emit('progress', {
      stepId: 'python',
      status: 'running',
      progress: 0,
      message: alreadyInstalled ? 'Python já instalado' : 'Instalando Python 3.x e pip…'
    })

    if (alreadyInstalled) {
      this.emit('log', '[python] Python e pip já estão instalados. Pulando.\n')
      this.emit('progress', {
        stepId: 'python',
        status: 'done',
        progress: 100,
        message: 'Python já instalado'
      })
      return
    }

    this.emit('log', '[python] Instalando Python 3.x e pip…\n')
    const result = await installPython()

    if (result.success) {
      this.emit('log', '[python] Python instalado com sucesso.\n')
      this.emit('progress', {
        stepId: 'python',
        status: 'done',
        progress: 100,
        message: 'Python instalado'
      })
    } else {
      const error = result.error ?? 'Erro desconhecido ao instalar Python'
      this.emit('log', `[python] Falha: ${error}\n`)
      this.emit('progress', {
        stepId: 'python',
        status: 'error',
        progress: 0,
        message: error
      })
      throw new Error(error)
    }
  }

  /** Instala o Kloud Games a partir do MSI embutido. Falha não bloqueia a 1ª execução. */
  private async runKloudGamesInstall(): Promise<void> {
    this.emit('progress', {
      stepId: 'kloud-games',
      status: 'running',
      progress: 0,
      message: 'Instalando Kloud Games…'
    })
    this.emit('log', '[kloud-games] Verificando instalação do Kloud Games…\n')

    try {
      const result = await installKloudGames()

      if (result.success) {
        this.emit('log', '[kloud-games] Kloud Games instalado/disponível.\n')
        this.emit('progress', {
          stepId: 'kloud-games',
          status: 'done',
          progress: 100,
          message: 'Kloud Games instalado'
        })
        return
      }

      // Não fatal: o usuário pode instalar depois (o MSI fica embutido).
      const error = result.error ?? 'Erro desconhecido ao instalar Kloud Games'
      this.emit('log', `[kloud-games] Falha (não fatal): ${error}\n`)
      this.emit('progress', {
        stepId: 'kloud-games',
        status: 'error',
        progress: 0,
        message: error
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('log', `[kloud-games] Erro (não fatal): ${message}\n`)
      this.emit('progress', {
        stepId: 'kloud-games',
        status: 'error',
        progress: 0,
        message: `Erro: ${message}`
      })
    }
  }

  /** Verifica/implanta os programas do ecossistema na estrutura do Hub. */
  private async runProgramsSetup(): Promise<void> {
    this.emit('progress', {
      stepId: 'programs',
      status: 'running',
      progress: 0,
      message: 'Configurando programas do ecossistema…'
    })
    this.emit('log', '[programs] Verificando programas do ecossistema…\n')

    try {
      const results = await deployPrograms()
      const report = formatDeployReport(results)
      this.emit('log', report + '\n')

      const installed = results.filter((r) => r.installed).length
      if (installed === 0) {
        const error = 'Nenhum programa pôde ser implantado/verificado.'
        this.emit('log', `[programs] ${error}\n`)
        this.emit('progress', {
          stepId: 'programs',
          status: 'error',
          progress: 0,
          message: error
        })
        throw new Error(error)
      }

      if (installed < results.length) {
        const missing = results.filter((r) => !r.installed).map((r) => r.name).join(', ')
        this.emit('log', `[programs] Aviso: ${missing} não puderam ser configurados. Veja os detalhes acima.\n`)
      }

      this.emit('progress', {
        stepId: 'programs',
        status: 'done',
        progress: 100,
        message: 'Programas configurados'
      })
      this.emit('log', '[programs] Concluído.\n')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('progress', {
        stepId: 'programs',
        status: 'error',
        progress: 0,
        message: `Erro: ${message}`
      })
      throw err
    }
  }

  private async runStep(
    stepId: string,
    label: string,
    durationMs: number
  ): Promise<void> {
    this.emit('progress', { stepId, status: 'running', progress: 0, message: label })
    this.emit('log', `[${stepId}] Iniciando: ${label}\n`)

    // Simula progresso incremental dentro da etapa.
    const ticks = 5
    for (let i = 1; i <= ticks; i++) {
      if (this.isCancelled) break
      await new Promise<void>((resolve) => setTimeout(resolve, durationMs / ticks))
      this.emit('progress', {
        stepId,
        status: 'running',
        progress: Math.round((i / ticks) * 100),
        message: label
      })
    }

    if (this.isCancelled) {
      this.emit('progress', { stepId, status: 'error', progress: 0, message: 'Cancelado pelo usuário' })
      this.emit('log', `[${stepId}] Cancelado pelo usuário.\n`)
      return
    }

    this.emit('progress', { stepId, status: 'done', progress: 100, message: label })
    this.emit('log', `[${stepId}] Concluído.\n`)
  }

  private abort(): void {
    this.emit('log', '\n[KolndHub] Instalação cancelada pelo usuário.\n')
    this.emit('complete', { success: false, error: 'Instalação cancelada pelo usuário.' })
  }
}

export const firstRunInstaller = new FirstRunInstaller()

/** Registra os canais IPC usados pela tela de primeira execução. */
export function registerFirstRunIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('firstRun:start', async () => {
    // Roda a instalação de forma assíncrona e retorna imediatamente.
    firstRunInstaller.install().catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      getWindow()?.webContents.send('firstRun:log', `[KolndHub] Erro inesperado: ${message}\n`)
      getWindow()?.webContents.send('firstRun:complete', { success: false, error: message })
    })
    return { success: true }
  })

  ipcMain.handle('firstRun:cancel', () => {
    firstRunInstaller.cancel()
    return { success: true }
  })

  // Reencaminha eventos do instalador para o renderer.
  firstRunInstaller.on('progress', (data: FirstRunProgress) => {
    getWindow()?.webContents.send('firstRun:progress', data)
  })

  firstRunInstaller.on('log', (line: FirstRunLogLine) => {
    getWindow()?.webContents.send('firstRun:log', line)
  })

  firstRunInstaller.on('complete', (result: { success: boolean; error?: string }) => {
    getWindow()?.webContents.send('firstRun:complete', result)
  })
}
