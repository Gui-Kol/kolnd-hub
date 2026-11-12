Kloud Games — MSI oficial deste projeto
=====================================

Este diretório contém o instalador MSI oficial do Kloud Games **deste
repositório** (fork do Sunshine/LizardByte, com branding KLOUD_GAMES),
gerado a partir do código-fonte em `kloud-games/`.

O MSI é incluído no instalador do Kolnd Hub via extraResources
(`electron-builder.yml`). Na primeira execução, o Hub instala o MSI
silenciosamente via `msiexec /quiet /norestart` (o MSI instala em
`C:\Program Files\KLOUD_GAMES\` e registra o serviço KLOUD_GAMESsvc,
regras de firewall e autostart — ver scripts/KLOUD_GAMES-setup.ps1).

Build automatizado (tudo em um único comando, sem etapas manuais):

    build-installer.bat          (na raiz do repositório)

O .bat executa, em ordem:

  1. kolnd-hub\scripts\build-kloud-games.ps1
     - pré-requisitos: git, Node.js LTS, MSYS2 (C:\msys64), .NET SDK 8
       (instala via winget o que faltar)
     - correções de renomeação do snapshot (idempotente)
     - git submodules (clona os ausentes e seus submódulos aninhados,
       aplica scripts\patches\moonlight-stdatomic-guards.patch)
     - dependências MSYS2/ucrt64 (pacman --needed)
     - cmake + ninja (gcc/g++) e cpack -G WIX -> KLOUD_GAMES.msi
     - copia o MSI para cá
  2. npm run package (electron-builder) -> dist\Kolnd Hub Setup 1.0.0.exe

Pré-requisitos na máquina de build: git, Node.js LTS, ~2 GB de espaço em
cmake-build-windows/ na primeira vez, e acesso à internet (submódulos,
pacman, CPM).

Notas:
  - O build usa gcc/g++ (NÃO clang): o GCC 16 + headers libstdc++ funciona
    após a correção de stdatomic.h (patch incluído).
  - Para só reconstruir o MSI sem o instalador do Hub:
      powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-kloud-games.ps1
  - Ao abrir o Kloud Games pelo Hub, ele procura o KLOUD_GAMES.exe nesta
    pasta (e em Program Files). Se não encontrar, abre o MSI acima para
    instalação (UAC). Os caminhos detectados (exe/msi) são salvos em
    kloud-games.paths.json nesta pasta — arquivo gerado em runtime,
    ignorado pelo git, não edite manualmente.
