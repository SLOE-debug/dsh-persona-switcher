#pragma once
#include "common.hpp"
#include <winhttp.h>
#include <functional>
#include <memory>

namespace dsh {
struct HttpHandle {
    HINTERNET value{};
    HttpHandle() = default;
    explicit HttpHandle(HINTERNET handle) : value(handle) {}
    ~HttpHandle() { if (value) WinHttpCloseHandle(value); }
    HttpHandle(const HttpHandle&) = delete;
    HttpHandle& operator=(const HttpHandle&) = delete;
};
class Cdp {
    HttpHandle session_, connection_, socket_;
    unsigned sequence_{};
public:
    std::function<void(const Json&)> event;
    Cdp(unsigned short port, const std::string& address);
    ~Cdp();
    Json call(const std::string& method, Json parameters = Json::object());
    Json evaluate(const std::string& expression, bool byValue = true);
    static Json returned(const Json& response);
};
class TargetSession {
    bool opened_{};
    bool verified_{};
public:
    std::unique_ptr<Cdp> client;
    explicit TargetSession(const Host& host);
    ~TargetSession();
};
}
