/**
 * Shell mínimo da fundação: identidade e versão. Nenhuma funcionalidade de
 * assistente (bandeja, overlay, avatar, voz, Gemini) existe nesta task.
 */
export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-surface-base text-ink-primary">
      <h1 className="text-4xl font-semibold tracking-wide">Absolem</h1>
      <p className="text-sm text-ink-secondary">Atualizado junto com o Kolnd Hub</p>
      <p className="max-w-sm text-center text-xs text-ink-tertiary">
        Fundação pronta. As funcionalidades do assistente entram nas próximas tasks.
      </p>
    </main>
  )
}
