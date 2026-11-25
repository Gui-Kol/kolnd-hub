# load common dependencies
# this file will also load platform specific dependencies

# Resolve OpenSSL before subprojects run their own find_package(OpenSSL) calls.
# This ensures a user-provided OPENSSL_ROOT_DIR is honored consistently.
find_package(OpenSSL REQUIRED)

# boost, this should be before Simple-Web-Server as it also depends on boost
include(dependencies/Boost_KLOUD_GAMES)

# moonlight common library
# KLOUD_GAMES builds only the ENet target and compiles selected Moonlight sources directly.
CPMAddPackage(NAME moonlight-common-c DOWNLOAD_ONLY YES)
set(ENET_NO_INSTALL ON CACHE BOOL "Don't install any libraries built for enet")
add_subdirectory("${moonlight-common-c_SOURCE_DIR}/enet" "${moonlight-common-c_BINARY_DIR}/enet")

# web server
CPMGetPackage(simple_web_server)

set(KLOUD_GAMES_DEPENDENCY_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/dependency-include")

# Forward each header in ARGN from source_dir into include_prefix to preserve qualified includes.
function(KLOUD_GAMES_forward_dependency_headers source_dir include_prefix)
    foreach(header IN LISTS ARGN)
        file(GENERATE
                OUTPUT "${KLOUD_GAMES_DEPENDENCY_INCLUDE_DIR}/${include_prefix}/${header}"
                CONTENT "#include \"${source_dir}/${header}\"\n")
    endforeach()
endfunction()

KLOUD_GAMES_forward_dependency_headers("${moonlight-common-c_SOURCE_DIR}/src" "moonlight-common-c/src"
        Input.h Limelight.h Limelight-internal.h Rtsp.h VideoFormats.h)
KLOUD_GAMES_forward_dependency_headers("${simple_web_server_SOURCE_DIR}" "Simple-Web-Server"
        client_http.hpp client_https.hpp crypto.hpp server_http.hpp server_https.hpp)

# lizardbyte common helpers
set(LIZARDBYTE_COMMON_BUILD_TEST_SUPPORT ${BUILD_TESTS}
        CACHE BOOL "Build lizardbyte-common GoogleTest support helpers" FORCE)
add_subdirectory("${CMAKE_SOURCE_DIR}/third-party/lizardbyte-common")

# libdisplaydevice
CPMGetPackage(libdisplaydevice)

if(KLOUD_GAMES_ENABLE_TRAY)
    if(KLOUD_GAMES_USE_STATIC_QT)
        set(_KLOUD_GAMES_find_library_suffixes "${CMAKE_FIND_LIBRARY_SUFFIXES}")
        set(_KLOUD_GAMES_import_library_suffix "${CMAKE_IMPORT_LIBRARY_SUFFIX}")
        set(_KLOUD_GAMES_pkg_config_argn "${PKG_CONFIG_ARGN}")
        set(_KLOUD_GAMES_disable_find_package_harfbuzz "${CMAKE_DISABLE_FIND_PACKAGE_harfbuzz}")
        set(CMAKE_FIND_LIBRARY_SUFFIXES ".a")
        set(CMAKE_IMPORT_LIBRARY_SUFFIX ".a")
        set(PKG_CONFIG_ARGN --static)

        # HarfBuzz's config-file target omits dependencies needed by its static archive.
        # Use Qt's pkg-config fallback so --static supplies the complete link interface.
        set(CMAKE_DISABLE_FIND_PACKAGE_harfbuzz TRUE)

        # CMake's FindTIFF module does not propagate dependencies of the static archive.
        # Provide its standard target from pkg-config before Qt imports the TIFF plugin.
        find_package(PkgConfig REQUIRED)
        pkg_check_modules(KLOUD_GAMES_STATIC_TIFF REQUIRED IMPORTED_TARGET libtiff-4)
        add_library(TIFF::TIFF INTERFACE IMPORTED)
        target_link_libraries(TIFF::TIFF INTERFACE PkgConfig::KLOUD_GAMES_STATIC_TIFF)

        set(_KLOUD_GAMES_module_path "${CMAKE_MODULE_PATH}")
        find_package(Qt6 REQUIRED COMPONENTS Widgets Svg)
        get_target_property(_KLOUD_GAMES_qt_core_type Qt6::Core TYPE)
        if(NOT _KLOUD_GAMES_qt_core_type STREQUAL "STATIC_LIBRARY")
            message(FATAL_ERROR "KLOUD_GAMES_USE_STATIC_QT requires a static Qt 6 installation.")
        endif()
        set(CMAKE_MODULE_PATH "${_KLOUD_GAMES_module_path}")
    endif()

    CPMGetPackage(tray)

    # TRAY_QT_VERSION is scoped to the tray subdirectory, so inspect the target's actual dependencies.
    get_target_property(_KLOUD_GAMES_tray_link_libraries tray LINK_LIBRARIES)
    if("Qt6::Widgets" IN_LIST _KLOUD_GAMES_tray_link_libraries)
        set(KLOUD_GAMES_TRAY_QT_VERSION 6)
    elseif("Qt5::Widgets" IN_LIST _KLOUD_GAMES_tray_link_libraries)
        set(KLOUD_GAMES_TRAY_QT_VERSION 5)
    else()
        message(FATAL_ERROR "Could not determine the Qt version used by the tray target.")
    endif()
    unset(_KLOUD_GAMES_tray_link_libraries)

    if(BUILD_TESTS)
        target_compile_definitions(tray PRIVATE TRAY_ENABLE_TEST_HOOKS)
    endif()

    if(KLOUD_GAMES_USE_STATIC_QT)
        set(CMAKE_FIND_LIBRARY_SUFFIXES "${_KLOUD_GAMES_find_library_suffixes}")
        set(CMAKE_IMPORT_LIBRARY_SUFFIX "${_KLOUD_GAMES_import_library_suffix}")
        set(PKG_CONFIG_ARGN "${_KLOUD_GAMES_pkg_config_argn}")
        set(CMAKE_DISABLE_FIND_PACKAGE_harfbuzz "${_KLOUD_GAMES_disable_find_package_harfbuzz}")
        unset(_KLOUD_GAMES_disable_find_package_harfbuzz)
        unset(_KLOUD_GAMES_find_library_suffixes)
        unset(_KLOUD_GAMES_import_library_suffix)
        unset(_KLOUD_GAMES_module_path)
        unset(_KLOUD_GAMES_pkg_config_argn)
        unset(_KLOUD_GAMES_qt_core_type)
    endif()
endif()

# common dependencies
include("${CMAKE_MODULE_PATH}/dependencies/nlohmann_json.cmake")
find_package(PkgConfig REQUIRED)
find_package(Threads REQUIRED)
pkg_check_modules(CURL REQUIRED libcurl)

# miniupnp
pkg_check_modules(MINIUPNP miniupnpc REQUIRED)
include_directories(SYSTEM ${MINIUPNP_INCLUDE_DIRS})

# ffmpeg pre-compiled binaries
include("${CMAKE_MODULE_PATH}/dependencies/ffmpeg.cmake")
include("${CMAKE_MODULE_PATH}/dependencies/nv_codec_headers.cmake")

# Opus
if(TARGET PkgConfig::KLOUD_GAMES_BUNDLED_OPUS)
    # Match the Opus version linked by the shared FFmpeg package.
    set(Opus_LIBRARY PkgConfig::KLOUD_GAMES_BUNDLED_OPUS)  # cmake-lint: disable=C0103
    set(Opus_INCLUDE_DIR "${FFMPEG_INCLUDE_DIRS}")  # cmake-lint: disable=C0103
else()
    # Homebrew provides opus as a dynamic library only, so disable static linking for Homebrew builds
    if(KLOUD_GAMES_BUILD_HOMEBREW)
        set(OPUS_USE_STATIC OFF CACHE BOOL "Static linking for libopus")
    else()
        set(OPUS_USE_STATIC ON CACHE BOOL "Static linking for libopus")
    endif()
    include("${CMAKE_MODULE_PATH}/dependencies/FindOpus.cmake")
endif()

# platform specific dependencies
if(WIN32)
    include("${CMAKE_MODULE_PATH}/dependencies/windows.cmake")
elseif(UNIX)
    include("${CMAKE_MODULE_PATH}/dependencies/unix.cmake")

    if(APPLE)
        include("${CMAKE_MODULE_PATH}/dependencies/macos.cmake")
    else()
        include("${CMAKE_MODULE_PATH}/dependencies/linux.cmake")
    endif()
endif()
