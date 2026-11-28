# Creditos dos recursos de empacotamento

## Icones e arte

Todos os recursos visuais desta pasta sao obra propria do projeto Absolem, gerados
100% por codigo, sem asset de terceiros, sem download externo e sem uso de imagem
oficial ou de referencia.

- `icon.ico` - lagarta azul holografica, entradas 256, 128, 64, 48, 32, 16.
- `icon.png` - mesmo desenho em 512x512 (para uso futuro / Linux).
- `tray-icon.png` - icone da bandeja 32x32.
- `tray-icon@2x.png` - icone da bandeja 64x64 (HiDPI).

Gerados por `scripts/generate-icons.cjs` (Node builtins, sem dependencias novas).
Para regerar:

```powershell
node scripts/generate-icons.cjs
```

## Fontes

Nenhuma fonte empacotada. A UI usa a pilha de fontes do sistema.

## Licenca

Obra propria do projeto Absolem; distribuida sob a mesma licenca MIT do app
(ver `LICENSE` na raiz do pacote). Sem componentes de terceiros nestes arquivos.
