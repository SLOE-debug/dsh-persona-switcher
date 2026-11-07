#include "host_discovery.hpp"

namespace dsh {
std::optional<fs::path> installOverride() {
    wchar_t value[32768]{};
    auto size = GetEnvironmentVariableW(L"DSH_PERSONA_INSTALL_ROOT", value, 32768);
    if (!size) return std::nullopt;
    if (size >= 32768) throw std::runtime_error("指定的安装目录过长，请缩短 DSH_PERSONA_INSTALL_ROOT 路径。");
    fs::path root(value); std::error_code error;
    if (!root.is_absolute() || root == root.root_path() || !fs::is_directory(root, error))
        throw std::runtime_error("指定的安装目录不存在或不是绝对路径，请修正 DSH_PERSONA_INSTALL_ROOT。");
    if (!fs::is_regular_file(root / L"resources" / L"app.asar", error))
        throw std::runtime_error("指定目录中没有 resources\\app.asar，请将 DSH_PERSONA_INSTALL_ROOT 指向 DSH 安装目录。");
    return root.lexically_normal();
}
}
