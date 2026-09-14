if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "E:/yymsg/sdk/gradle/caches/8.14.3/transforms/19343859a9f0a6124130280eb42316af/transformed/hermes-android-0.81.5-release/prefab/modules/libhermes/libs/android.x86_64/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "E:/yymsg/sdk/gradle/caches/8.14.3/transforms/19343859a9f0a6124130280eb42316af/transformed/hermes-android-0.81.5-release/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

