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

option(BOOST_USE_STATIC "Use static boost libraries." ON)

option(CUDA_INHERIT_COMPILE_OPTIONS
        "When building CUDA code, inherit compile options from the the main project. You may want to disable this if
        your IDE throws errors about unknown flags after running cmake." ON)
