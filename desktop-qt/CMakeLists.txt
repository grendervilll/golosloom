cmake_minimum_required(VERSION 3.21)
project(golosloom_qt VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Network WebSockets)
find_package(OpenSSL REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(GST REQUIRED IMPORTED_TARGET
    gstreamer-1.0 gstreamer-webrtc-1.0 gstreamer-sdp-1.0 gstreamer-app-1.0
    gstreamer-audio-1.0 gstreamer-video-1.0)

qt_add_executable(golosloom_qt
    src/main.cpp
    src/smoke.cpp
    src/util/base64.h src/util/base64.cpp
    src/crypto/crypto.h src/crypto/crypto.cpp
    src/crypto/storage.h src/crypto/storage.cpp
    src/models.h
    src/api/api_client.h src/api/api_client.cpp
    src/api/ws_client.h src/api/ws_client.cpp
    src/core/app_state.h src/core/app_state.cpp
    src/markdown/markdown.h src/markdown/markdown.cpp
    src/ui/theme.h src/ui/theme.cpp
    src/ui/login_dialog.h src/ui/login_dialog.cpp
    src/ui/main_window.h src/ui/main_window.cpp
    src/ui/channel_list.h src/ui/channel_list.cpp
    src/ui/chat_panel.h src/ui/chat_panel.cpp
    src/ui/message_widget.h src/ui/message_widget.cpp
    src/call/proto.h src/call/proto.cpp
    src/call/livekit_client.h src/call/livekit_client.cpp
    src/call/call_manager.h src/call/call_manager.cpp
    src/call_smoke.cpp
)

target_include_directories(golosloom_qt PRIVATE src)

target_link_libraries(golosloom_qt PRIVATE
    Qt6::Widgets Qt6::Network Qt6::WebSockets
    OpenSSL::Crypto
    PkgConfig::GST
    "-framework Security"
)

if(APPLE)
    set_target_properties(golosloom_qt PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_BUNDLE_NAME "Golosloom"
        MACOSX_BUNDLE_BUNDLE_VERSION "1.0.0"
        MACOSX_BUNDLE_SHORT_VERSION_STRING "1.0.0"
        MACOSX_BUNDLE_GUI_IDENTIFIER "com.golosloom.desktop"
    )
endif()
