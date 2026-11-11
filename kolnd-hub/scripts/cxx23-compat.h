// Compatibilidade C++20 -> C++23 para o GCC 16 do ucrt64.
// O erro no modo C++23 e causado por headers internos da libstdc++
// (boost/asio, <format>) que nao compilam com esse toolchain.
// O codigo-fonte do Kloud Games so depende de std::to_underlying entre
// as features C++23, entao um polyfill e suficiente.
#pragma once
#include <type_traits>

#if __cplusplus < 202302L
namespace std {
template<class E>
constexpr auto to_underlying(E value) noexcept {
    return static_cast<std::underlying_type_t<E>>(value);
}
}
#endif
