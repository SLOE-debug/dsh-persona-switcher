#include "common.hpp"
#include <algorithm>

namespace dsh {
Assets::Assets() {
    auto patch = resource(103), target = resource(104), contract = resource(105);
    auto identity = fingerprint(patch + target + contract);
    cache = localData() / L"DSH-Persona-Switcher" / L"native-cache";
    folder = cache / L"payload" / wide(identity);
    for (const auto& item : std::vector<std::pair<std::wstring, std::string>>{
        {L"runtime_patch.mjs", patch}, {L"runtime_target.mjs", target}, {L"request_contract.mjs", contract}}) {
        auto path = folder / item.first;
        if (fs::exists(path)) {
            if (readFile(path) != item.second) throw std::runtime_error("运行代码缓存损坏，请清理 native-cache 后重试。");
        } else writeFile(path, item.second);
    }
    personas = executablePath().parent_path() / L"personas";
    if (!fs::exists(personas)) {
        fs::create_directories(personas);
        auto seeds = Json::parse(resource(106));
        for (auto it = seeds.begin(); it != seeds.end(); ++it) {
            auto name = fs::path(wide(it.key()));
            if (name.has_parent_path() || name.extension() != L".md") throw std::runtime_error("内置人格名称无效。");
            writeFile(personas / name, it.value().get<std::string>());
        }
    }
}
std::vector<Persona> Assets::loadPersonas() const {
    std::vector<Persona> result;
    for (const auto& item : fs::directory_iterator(personas)) {
        auto extension = item.path().extension().wstring();
        std::transform(extension.begin(), extension.end(), extension.begin(), towlower);
        if (!item.is_regular_file() || extension != L".md") continue;
        auto text = readFile(item.path(), 65536);
        if (text.starts_with("\xef\xbb\xbf")) text.erase(0, 3);
        wide(text);
        if (text.find_first_not_of(" \r\n\t") == std::string::npos) throw std::runtime_error("人格文件为空：" + utf8(item.path().filename().wstring()));
        if (item.path().stem().wstring().size() > 128) throw std::runtime_error("人格名称超过 128 字符。");
        result.push_back({item.path().stem().wstring(), item.path(), text});
    }
    std::sort(result.begin(), result.end(), [](const auto& a, const auto& b) { return a.name < b.name; });
    return result;
}
}
