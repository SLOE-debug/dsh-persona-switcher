#include "host_discovery.hpp"
#include <shellapi.h>
#include <algorithm>
#include <map>
#include <set>

namespace dsh {
bool isDeepSeekProduct(const fs::path& executable) {
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
        swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\CompanyName", translations[i].language, translations[i].codepage);
        wchar_t* value{}; UINT length{};
        if (!VerQueryValueW(data.data(), key, reinterpret_cast<void**>(&value), &length) || !length) continue;
        std::wstring company(value);
        std::transform(company.begin(), company.end(), company.begin(), towlower);
        if (company.find(L"deepseek") != std::wstring::npos) return true;
    }
    return false;
}

static bool isHostEntry(const fs::path& entry) {
    if (!entry.is_absolute()) return false;
    auto path = normalizedPath(entry);
    auto ext = entry.extension().wstring();
    std::transform(ext.begin(), ext.end(), ext.begin(), towlower);
    return (ext == L".js" || ext == L".mjs" || ext == L".cjs") &&
        path.find(L"\\node_modules\\@deepseek-ai\\dsh-desktop-host\\") != std::wstring::npos;
}

static size_t scriptIndex(const std::vector<std::wstring>& args) {
    // These Node flags consume a separate argument; --flag=value consumes only itself.
    static const std::set<std::wstring> valued{L"-r", L"--require", L"--import", L"--loader",
        L"--experimental-loader", L"--inspect-port", L"--title", L"--icu-data-dir",
        L"--openssl-config", L"--conditions", L"-C", L"--max-old-space-size"};
    size_t index = 1;
    while (index < args.size() && args[index].starts_with(L"-")) {
        if (args[index] == L"--") return index + 1;
        index += valued.contains(args[index]) ? 2 : 1;
    }
    return index;
}

std::vector<Host> selectHosts(const std::vector<ProcessInfo>& table, const ProductCheck& check,
    const std::optional<fs::path>& configured) {
    std::map<DWORD, DWORD> parents;
    std::map<std::wstring, bool> products;
    std::vector<Host> candidates, result;
    for (const auto& row : table) {
        parents[row.pid] = row.parent;
        if (row.command.empty() || row.exe.empty()) continue;
        int argc{}; auto argv = CommandLineToArgvW(row.command.c_str(), &argc);
        if (!argv) continue;
        std::vector<std::wstring> args(argv, argv + argc);
        LocalFree(argv);
        if (std::any_of(args.begin(), args.end(), [](const auto& arg) { return arg.starts_with(L"--type="); })) continue;
        // The first positional script is the actual Node entry, not a later tool argument.
        auto entryIndex = scriptIndex(args);
        if (entryIndex >= args.size() || !isHostEntry(args[entryIndex])) continue;
        if (configured) {
            // Explicit selection supports builds without vendor version resources.
            if (!within(*configured, row.exe) || !within(*configured, fs::path(args[entryIndex]))) continue;
        } else {
            auto key = normalizedPath(row.exe);
            if (!products.contains(key)) products[key] = check(row.exe);
            if (!products[key]) continue;
        }
        auto install = row.exe.parent_path();
        if (!within(install, fs::path(args[entryIndex]))) continue;
        Host host{row.pid, row.created, row.exe, {fs::path(args[entryIndex])}, {install}};
        // The host supplies its app, profile and runtime directories on its own command line.
        for (size_t i = entryIndex + 1; i < args.size(); ++i) {
            fs::path directory(args[i]); std::error_code error;
            if (!directory.is_absolute() || directory == directory.root_path() ||
                !fs::is_directory(directory, error)) continue;
            if (std::none_of(host.roots.begin(), host.roots.end(), [&](const auto& root) {
                return normalizedPath(root) == normalizedPath(directory) || within(root, directory);
            })) host.roots.push_back(directory);
        }
        candidates.push_back(std::move(host));
    }
    std::set<DWORD> ids; for (const auto& host : candidates) ids.insert(host.pid);
    for (const auto& host : candidates) {
        DWORD parent = parents[host.pid]; std::set<DWORD> visited; bool nested = false;
        while (parent && visited.insert(parent).second) {
            if (ids.contains(parent)) { nested = true; break; }
            auto found = parents.find(parent);
            parent = found == parents.end() ? 0 : found->second;
        }
        if (!nested) result.push_back(host);
    }
    return result;
}
}
