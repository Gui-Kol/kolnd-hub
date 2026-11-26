import { app } from 'electron'

/**
 * Isolamento de `userData` para smoke/teste de runtime.
 *
 * Precisa ser o PRIMEIRO import do main: `crashReporting` roda no module scope
 * (crashReporter.start + logger) e, sem isso, escreveria no perfil real do
 * usuário. Com `ABSOLEM_TEST_USERDATA` definido, crash dumps, logs e
 * electron-store passam a viver no diretório temporário indicado. Sem a env
 * var, nenhum efeito: o caminho padrão do Electron é usado.
 */
const testUserData = process.env.ABSOLEM_TEST_USERDATA
if (testUserData) {
  app.setPath('userData', testUserData)
}
