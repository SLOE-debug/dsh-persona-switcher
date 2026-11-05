#include "cdp.hpp"
#include <chrono>
#include <thread>

namespace dsh {
static HINTERNET openSession() {
    auto session = WinHttpOpen(L"DSH-Persona-Native/3", WINHTTP_ACCESS_TYPE_NO_PROXY, nullptr, nullptr, 0);
    if (!session) throw std::runtime_error("无法启动本机通信。");
    WinHttpSetTimeouts(session, 3000, 3000, 10000, 10000);
    return session;
}
std::string httpGet(unsigned short port, const std::wstring& path) {
    HttpHandle session(openSession());
    HttpHandle connection(WinHttpConnect(session.value, L"127.0.0.1", port, 0));
    if (!connection.value) throw std::runtime_error("本机端口无法连接。");
    HttpHandle request(WinHttpOpenRequest(connection.value, L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0));
    DWORD redirects = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    WinHttpSetOption(request.value, WINHTTP_OPTION_REDIRECT_POLICY, &redirects, sizeof(redirects));
    if (!request.value || !WinHttpSendRequest(request.value, nullptr, 0, nullptr, 0, 0, 0) || !WinHttpReceiveResponse(request.value, nullptr))
        throw std::runtime_error("调试端口未响应。");
    DWORD status = 0, size = sizeof(status);
    WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, nullptr, &status, &size, nullptr);
    if (status != 200) throw std::runtime_error("当前端口不是调试服务。");
    std::string result; char buffer[16384]; DWORD received = 0;
    do {
        if (!WinHttpReadData(request.value, buffer, sizeof(buffer), &received)) throw std::runtime_error("读取调试清单失败。");
        result.append(buffer, received);
        if (result.size() > 262144) throw std::runtime_error("调试清单超过上限。");
    } while (received);
    return result;
}
Cdp::Cdp(unsigned short port, const std::string& address) : session_(openSession()) {
    auto prefix = "ws://127.0.0.1:" + std::to_string(port) + "/";
    if (!address.starts_with(prefix) || address.find_first_of("?#", prefix.size()) != std::string::npos)
        throw std::runtime_error("调试 WebSocket 地址与目标端口不一致。");
    connection_.value = WinHttpConnect(session_.value, L"127.0.0.1", port, 0);
    auto path = wide(address.substr(prefix.size() - 1));
    HttpHandle request(WinHttpOpenRequest(connection_.value, L"GET", path.c_str(), nullptr, nullptr, nullptr, 0));
    DWORD redirects = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    WinHttpSetOption(request.value, WINHTTP_OPTION_REDIRECT_POLICY, &redirects, sizeof(redirects));
    if (!request.value || !WinHttpSetOption(request.value, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0) ||
        !WinHttpSendRequest(request.value, nullptr, 0, nullptr, 0, 0, 0) || !WinHttpReceiveResponse(request.value, nullptr))
        throw std::runtime_error("WebSocket 调试连接失败。");
    DWORD status = 0, size = sizeof(status);
    WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, nullptr, &status, &size, nullptr);
    if (status != 101) throw std::runtime_error("调试 WebSocket 升级被拒绝。");
    socket_.value = WinHttpWebSocketCompleteUpgrade(request.value, 0);
    if (!socket_.value) throw std::runtime_error("无法建立调试会话。");
    DWORD timeout = 15000;
    WinHttpSetOption(socket_.value, WINHTTP_OPTION_RECEIVE_TIMEOUT, &timeout, sizeof(timeout));
}
Cdp::~Cdp() { if (socket_.value) WinHttpWebSocketShutdown(socket_.value, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0); }
Json Cdp::call(const std::string& method, Json parameters) {
    unsigned id = ++sequence_;
    auto body = Json{{"id", id}, {"method", method}, {"params", parameters}}.dump();
    auto code = WinHttpWebSocketSend(socket_.value, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE, body.data(), DWORD(body.size()));
    if (code) throw std::runtime_error("调试请求发送失败。");
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
    for (;;) {
        std::string incoming; WINHTTP_WEB_SOCKET_BUFFER_TYPE type{};
        do {
            char buffer[65536]; DWORD received{};
            code = WinHttpWebSocketReceive(socket_.value, buffer, sizeof(buffer), &received, &type);
            if (code || type == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) throw std::runtime_error("调试连接已关闭或超时。");
            if (type != WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE && type != WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE)
                throw std::runtime_error("调试结果不是文本消息。");
            incoming.append(buffer, received);
            if (incoming.size() > 64 * 1024 * 1024) throw std::runtime_error("调试结果超过内存预算。");
        } while (type == WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE);
        auto response = Json::parse(incoming);
        if (response.contains("method") && event) event(response);
        if (response.value("id", 0u) == id) {
            if (response.contains("error")) throw std::runtime_error(response["error"].value("message", "调试请求失败。"));
            return response.at("result");
        }
        if (std::chrono::steady_clock::now() > deadline) throw std::runtime_error("调试请求超过时间预算。");
    }
}
Json Cdp::returned(const Json& response) {
    if (response.contains("exceptionDetails")) {
        auto detail = response["exceptionDetails"];
        std::string text = detail.contains("exception") ? detail["exception"].value("description", "运行时核验失败。") : detail.value("text", "运行时核验失败。");
        throw std::runtime_error(text.substr(0, 700));
    }
    auto value = response.at("result");
    if (value.value("type", "") == "undefined") return nullptr;
    if (!value.contains("value")) throw std::runtime_error("调试结果不是可传输的数据。");
    return value["value"];
}
Json Cdp::evaluate(const std::string& expression, bool byValue) {
    auto key = "local.dsh-persona.native.pending." + std::to_string(GetCurrentProcessId()) + "." + std::to_string(sequence_ + 1);
    try {
        auto result = call("Runtime.evaluate", {{"expression", "globalThis[" + Json(key).dump() + "] = (" + expression + ")"},
            {"returnByValue", byValue}, {"awaitPromise", true}, {"timeout", 15000}});
        call("Runtime.evaluate", {{"expression", "delete globalThis[" + Json(key).dump() + "]"}, {"returnByValue", true}});
        if (!byValue) {
            if (result.contains("exceptionDetails")) returned(result);
            return result.at("result");
        }
        return returned(result);
    } catch (...) {
        try { call("Runtime.evaluate", {{"expression", "delete globalThis[" + Json(key).dump() + "]"}, {"returnByValue", true}}); } catch (...) {}
        throw;
    }
}
static std::optional<std::pair<unsigned short, std::string>> endpoint(DWORD pid) {
    for (auto port : listeningPorts(pid)) {
        try {
            auto rows = Json::parse(httpGet(port, L"/json/list"));
            std::vector<std::string> found;
            for (const auto& row : rows) if (row.value("type", "") == "node") found.push_back(row.at("webSocketDebuggerUrl"));
            if (found.size() == 1) return std::pair(port, found[0]);
        } catch (...) {}
    }
    return std::nullopt;
}
TargetSession::TargetSession(const Host& host) {
    auto target = endpoint(host.pid); opened_ = !target;
    if (!target) {
        activateInspector(host.pid);
        for (int i = 0; i < 40 && !target; ++i) { Sleep(150); target = endpoint(host.pid); }
    }
    if (!target) throw std::runtime_error("没有找到本机调试端口。");
    client = std::make_unique<Cdp>(target->first, target->second);
    auto identity = Cdp::returned(client->call("Runtime.evaluate", {
        {"expression", "({pid:process.pid,execPath:process.execPath,entry:process.argv[1]})"},
        {"returnByValue", true}, {"throwOnSideEffect", true}, {"timeout", 5000}}));
    bool matches = identity.value("pid", 0ul) == host.pid && normalizedPath(wide(identity.at("execPath").get<std::string>())) == normalizedPath(host.executable);
    bool entry = false;
    for (const auto& expected : host.entries) if (normalizedPath(wide(identity.at("entry").get<std::string>())) == normalizedPath(expected)) entry = true;
    if (!matches || !entry) throw std::runtime_error("调试目标的 PID、程序或入口与已核验进程不一致。");
    verified_ = true;
}
TargetSession::~TargetSession() {
    if (opened_ && verified_ && client) {
        try { client->evaluate("(setTimeout(()=>process.getBuiltinModule('inspector').close(),200).unref(),true)"); } catch (...) {}
        client.reset(); Sleep(250);
    }
}
}
