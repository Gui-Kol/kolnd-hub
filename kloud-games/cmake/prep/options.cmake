# Publisher Metadata
set(KLOUD_GAMES_PUBLISHER_NAME "Third Party Publisher"
        CACHE STRING "The name of the publisher (not developer) of the application.")
set(KLOUD_GAMES_PUBLISHER_WEBSITE ""
        CACHE STRING "The URL of the publisher's website.")
set(KLOUD_GAMES_PUBLISHER_ISSUE_URL "https://app.lizardbyte.dev/support"
        CACHE STRING "The URL of the publisher's support site or issue tracker.
        If you provide a modified version of KLOUD_GAMES, we kindly request that you use your own url.")

option(BUILD_DOCS "Build documentation" ON)
option(BUILD_TESTS "Build tests" ON)
option(NPM_OFFLINE "Use offline npm packages. You must ensure packages are in your npm cache." OFF)

option(BUILD_WERROR "Enable -Werror flag." OFF)

# if this option is set, the build will exit after configuring special package configuration files
option(KLOUD_GAMES_CONFIGURE_ONLY "Configure special files only, then exit." OFF)

option(KLOUD_GAMES_ENABLE_TRAY "Enable system tray icon." ON)

if(WIN32)
    option(KLOUD_GAMES_USE_STATIC_QT
            "Require static Qt libraries and their static third-party dependencies." ON)
endif()

option(KLOUD_GAMES_SYSTEM_VULKAN_HEADERS "Use system Vulkan headers instead of the build-deps pin." OFF)
option(KLOUD_GAMES_SYSTEM_WAYLAND_PROTOCOLS "Use system Wayland protocols instead of the CPM package." OFF)

option(BOOST_USE_STATIC "Use static boost libraries." ON)

option(CUDA_FAIL_ON_MISSING "Fail the build if CUDA is not found." ON)
option(CUDA_INHERIT_COMPILE_OPTIONS
        "When building CUDA code, inherit compile options from the the main project. You may want to disable this if
        your IDE throws errors about unknown flags after running cmake." ON)

if(UNIX)
    option(KLOUD_GAMES_BUILD_HOMEBREW
            "Enable a Homebrew build." OFF)
    option(KLOUD_GAMES_CONFIGURE_HOMEBREW
            "Configure Homebrew formula. Recommended to use with KLOUD_GAMES_CONFIGURE_ONLY" OFF)
endif()

if(APPLE)
    option(KLOUD_GAMES_CONFIGURE_PORTFILE
            "Configure macOS Portfile. Recommended to use with KLOUD_GAMES_CONFIGURE_ONLY" OFF)
elseif(UNIX)  # Linux
    option(KLOUD_GAMES_BUILD_APPIMAGE
            "Enable an AppImage build." OFF)
    option(KLOUD_GAMES_BUILD_FLATPAK
            "Enable a Flatpak build." OFF)
    option(KLOUD_GAMES_CONFIGURE_PKGBUILD
            "Configure files required for AUR. Recommended to use with KLOUD_GAMES_CONFIGURE_ONLY" OFF)
    option(KLOUD_GAMES_CONFIGURE_APKBUILD
            "Configure files required for an Alpine Linux package. Recommended to use with KLOUD_GAMES_CONFIGURE_ONLY" OFF)
    option(KLOUD_GAMES_CONFIGURE_FLATPAK_MAN
            "Configure manifest file required for Flatpak build. Recommended to use with KLOUD_GAMES_CONFIGURE_ONLY" OFF)

    # Linux capture methods
    option(KLOUD_GAMES_ENABLE_CUDA
            "Enable cuda specific code." ON)
    option(KLOUD_GAMES_ENABLE_DRM
            "Enable KMS grab if available." ON)
    option(KLOUD_GAMES_ENABLE_VAAPI
            "Enable building vaapi specific code." ON)
    option(KLOUD_GAMES_ENABLE_VULKAN
            "Enable Vulkan video encoding." ON)
    option(KLOUD_GAMES_ENABLE_WAYLAND
            "Enable building wayland specific code." ON)
    option(KLOUD_GAMES_ENABLE_X11
            "Enable X11 grab if available." ON)
    option(KLOUD_GAMES_ENABLE_KWIN
            "Enable KWin ScreenCast grab if available" ON)
    option(KLOUD_GAMES_ENABLE_PORTAL
            "Enable XDG portal grab if available" ON)
endif()
