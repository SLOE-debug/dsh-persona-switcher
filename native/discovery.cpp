#include "discovery.hpp"
#include <map>
#include <algorithm>

namespace dsh {
Json control(Cdp& client, const Assets& assets, const std::string& action, Json fields) {
    fields["action"] = action;
    return client.evaluate(requireExpression(assets.folder / L"runtime_patch.mjs") + ".control(" + fields.dump() + ")");
}
static std::optional<Json> verifyLive(Cdp& client, const Assets& assets, const Json& candidate) {
    auto expression = requireExpression(assets.folder / L"runtime_target.mjs") + ".resolveTarget(" + candidate.dump() + ").then(x=>x.prototype)";
    auto prototype = client.evaluate(expression, false);
    if (!prototype.contains("objectId")) throw std::runtime_error("候选入口没有可检查的原型。");
    std::string objectId = prototype.at("objectId");
    std::string instances;
    try {
        auto objects = client.call("Runtime.queryObjects", {{"prototypeObjectId", objectId}});
        instances = objects.at("objects").at("objectId");
        auto proof = Cdp::returned(client.call("Runtime.callFunctionOn", {{"objectId", instances}, {"returnByValue", true},
            {"functionDeclaration", R"JS(function() {
                let live=0;
                for(let i=0;i<Math.min(this.length,32);i++) {
                    const r=this[i];
                    if(typeof r.ctx?.get!=='function') continue;
                    if(typeof r.ctx.get('agents')?.get==='function' &&
                       typeof r.ctx.get('sessionProjections')?.stateOf==='function') live++;
                }
                return {instances:this.length,verifiedInstances:live};
            })JS"}}));
        client.call("Runtime.releaseObject", {{"objectId", instances}});
        client.call("Runtime.releaseObject", {{"objectId", objectId}});
        if (!proof.value("verifiedInstances", 0)) return std::nullopt;
        return proof;
    } catch (...) {
        try { if (!instances.empty()) client.call("Runtime.releaseObject", {{"objectId", instances}}); } catch (...) {}
        try { client.call("Runtime.releaseObject", {{"objectId", objectId}}); } catch (...) {}
        throw;
    }
}
static bool allowed(const std::string& url, const Host& host) {
    auto file = urlFile(url); if (!file) return false;
    auto suffix = file->extension().wstring();
    std::transform(suffix.begin(), suffix.end(), suffix.begin(), towlower);
    if (suffix != L".js" && suffix != L".mjs" && suffix != L".cjs") return false;
    for (const auto& root : host.roots) if (within(root, *file)) return true;
    return false;
}
static std::string methodSource(const std::string& source, const Json& candidate) {
    auto text = wide(source);
    size_t start = candidate.at("methodStart"), end = candidate.at("methodEnd");
    if (start > end || end > text.size()) throw std::runtime_error("函数源码范围无效。");
    return utf8(text.substr(start, end - start));
}
Json discoverRuntime(Cdp& client, const Host& host, const Assets& assets, bool force) {
    std::map<std::string, Json> scripts;
    std::string generationError;
    client.event = [&](const Json& event) {
        if (event.value("method", "") != "Debugger.scriptParsed") return;
        const auto& script = event.at("params"); auto url = script.value("url", "");
        if (!allowed(url, host)) return;
        auto previous = scripts.find(url);
        if (previous != scripts.end() && previous->second.value("hash", "") != script.value("hash", ""))
            generationError = "同一模块存在多个运行代次，请重启 DSH 后重新识别。";
        scripts[url] = script;
    };
    bool enabled = false;
    const std::string scannerKey = "local.dsh-persona.native.scanner";
    try {
        client.call("Debugger.enable", {{"maxScriptsCacheSize", 64 * 1024 * 1024}}); enabled = true;
        if (!generationError.empty()) throw std::runtime_error(generationError);
        if (scripts.size() > 4000) throw std::runtime_error("已加载模块超过扫描预算。");
        std::string bootstrap = "globalThis[Symbol.for(" + Json(scannerKey).dump() + ")] = (()=>{const module={exports:{}},exports=module.exports;";
        bootstrap += resource(101) + ";const parse=module.exports.parse;" + resource(102) + ";return scanSource;})()";
        client.evaluate("(" + bootstrap + ",true)");
        auto scan = [&](const std::string& source) {
            auto parsed = client.evaluate("globalThis[Symbol.for(" + Json(scannerKey).dump() + ")](" + Json(source).dump() + ")");
            if (parsed.contains("parseError")) throw std::runtime_error("相关模块语法暂不支持，未注入。");
            return parsed.at("candidates");
        };
        auto sourceOf = [&](const Json& script) -> std::string {
            return client.call("Debugger.getScriptSource", {{"scriptId", script.at("scriptId")}}).at("scriptSource");
        };
        auto cleanup = [&] {
            client.evaluate("delete globalThis[Symbol.for(" + Json(scannerKey).dump() + ")]");
            client.call("Debugger.disable"); enabled = false; client.event = {};
        };
        Json inventoryItems = Json::array();
        for (const auto& [url, script] : scripts) inventoryItems.push_back({url, script.value("hash", "")});
        auto inventory = fingerprint(inventoryItems.dump());
        std::string roots; for (const auto& root : host.roots) roots += utf8(normalizedPath(root)) + "\n";
        auto cacheFile = assets.cache / L"locations" / wide(fingerprint(roots) + ".json");
        if (!force && fs::exists(cacheFile)) {
            try {
                auto cached = Json::parse(readFile(cacheFile, 262144)); auto candidate = cached.at("candidate");
                std::string url = candidate.at("url");
                if (cached.value("inventory", "") == inventory && scripts.contains(url)) {
                    auto source = sourceOf(scripts[url]);
                    if (fingerprint(source) == candidate.value("sourceSha256", "")) {
                        int matches = 0;
                        for (const auto& found : scan(source)) if (found["exportName"] == candidate["exportName"] && found["methodName"] == candidate["methodName"] &&
                            fingerprint(methodSource(source, found)) == candidate["methodSha256"].get<std::string>()) ++matches;
                        if (matches == 1) if (auto proof = verifyLive(client, assets, candidate)) {
                            cleanup(); return {{"candidate", candidate}, {"cacheHit", true}, {"proof", *proof}};
                        }
                    }
                }
            } catch (const std::exception&) { /* A failed cache must be rediscovered and revalidated. */ }
        }
        std::vector<Json> candidates;
        size_t bytes = 0;
        for (const auto& [url, script] : scripts) {
            if (script.value("length", 0u) > 4 * 1024 * 1024) throw std::runtime_error("模块超过单文件扫描预算。");
            auto source = sourceOf(script); bytes += source.size();
            if (bytes > 48 * 1024 * 1024) throw std::runtime_error("运行代码超过扫描预算。");
            if (source.find("replayState") == std::string::npos || source.find("asyncIterator") == std::string::npos) continue;
            for (const auto& found : scan(source)) candidates.push_back({
                {"url", url}, {"exportName", found["exportName"]}, {"methodName", found["methodName"]},
                {"methodSha256", fingerprint(methodSource(source, found))}, {"sourceSha256", fingerprint(source)}, {"evidence", found["evidence"]}});
        }
        if (candidates.empty() || candidates.size() > 8) throw std::runtime_error("没有找到唯一可核验的请求入口。");
        std::vector<std::pair<Json, Json>> verified;
        for (const auto& candidate : candidates) {
            if (candidate["exportName"].is_null()) throw std::runtime_error("结构候选没有可访问的导出，未注入。");
            if (auto proof = verifyLive(client, assets, candidate)) verified.push_back({candidate, *proof});
        }
        if (verified.size() != 1) throw std::runtime_error("无法唯一确定活动请求入口，未注入。");
        auto [candidate, proof] = verified[0];
        if (candidates.size() == 1) {
            try { writeFile(cacheFile, Json{{"inventory", inventory}, {"candidate", candidate}}.dump()); } catch (...) {}
        }
        cleanup(); return {{"candidate", candidate}, {"cacheHit", false}, {"proof", proof}};
    } catch (...) {
        client.event = {};
        if (enabled) {
            try { client.evaluate("delete globalThis[Symbol.for(" + Json(scannerKey).dump() + ")]"); } catch (...) {}
            try { client.call("Debugger.disable"); } catch (...) {}
        }
        throw;
    }
}
}
