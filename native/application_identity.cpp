#include "host_discovery.hpp"
#include <algorithm>

namespace dsh {
bool isDshApplication(const fs::path& executable) {
    std::error_code error;
    if (!fs::is_regular_file(executable.parent_path() / L"resources/app.asar", error)) return false;
    DWORD unused{};
    auto size = GetFileVersionInfoSizeW(executable.c_str(), &unused);
    if (!size) return false;
    std::vector<unsigned char> data(size);
    if (!GetFileVersionInfoW(executable.c_str(), 0, size, data.data())) return false;
    struct Translation { WORD language, codepage; };
    Translation* translations{}; UINT bytes{};
    if (!VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void**>(&translations), &bytes)) return false;
    for (UINT i = 0; i < bytes / sizeof(Translation); ++i) {
        wchar_t key[80]{};
        swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\ProductName", translations[i].language, translations[i].codepage);
        wchar_t* value{}; UINT length{};
        if (!VerQueryValueW(data.data(), key, reinterpret_cast<void**>(&value), &length) || !length) continue;
        std::wstring product(value);
        std::transform(product.begin(), product.end(), product.begin(), towlower);
        if (product == L"dsh desktop") return true;
    }
    return false;
}
}
