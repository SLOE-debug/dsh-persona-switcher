#include "process_runner.hpp"
#include <algorithm>

namespace dsh::testing {
void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}
static std::wstring quote(const std::wstring& argument) {
    std::wstring result = L"\""; size_t slashes = 0;
    for (auto c : argument) {
        if (c == L'\\') { ++slashes; continue; }
        if (c == L'\"') result.append(slashes * 2 + 1, L'\\');
        else result.append(slashes, L'\\');
        result += c; slashes = 0;
    }
    result.append(slashes * 2, L'\\'); return result + L"\"";
}
static std::vector<wchar_t> environmentBlock(const Environment& overrides) {
    auto normalize = [](std::wstring key) {
        std::transform(key.begin(), key.end(), key.begin(), towlower); return key;
    };
    std::map<std::wstring, std::wstring> values;
    auto inherited = GetEnvironmentStringsW();
    if (!inherited) throw std::runtime_error("Unable to read child environment");
    for (auto row = inherited; *row; row += wcslen(row) + 1) {
        std::wstring text(row); auto equal = text.find(L'=', 1);
        if (equal != std::wstring::npos) values[normalize(text.substr(0, equal))] = text.substr(equal + 1);
    }
    FreeEnvironmentStringsW(inherited);
    for (const auto& [key, value] : overrides) {
        if (value) values[normalize(key)] = *value; else values.erase(normalize(key));
    }
    std::vector<wchar_t> block;
    for (const auto& [key, value] : values) {
        auto row = key + L"=" + value; block.insert(block.end(), row.begin(), row.end()); block.push_back(0);
    }
    block.push_back(0); return block;
}
ChildProcess::ChildProcess(const std::vector<std::wstring>& arguments, const Environment& overrides) {
    require(!arguments.empty(), "Child process arguments are empty");
    SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
    HANDLE writer{};
    if (!CreatePipe(&output_, &writer, &security, 0)) throw std::runtime_error("Unable to create child output pipe");
    SetHandleInformation(output_, HANDLE_FLAG_INHERIT, 0);
    std::wstring command;
    for (const auto& argument : arguments) command += quote(argument) + L" ";
    auto environment = environmentBlock(overrides);
    STARTUPINFOW startup{sizeof(startup)};
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdOutput = startup.hStdError = writer;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    PROCESS_INFORMATION info{};
    auto ok = CreateProcessW(arguments[0].c_str(), command.data(), nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, environment.data(), nullptr, &startup, &info);
    CloseHandle(writer);
    if (!ok) { CloseHandle(output_); output_ = nullptr; throw std::runtime_error("Unable to start test child"); }
    process_ = info.hProcess; pid = info.dwProcessId; CloseHandle(info.hThread);
}
ChildProcess::~ChildProcess() {
    if (process_) {
        if (WaitForSingleObject(process_, 0) == WAIT_TIMEOUT) {
            TerminateProcess(process_, 1); WaitForSingleObject(process_, 3000);
        }
        CloseHandle(process_);
    }
    if (output_) CloseHandle(output_);
}
DWORD ChildProcess::wait(DWORD timeout) {
    require(WaitForSingleObject(process_, timeout) == WAIT_OBJECT_0, "Test child timed out");
    DWORD code{}; GetExitCodeProcess(process_, &code); return code;
}
Json ChildProcess::ready(DWORD timeout) {
    auto deadline = GetTickCount64() + timeout;
    while (GetTickCount64() < deadline) {
        DWORD available{};
        if (PeekNamedPipe(output_, nullptr, 0, nullptr, &available, nullptr) && available) {
            char bytes[4096]; DWORD read{};
            if (ReadFile(output_, bytes, std::min<DWORD>(available, sizeof(bytes)), &read, nullptr)) buffered_.append(bytes, read);
            require(buffered_.size() < 65536, "Fixture output exceeds budget");
            size_t end;
            while ((end = buffered_.find('\n')) != std::string::npos) {
                auto line = buffered_.substr(0, end); buffered_.erase(0, end + 1);
                auto value = Json::parse(line, nullptr, false);
                if (!value.is_discarded() && value.value("ready", false)) return value;
            }
        }
        if (WaitForSingleObject(process_, 0) == WAIT_OBJECT_0) break;
        Sleep(20);
    }
    throw std::runtime_error("Controlled runtime did not become ready: " + buffered_.substr(0, 1000));
}
TempDirectory::TempDirectory() {
    path = fs::temp_directory_path() / (L"dsh-native-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()));
    require(fs::create_directory(path), "Unable to create isolated test directory");
}
TempDirectory::~TempDirectory() { std::error_code error; fs::remove_all(path, error); }
}
