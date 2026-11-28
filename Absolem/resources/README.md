# Recursos de empacotamento (buildResources)

Pasta `directories.buildResources` do electron-builder. Os arquivos aqui sao usados
no build e nao ficam empacotados dentro do `app.asar`, exceto o que for copiado
explicitamente por `extraResources`.

## Conteudo

- `icon.ico` - icone do app (`win.icon`; o Absolem nao tem instalador proprio — o
  binario e embarcado no Kolnd Hub). Entradas 256, 128, 64, 48, 32, 16.
- `icon.png` - 512x512, opcional (futuro Linux).
- `tray-icon.png` - icone da bandeja 32x32. Chega ao pacote como
  `<resources>/tray-icon.png` via `extraResources`; o main le com
  `nativeImage.createFromPath`.
- `tray-icon@2x.png` - icone da bandeja 64x64 (HiDPI), `<resources>/tray-icon@2x.png`.
- `CREDITS.md` - origem/licenca; obra propria, sem asset de terceiros.

## Geracao

Tudo e gerado por codigo proprio, sem baixar asset:

```powershell
node scripts/generate-icons.cjs
```

Ver `CREDITS.md`.
