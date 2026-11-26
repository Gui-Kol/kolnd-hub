/**
 * Casca do overlay do avatar (task 02).
 *
 * Nesta task existe apenas o marcador circular de 64 px no canto inferior
 * esquerdo; a lagarta holográfica é da task 03. O fundo é totalmente
 * transparente e o contêiner raiz usa `pointer-events: none`; só a área do
 * avatar recebe cliques. Ao entrar nela, o renderer pede ao main para parar de
 * ignorar o mouse (`overlay:set-interactive`), e ao sair pede de volta.
 */
function setInteractive(interactive: boolean): void {
  void window.absolem.overlaySetInteractive(interactive)
}

export function OverlayApp() {
  return (
    <div className="overlay-root">
      {/* A task 06 substitui o pointerdown por clique-para-falar. Por ora,
          reafirmar o estado interativo prova que o evento chegou ao overlay. */}
      <div
        className="overlay-avatar"
        role="img"
        aria-label="Avatar do Absolem"
        onPointerEnter={() => setInteractive(true)}
        onPointerLeave={() => setInteractive(false)}
        onPointerDown={() => setInteractive(true)}
      />
    </div>
  )
}
