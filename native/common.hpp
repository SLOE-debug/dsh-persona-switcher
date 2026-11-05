#pragma once
#include <windows.h>
#include <string>
#include <vector>
#include <filesystem>
#include <stdexcept>
#include <optional>
#include "vendor/json.hpp"

namespace dsh {
namespace fs = std::filesystem;
using Json = nlohmann::json;
std::string utf8(const std::wstring& text);
std::wstring wide(const std::string& text);
std::wstring normalizedPath(const fs::path& path);
bool within(const fs::path& root, const fs::path& file);
fs::path executablePath();
fs::path localData();
fs::path roamingData();
std::string readFile(const fs::path& path, size_t limit = 64 * 1024 * 1024);
void writeFile(const fs::path& path, const std::string& bytes);
std::string fingerprint(std::string bytes);
std::string resource(unsigned id);
std::string fileUrl(const fs::path& path);
std::optional<fs::path> urlFile(const std::string& url);
std::string requireExpression(const fs::path& module);

struct Host {
    DWORD pid{};
    std::wstring created;
    fs::path executable;
    std::vector<fs::path> entries, roots;
};
std::vector<Host> discoverHosts();
std::vector<unsigned short> listeningPorts(DWORD pid);
void activateInspector(DWORD pid);
std::string httpGet(unsigned short port, const std::wstring& path);

struct Persona { std::wstring name; fs::path path; std::string text; };
class Assets {
public:
    fs::path folder, personas, cache;
    Assets();
    std::vector<Persona> loadPersonas() const;
};
}
