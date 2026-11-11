# unix specific compile definitions
# put anything here that applies to both linux and macos

list(APPEND KLOUD_GAMES_EXTERNAL_LIBRARIES
        ${CURL_LIBRARIES})

# add install prefix to assets path if not already there
if(NOT APPLE AND NOT KLOUD_GAMES_ASSETS_DIR MATCHES "^${CMAKE_INSTALL_PREFIX}")
    set(KLOUD_GAMES_ASSETS_DIR "${CMAKE_INSTALL_PREFIX}/${KLOUD_GAMES_ASSETS_DIR}")
endif()
