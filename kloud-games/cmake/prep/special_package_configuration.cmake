# KLOUD_GAMES only ships Windows packages, so there are no platform-specific
# package manifests to configure. This file only handles the early-exit switch.
if(${KLOUD_GAMES_CONFIGURE_ONLY})
    # message
    message(STATUS "KLOUD_GAMES_CONFIGURE_ONLY: ON, exiting...")
    set(END_BUILD ON)
else()
    set(END_BUILD OFF)
endif()
