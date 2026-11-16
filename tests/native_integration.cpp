#include "process_runner.hpp"
#include "../native/controller.hpp"
#include <iostream>

namespace dsh::testing {
static Json runCheck(const fs::path& executable, const std::wstring& mode, const fs::path& report,
    bool success = true, Environment environment = {}) {
    wchar_t system[32768]{}; GetSystemDirectoryW(system, 32768);
    environment[L"PATH"] = system;
    environment[L"NODE_OPTIONS"] = std::nullopt;
    environment[L"ELECTRON_RUN_AS_NODE"] = std::nullopt;
    ChildProcess child({executable.wstring(), mode, report.wstring()}, environment);
    auto exit = child.wait(); auto data = Json::parse(readFile(report));
    require((exit == 0) == success && data.value("ok", false) == success, "CLI check failed: " + data.dump());
    return data;
}
static Json runFixture(const Host& host, const fs::path& project, const std::string& module,
    const std::string& exportName = "LlmRuntime", const std::string& method = "forAdapter") {
    auto script = project / L"tests/runtime_fixture.mjs";
    ChildProcess child({host.executable.wstring(), script.wstring(), wide(module), wide(exportName), wide(method)},
        {{L"ELECTRON_RUN_AS_NODE", L"1"}, {L"NODE_OPTIONS", std::nullopt}});
    require(child.ready().value("pid", 0ul) == child.pid, "Fixture PID does not match");
    Host fixture{child.pid, L"controlled", host.executable, {script}, host.roots};
    Controller controller;
    auto result = controller.fixtureTest(fixture);
    require(result.value("ok", false) && result.value("cacheHit", false), "Native fixture/cache failed");
    require(result["checks"].value("checks", 0) >= 30 && result["checks"].value("passed", false), "Request contract checks failed");
    for (auto port : listeningPorts(child.pid)) {
        try {
            auto rows = Json::parse(httpGet(port, L"/json/list"));
            for (const auto& row : rows) require(row.value("type", "") != "node", "Temporary Inspector remained open");
        } catch (const std::runtime_error& e) {
            if (std::string(e.what()) == "Temporary Inspector remained open") throw;
        }
    }
    std::cout << "Controlled requests checked: " << result["checks"]["checks"] << '\n';
    return result;
}
void testIntegration(const fs::path& project, const fs::path& executable) {
    TempDirectory temp;
    auto emptyInstall = temp.path / L"empty-install";
    writeFile(emptyInstall / L"resources/app.asar", "empty controlled package");
    auto missing = runCheck(executable, L"--self-test", temp.path / L"missing.json", false,
        {{L"DSH_PERSONA_INSTALL_ROOT", emptyInstall.wstring()}});
    require(!missing["status"].value("connected", true), "Missing host self-test must fail");
    auto list = runCheck(executable, L"--list-hosts", temp.path / L"hosts.json");
    require(list["hosts"].size() == 1, "Open exactly one DSH host before running integration checks");
    auto self = runCheck(executable, L"--self-test", temp.path / L"live.json");
    require(self.contains("discovery") && self["discovery"].value("phase", "") != "unsupported", "Real runtime not discovered");
    require(self.value("personaCount", 0) == 1, "Release should contain only the retained persona");
    auto hosts = discoverHosts(); require(hosts.size() == 1, "Native host enumeration differs from CLI");
    const auto& location = self["discovery"]["discovery"];
    runFixture(hosts[0], project, location.at("module"), location.at("exportName"), location.at("methodName"));

    auto source = temp.path / L"中文目录/不固定模块名.mjs";
    auto original = readFile(project / L"tests/fixtures/runtime.mjs");
    original.replace(original.find("export class LlmRuntime"), std::string("export class LlmRuntime").size(), "class RenamedRuntime");
    original += "\nexport {RenamedRuntime as LlmRuntime};\n";
    writeFile(source, original);
    auto controlled = hosts[0]; controlled.roots = {temp.path};
    auto first = runFixture(controlled, project, fileUrl(source));
    original.replace(original.find("revision one"), std::string("revision one").size(), "revision two");
    writeFile(source, original);
    auto second = runFixture(controlled, project, fileUrl(source));
    require(first["candidate"]["methodSha256"] != second["candidate"]["methodSha256"], "Changed method must invalidate signature");
    require(first["candidate"]["sourceSha256"] != second["candidate"]["sourceSha256"], "Changed source must invalidate cache");
}
}
