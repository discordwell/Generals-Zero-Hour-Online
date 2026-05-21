cmake_minimum_required(VERSION 3.20)
project(generals_oracle CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# v1 oracle: chunk walker.  Reads a .sav file, lists every CHUNK_<name>
# block + size, dumps as JSON.  Compiles standalone with mingw-w64 — no
# dependency on the GeneralsMD source tree.
#
# Future versions:
#   v2 — parse CHUNK_GameLogic header (frame counter, object TOC).
#   v3 — parse Object::xfer for each saved object.
#   v4 — actually run the engine's logic update loop (needs the full
#        engine compiled, multi-week project).
add_executable(oracle src/main.cpp)

if(WIN32)
  target_compile_options(oracle PRIVATE -Wall -Wextra -Wpedantic)
endif()

install(TARGETS oracle RUNTIME DESTINATION bin)
