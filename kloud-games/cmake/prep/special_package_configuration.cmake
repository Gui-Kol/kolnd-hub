if(UNIX)
    if(${KLOUD_GAMES_CONFIGURE_HOMEBREW})
        configure_file(packaging/KLOUD_GAMES.rb KLOUD_GAMES.rb @ONLY)
    endif()
endif()

if(APPLE)
    if(${KLOUD_GAMES_CONFIGURE_PORTFILE})
        configure_file(packaging/macos/Portfile Portfile @ONLY)
    endif()
elseif(UNIX)
    # configure the .desktop file
    set(KLOUD_GAMES_DESKTOP_ICON "${PROJECT_FQDN}")
    if(${KLOUD_GAMES_BUILD_APPIMAGE})
        configure_file(packaging/linux/AppImage/${PROJECT_FQDN}.desktop ${PROJECT_FQDN}.desktop @ONLY)
    elseif(${KLOUD_GAMES_BUILD_FLATPAK})
        configure_file(packaging/linux/flatpak/${PROJECT_FQDN}.desktop ${PROJECT_FQDN}.desktop @ONLY)
    else()
        configure_file(packaging/linux/${PROJECT_FQDN}.desktop ${PROJECT_FQDN}.desktop @ONLY)
        configure_file(packaging/linux/${PROJECT_FQDN}.terminal.desktop ${PROJECT_FQDN}.terminal.desktop @ONLY)
    endif()

    # configure metadata file
    configure_file(packaging/linux/${PROJECT_FQDN}.metainfo.xml ${PROJECT_FQDN}.metainfo.xml @ONLY)

    # configure service
    configure_file(packaging/linux/app-${PROJECT_FQDN}.service.in app-${PROJECT_FQDN}.service @ONLY)

    # configure kwin desktop permission file
    if (${KLOUD_GAMES_ENABLE_KWIN})
        configure_file(packaging/linux/${PROJECT_FQDN}.kwin.desktop.in ${PROJECT_FQDN}.kwin.desktop @ONLY)
    endif()

    # configure the arch linux pkgbuild
    if(${KLOUD_GAMES_CONFIGURE_PKGBUILD})
        configure_file(packaging/linux/Arch/PKGBUILD PKGBUILD @ONLY)
        configure_file(packaging/linux/Arch/KLOUD_GAMES.install KLOUD_GAMES.install @ONLY)
    endif()

    # configure the Alpine Linux APKBUILD
    if(${KLOUD_GAMES_CONFIGURE_APKBUILD})
        configure_file(packaging/linux/Alpine/APKBUILD APKBUILD @ONLY)
        configure_file(packaging/linux/Alpine/KLOUD_GAMES.post-install KLOUD_GAMES.post-install COPYONLY)
        configure_file(packaging/linux/Alpine/KLOUD_GAMES.post-install KLOUD_GAMES.post-upgrade COPYONLY)
    endif()

    # configure the flatpak manifest
    if(${KLOUD_GAMES_CONFIGURE_FLATPAK_MAN})
        configure_file(packaging/linux/flatpak/${PROJECT_FQDN}.yml ${PROJECT_FQDN}.yml @ONLY)
        file(COPY packaging/linux/flatpak/deps/ DESTINATION ${CMAKE_BINARY_DIR})
        file(COPY packaging/linux/flatpak/modules DESTINATION ${CMAKE_BINARY_DIR})
        file(COPY generated-sources.json DESTINATION ${CMAKE_BINARY_DIR})
        file(COPY package-lock.json DESTINATION ${CMAKE_BINARY_DIR})
    endif()
endif()

# return if configure only is set
if(${KLOUD_GAMES_CONFIGURE_ONLY})
    # message
    message(STATUS "KLOUD_GAMES_CONFIGURE_ONLY: ON, exiting...")
    set(END_BUILD ON)
else()
    set(END_BUILD OFF)
endif()
