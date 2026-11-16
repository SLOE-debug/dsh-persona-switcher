#pragma once
#include "../native/common.hpp"
#include <map>

namespace dsh::testing {
using Environment = std::map<std::wstring, std::optional<std::wstring>>;
class ChildProcess {
    HANDLE process_{}, output_{};
    std::string buffered_;
public:
    DWORD pid{};
    ChildProcess(const std::vector<std::wstring>& arguments, const Environment& environment = {});
    ~ChildProcess();
    ChildProcess(const ChildProcess&) = delete;
    ChildProcess& operator=(const ChildProcess&) = delete;
    DWORD wait(DWORD timeout = 60000);
    Json ready(DWORD timeout = 15000);
};
struct TempDirectory {
    fs::path path;
    TempDirectory();
    ~TempDirectory();
};
void require(bool condition, const std::string& message);
}
