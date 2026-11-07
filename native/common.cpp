#include "common.hpp"
#include <shlobj.h>
#include <bcrypt.h>
#include <fstream>
#include <algorithm>
#include <sstream>
#include <iomanip>

namespace dsh {
std::string utf8(const std::wstring& text) {
    if (text.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), int(text.size()), nullptr, 0, nullptr, nullptr);
    if (!n) throw std::runtime_error("文本编码无效。");
    std::string result(n, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), int(text.size()), result.data(), n, nullptr, nullptr);
    return result;
}
std::wstring wide(const std::string& text) {
    if (text.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), int(text.size()), nullptr, 0);
    if (!n) throw std::runtime_error("人格文件必须使用 UTF-8 编码。");
    std::wstring result(n, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), int(text.size()), result.data(), n);
    return result;
}
std::wstring normalizedPath(const fs::path& path) {
    auto text = fs::absolute(path).lexically_normal().wstring();
    std::replace(text.begin(), text.end(), L'/', L'\\');
    std::transform(text.begin(), text.end(), text.begin(), towlower);
    return text;
}
bool within(const fs::path& root, const fs::path& file) {
    auto prefix = normalizedPath(root);
    if (prefix.back() != L'\\') prefix += L'\\';
    return normalizedPath(file).starts_with(prefix);
}
fs::path executablePath() {
    std::wstring buffer(32768, L'\0');
    DWORD n = GetModuleFileNameW(nullptr, buffer.data(), DWORD(buffer.size()));
    if (!n || n == buffer.size()) throw std::runtime_error("无法读取程序路径。");
    buffer.resize(n); return buffer;
}
static fs::path knownFolder(REFKNOWNFOLDERID id) {
    PWSTR value = nullptr;
    if (FAILED(SHGetKnownFolderPath(id, 0, nullptr, &value))) throw std::runtime_error("无法读取用户文件夹。");
    fs::path result(value); CoTaskMemFree(value); return result;
}
fs::path localData() { return knownFolder(FOLDERID_LocalAppData); }
fs::path roamingData() { return knownFolder(FOLDERID_RoamingAppData); }
fs::path userProfile() { return knownFolder(FOLDERID_Profile); }
std::string readFile(const fs::path& path, size_t limit) {
    auto size = fs::file_size(path);
    if (size > limit) throw std::runtime_error("文件超过读取上限：" + utf8(path.filename().wstring()));
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("无法读取文件：" + utf8(path.filename().wstring()));
    std::string result(size, '\0'); input.read(result.data(), std::streamsize(size));
    if (!input && size) throw std::runtime_error("文件读取不完整。");
    return result;
}
void writeFile(const fs::path& path, const std::string& bytes) {
    fs::create_directories(path.parent_path());
    auto temporary = path; temporary += L"." + std::to_wstring(GetCurrentProcessId()) + L".tmp";
    { std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
      output.write(bytes.data(), std::streamsize(bytes.size()));
      if (!output) throw std::runtime_error("文件写入失败。"); }
    if (!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        throw std::runtime_error("文件保存失败。");
}
std::string fingerprint(std::string bytes) {
    for (size_t at = 0; (at = bytes.find("\r\n", at)) != std::string::npos;) bytes.erase(at, 1);
    BCRYPT_ALG_HANDLE algorithm{};
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0)) throw std::runtime_error("摘要算法不可用。");
    unsigned char digest[32]{};
    auto status = BCryptHash(algorithm, nullptr, 0, reinterpret_cast<PUCHAR>(bytes.data()), ULONG(bytes.size()), digest, 32);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (status) throw std::runtime_error("无法计算文件摘要。");
    std::ostringstream result;
    for (unsigned char byte : digest) result << std::hex << std::setfill('0') << std::setw(2) << unsigned(byte);
    return result.str();
}
std::string resource(unsigned id) {
    auto module = GetModuleHandleW(nullptr);
    auto found = FindResourceW(module, MAKEINTRESOURCEW(id), RT_RCDATA);
    if (!found) throw std::runtime_error("内置资源缺失。");
    auto loaded = LoadResource(module, found);
    return std::string(static_cast<const char*>(LockResource(loaded)), SizeofResource(module, found));
}
std::string fileUrl(const fs::path& path) {
    auto text = utf8(fs::absolute(path).generic_wstring());
    std::ostringstream result; result << "file:///";
    for (unsigned char c : text) {
        if (isalnum(c) || c == '/' || c == ':' || c == '-' || c == '_' || c == '.' || c == '~' || c == '@') result << c;
        else result << '%' << std::uppercase << std::hex << std::setw(2) << std::setfill('0') << unsigned(c);
    }
    return result.str();
}
std::optional<fs::path> urlFile(const std::string& url) {
    if (!url.starts_with("file:///") || url.find_first_of("?#") != std::string::npos) return std::nullopt;
    std::string bytes;
    for (size_t i = 8; i < url.size(); ++i) {
        if (url[i] == '%') {
            if (i + 2 >= url.size() || !isxdigit(url[i+1]) || !isxdigit(url[i+2])) return std::nullopt;
            bytes += char(std::stoi(url.substr(i + 1, 2), nullptr, 16)); i += 2;
        } else bytes += url[i];
    }
    return fs::path(wide(bytes));
}
std::string requireExpression(const fs::path& module) {
    auto name = Json(utf8(module.wstring())).dump();
    return "process.getBuiltinModule('module').createRequire(" + name + ")(" + name + ")";
}
}
