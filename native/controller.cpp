#include "controller.hpp"

namespace dsh {
Host Controller::host() {
    auto hosts = discoverHosts();
    if (hosts.empty()) throw std::runtime_error("请先打开 DSH Desktop，等待聊天界面加载后重试。");
    if (hosts.size() != 1) throw std::runtime_error("检测到多个候选宿主，请只保留一个 DSH 实例。");
    auto selected = hosts[0];
    if (!host_ || host_->pid != selected.pid || host_->created != selected.created || normalizedPath(host_->executable) != normalizedPath(selected.executable)) {
        candidate_ = nullptr; location_ = nullptr; inspect_ = false; host_ = selected;
    }
    return selected;
}
Json Controller::present(Json state) {
    state["connected"] = true;
    auto phase = state.value("phase", "ready");
    if (phase == "ready") state["message"] = "请求入口已识别，可以切换人格。";
    else if (phase == "armed") state["message"] = "人格已就绪，等待下一次标准会话请求。";
    else if (phase == "observed") state["message"] = "已观测到人格用于符合范围的请求。";
    else if (phase == "standard") state["message"] = "当前使用标准提示词。";
    else state["message"] = "DSH 已连接。";
    if (!location_.is_null()) state["discovery"] = location_;
    return state;
}
Json Controller::status() {
    Host current;
    try { current = host(); }
    catch (const std::exception& error) { return {{"connected", false}, {"phase", "connected"}, {"message", error.what()}}; }
    if (!inspect_) return {{"connected", true}, {"phase", "connected"}, {"message", "DSH 已运行，可选择人格并切换。"}};
    TargetSession session(current);
    auto state = control(*session.client, assets_, "status");
    if (!state.value("active", false) && !candidate_.is_null()) state["phase"] = "ready";
    return present(state);
}
Json Controller::discover(Cdp& client, const Host& current, bool force) {
    auto state = control(client, assets_, "status");
    bool cacheHit = false;
    if (state.value("active", false)) candidate_ = state.at("candidate");
    else {
        auto report = discoverRuntime(client, current, assets_, force);
        candidate_ = report.at("candidate"); cacheHit = report.value("cacheHit", false);
        state = {{"phase", "ready"}, {"appliedRequests", 0}, {"skippedRequests", 0}};
    }
    inspect_ = true;
    location_ = {{"module", candidate_["url"]}, {"exportName", candidate_["exportName"]},
        {"methodName", candidate_["methodName"]}, {"cacheHit", cacheHit}};
    return present(state);
}
Json Controller::discover() {
    auto current = host(); TargetSession session(current);
    try { return discover(*session.client, current, true); }
    catch (const std::exception& error) {
        candidate_ = nullptr; location_ = nullptr;
        return {{"connected", true}, {"phase", "unsupported"}, {"message", error.what()}};
    }
}
Json Controller::apply(const Persona& persona) {
    auto current = host(); TargetSession session(current);
    if (candidate_.is_null()) discover(*session.client, current, false);
    auto result = control(*session.client, assets_, "apply", {{"name", utf8(persona.name)}, {"text", persona.text}, {"candidate", candidate_}});
    inspect_ = true; return present(result);
}
Json Controller::reset() {
    auto current = host(); TargetSession session(current);
    auto result = control(*session.client, assets_, "reset"); inspect_ = false;
    return present(result);
}
Json Controller::selfTest() {
    if (fingerprint("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        throw std::runtime_error("本机摘要验证失败。");
    auto personas = assets_.loadPersonas();
    if (personas.empty()) throw std::runtime_error("未找到人格文件。");
    Json result = {{"ok", true}, {"implementation", "native-cpp-win32"}, {"personaCount", personas.size()},
        {"bundledPython", false}, {"bundledNode", false}, {"status", status()}};
    if (result["status"].value("connected", false)) {
        result["discovery"] = discover();
        if (result["discovery"].value("phase", "") == "unsupported") result["ok"] = false;
    }
    return result;
}
Json Controller::fixtureTest(const Host& fixture) {
    TargetSession session(fixture);
    auto report = discoverRuntime(*session.client, fixture, assets_, true);
    auto candidate = report.at("candidate");
    auto cached = discoverRuntime(*session.client, fixture, assets_, false);
    if (!cached.value("cacheHit", false) || cached.at("candidate") != candidate)
        throw std::runtime_error("定位缓存核验失败。");
    try {
        auto state = control(*session.client, assets_, "apply", {{"name", "C++验证"}, {"text", "只改变表达方式。"}, {"candidate", candidate}});
        if (state.value("phase", "") != "armed") throw std::runtime_error("人格未进入就绪状态。");
        auto after = control(*session.client, assets_, "reset");
        if (after.value("active", true)) throw std::runtime_error("人格未恢复标准。");
        auto checks = session.client->evaluate("runPersonaFixture(" + candidate.dump() + ")");
        control(*session.client, assets_, "reset");
        return {{"ok", true}, {"candidate", candidate}, {"checks", checks}, {"cacheHit", true}};
    } catch (...) {
        try { control(*session.client, assets_, "reset"); } catch (...) {}
        throw;
    }
}
}
