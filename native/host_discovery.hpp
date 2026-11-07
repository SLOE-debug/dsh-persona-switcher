#pragma once
#include "common.hpp"
#include <functional>

namespace dsh {
struct ProcessInfo {
    DWORD pid{}, parent{};
    fs::path exe;
    std::wstring command, created;
};
using ProductCheck = std::function<bool(const fs::path&)>;
bool isDeepSeekProduct(const fs::path& executable);
std::optional<fs::path> installOverride();
std::vector<Host> selectHosts(const std::vector<ProcessInfo>& table, const ProductCheck& check,
    const std::optional<fs::path>& install = std::nullopt);
}
