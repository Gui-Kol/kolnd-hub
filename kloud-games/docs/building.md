# Building
KLOUD_GAMES binaries are built using [CMake](https://cmake.org) and require `cmake` > 3.25.

> [!IMPORTANT]
> This fork supports **Windows only**. Builds must run on Windows with MSYS2 UCRT64 (AMD64) or
> MSYS2 CLANGARM64 (ARM64). The former Linux, macOS and FreeBSD build paths were removed.

## Building Locally

### Compiler
Use one of the following compilers from the MSYS2 toolchain:

| Compiler | Version |
|:---------|:--------|
| GCC      | 14+     |
| Clang    | 17+     |

### Dependencies

CMake fetches pinned source dependencies through CPM on the first configure. Initialize the remaining Git submodules
with `git submodule update --init --recursive` before configuring.

Boost `1.89.0` or newer can be supplied as a system package. When a compatible system package is unavailable, CMake
downloads the project-locked Boost release through CPM. Static Boost libraries are preferred on every platform by
default; pass `-DBOOST_USE_STATIC=OFF` to use shared system libraries instead.

KLOUD_GAMES's build automation uses packaged static Boost libraries with MSYS2 on Windows.

#### Web UI

The Web UI is built from source as part of the native build. CMake locates `npm` and runs `npm ci` followed by
`npm run build`; the production assets land under `<build dir>/assets/web` and are installed from there. There is no
prebuilt frontend package in this fork, so `node` and `npm` are build requirements (see below).

#### Windows

> [!WARNING]
> Cross-compilation is not supported on Windows. You must build on the target architecture.

First, you need to install [MSYS2](https://www.msys2.org).

For AMD64 startup "MSYS2 UCRT64" (or for ARM64 startup "MSYS2 CLANGARM64") then execute the following commands.

##### Update all packages
```bash
pacman -Syu
```

##### Set toolchain variable
For UCRT64:
```bash
export TOOLCHAIN="ucrt-x86_64"
```

For CLANGARM64:
```bash
export TOOLCHAIN="clang-aarch64"
```

##### Install dependencies
```bash
dependencies=(
  "git"
  "mingw-w64-${TOOLCHAIN}-boost"  # Optional
  "mingw-w64-${TOOLCHAIN}-cmake"
  "mingw-w64-${TOOLCHAIN}-cppwinrt"
  "mingw-w64-${TOOLCHAIN}-curl-winssl"
  "mingw-w64-${TOOLCHAIN}-doxygen"  # Optional, for docs
  "mingw-w64-${TOOLCHAIN}-graphviz"  # Optional, for docs
  "mingw-w64-${TOOLCHAIN}-miniupnpc"
  "mingw-w64-${TOOLCHAIN}-onevpl"
  "mingw-w64-${TOOLCHAIN}-openssl"
  "mingw-w64-${TOOLCHAIN}-opus"
  "mingw-w64-${TOOLCHAIN}-toolchain"
  "mingw-w64-${TOOLCHAIN}-qt6-static"
)
if [[ "${MSYSTEM}" == "UCRT64" ]]; then
  dependencies+=(
    "mingw-w64-${TOOLCHAIN}-MinHook"
    "mingw-w64-${TOOLCHAIN}-nsis"
  )
fi
pacman -S "${dependencies[@]}"
```

Static Qt is enabled by default on Windows. KLOUD_GAMES automatically adds the MSYS2 static Qt prefix at
`${MINGW_PREFIX}/qt6-static` when that package is installed. If an IDE does not inherit `MINGW_PREFIX`, KLOUD_GAMES
derives the same prefix from the selected compiler. If static Qt is installed in a custom location, specify it with
`-DCMAKE_PREFIX_PATH=/path/to/qt6-static`.

To use dynamic Qt instead, configure with `-DKLOUD_GAMES_USE_STATIC_QT=OFF` and ensure the dynamic Qt package is
available through the normal toolchain prefix.

To create a WiX installer, you also need to install [.NET](https://dotnet.microsoft.com/download).

To build the frontend, install native [Node.js](https://nodejs.org/en/download) for the target architecture. The
MSYS2 Node.js package is not supported because its shared runtime cannot load the native binding required by Rolldown.

`node` and `npm` must also be visible on `PATH` **inside the MSYS2 shell**, not only in PowerShell or cmd. The
configure step runs `find_program(NPM npm REQUIRED)` in `cmake/targets/common.cmake`; when `npm` is missing the
configure stops with:

```text
CMake Error at cmake/targets/common.cmake:34 (find_program):
  Could not find NPM using the following names: npm
```

Export the native Node.js directory before configuring when the MSYS2 shell does not inherit it:

```bash
export NODEJS_PATH="/c/Program Files/nodejs"
export PATH="$NODEJS_PATH:$PATH"
node --version && npm --version
```

`kolnd-hub/scripts/build-kloud-games.ps1` performs this export automatically from the Windows `PATH`.

### Clone
Ensure [git](https://git-scm.com) is installed on your system, then clone the repository using the following command:

```bash
git clone https://github.com/KLOUD_GAMESStream/KLOUD_GAMES.git --recurse-submodules
cd KLOUD_GAMES
```

### Build directories

Build directories are prefixed with `cmake-build-` (see `AGENTS.md`) so they are easy to tell apart from source
directories. Two profiles are kept side by side:

| Profile | Directory | Purpose | `CMAKE_BUILD_TYPE` | `BUILD_DOCS` | `BUILD_TESTS` |
|:--|:--|:--|:--|:--|:--|
| Development | `cmake-build-windows` | local work, debug symbols, tests | `RelWithDebInfo` | `ON` | `ON` |
| Production | `cmake-build-release` | MSI shipped inside Kolnd Hub | `Release` | `OFF` | `OFF` |

The production profile is what `kolnd-hub/scripts/build-kloud-games.ps1` and
`.github/workflows/build-kloud-games.yml` use. It does **not** produce `test_KLOUD_GAMES.exe`.

#### Development profile

```bash
cmake -B cmake-build-windows -G Ninja -S . -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DKLOUD_GAMES_ASSETS_DIR=assets -DBUILD_DOCS=ON -DBUILD_TESTS=ON
ninja -C cmake-build-windows
```

`BUILD_DOCS=ON` requires `doxygen` and `graphviz`. `BUILD_TESTS=ON` builds the test executable at
`cmake-build-windows/tests/test_KLOUD_GAMES.exe`.

#### Production profile

```bash
cmake -B cmake-build-release -G Ninja -S . -DBUILD_WERROR=OFF -DCMAKE_BUILD_TYPE=Release \
  -DKLOUD_GAMES_ASSETS_DIR=assets -DBUILD_DOCS=OFF -DBUILD_TESTS=OFF
ninja -C cmake-build-release
```

| Flag | Why |
|:--|:--|
| `-DCMAKE_BUILD_TYPE=Release` | optimized build without debug info; the packaged binaries are stripped too |
| `-DBUILD_DOCS=OFF` | skips doxygen/dockle; the installer does not need the generated docs |
| `-DBUILD_TESTS=OFF` | does not build `test_KLOUD_GAMES.exe`, which is several hundred MB in the dev profile |
| `-DBUILD_WERROR=OFF` | compiler warnings do not abort the release build |
| `-DKLOUD_GAMES_ASSETS_DIR=assets` | output root for the generated Web UI (`assets/web`), as consumed by Vite and the install rules |

> [!TIP]
> Available build options can be found in
> [options.cmake](https://github.com/KLOUD_GAMESStream/KLOUD_GAMES/blob/master/cmake/prep/options.cmake).

### Package

Run cpack inside the production build directory. `-C Release` selects the configuration; the profile is single-config,
but cpack needs the explicit value to find the binaries.

```bash
cd cmake-build-release
cpack -G WIX -C Release --config CPackConfig.cmake
```

The result is `cmake-build-release/cpack_artifacts/KLOUD_GAMES.msi` (about 53 MB). `build-kloud-games.ps1` copies it to
`kolnd-hub/resources/programs/kloud-games/KLOUD_GAMES.msi`. The WiX generator strips the packaged binaries
(`CPACK_STRIP_FILES=YES`); `dxgi-info.exe` is still the largest non-application payload at about 55 MB.

Alternative generators from the same build tree:

```bash
cpack -G NSIS -C Release --config CPackConfig.cmake   # NSIS installer
cpack -G ZIP  -C Release --config CPackConfig.cmake   # Portable archive
```

### Remote Build
It may be beneficial to build remotely in some cases. This will enable easier building on a clean Windows machine.

1. Fork the project
2. Activate workflows
3. Trigger the *Build KLOUD_GAMES* workflow (`.github/workflows/build-kloud-games.yml`) manually
4. Download the MSI from the workflow run summary
