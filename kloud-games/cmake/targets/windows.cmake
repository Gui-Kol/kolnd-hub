# windows specific target definitions
set_target_properties(KLOUD_GAMES PROPERTIES LINK_SEARCH_START_STATIC 1)
set(CMAKE_FIND_LIBRARY_SUFFIXES ".dll")
find_library(ZLIB ZLIB1)
list(APPEND KLOUD_GAMES_EXTERNAL_LIBRARIES
        $<TARGET_OBJECTS:KLOUD_GAMES_rc_object>
        Windowsapp.lib
        Wtsapi32.lib
        version.lib)
