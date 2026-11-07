#include "../native/host_discovery.hpp"
#include <cassert>
#include <iostream>
#include <fstream>

using namespace dsh;
static ProcessInfo host(DWORD pid, const fs::path& install, DWORD parent = 0) {
    auto executable = install / L"任意名称.exe";
    auto entry = install / L"resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/main.js";
    return {pid, parent, executable, L"\"" + executable.wstring() + L"\" --expose-internals \"" + entry.wstring() + L"\"", L"start"};
}
int main() {
    auto product = [](const fs::path&) { return true; };
    auto moved = host(10, L"D:/自定义 目录/应用");
    auto selected = selectHosts({moved}, product);
    assert(selected.size() == 1 && selected[0].pid == 10);
    assert(selected[0].entries.size() == 1);
    assert(normalizedPath(selected[0].roots[0]) == normalizedPath(moved.exe.parent_path()));
    assert(selectHosts({moved}, [](const fs::path&) { return false; }).empty());

    auto renderer = moved; renderer.pid = 11; renderer.command += L" --type=renderer";
    auto unrelated = moved; unrelated.pid = 12;
    unrelated.command = L"engine.exe \"D:/tools/other.js\" \"" + selected[0].entries[0].wstring() + L"\"";
    auto child = host(13, moved.exe.parent_path(), moved.pid);
    selected = selectHosts({renderer, unrelated, child, moved}, product);
    assert(selected.size() == 1 && selected[0].pid == moved.pid);

    auto second = host(20, L"E:/Another Install");
    assert(selectHosts({moved, second}, product).size() == 2);
    auto selectedInstall = moved.exe.parent_path();
    auto explicitHost = selectHosts({moved, second}, [](const fs::path&) { return false; }, selectedInstall);
    assert(explicitHost.size() == 1 && explicitHost[0].pid == moved.pid);
    assert(selectHosts({moved}, product, fs::path(L"Z:/Other Install")).empty());
    assert(selectHosts({unrelated}, product, selectedInstall).empty());
    auto valuedOptions = moved;
    valuedOptions.command.insert(valuedOptions.command.find(L" --expose-internals"), L" --inspect-port 0 --require \"D:/tools/preload.js\"");
    assert(selectHosts({valuedOptions}, product).size() == 1);
    auto outside = moved; outside.exe = L"D:/Other/engine.exe";
    assert(selectHosts({outside}, product).empty());
    auto inaccessible = moved; inaccessible.command.clear();
    assert(selectHosts({inaccessible}, product).empty());

    // Real directories, including a relocated profile, come only from the host's arguments.
    wchar_t temporary[MAX_PATH]{}; GetTempPathW(MAX_PATH, temporary);
    auto profile = fs::path(temporary) / (L"dsh-host-test-" + std::to_wstring(GetCurrentProcessId()));
    fs::create_directory(profile);
    SetEnvironmentVariableW(L"DSH_PERSONA_INSTALL_ROOT", nullptr);
    assert(!installOverride());
    SetEnvironmentVariableW(L"DSH_PERSONA_INSTALL_ROOT", L"relative/path");
    bool rejected = false;
    try { installOverride(); } catch (const std::runtime_error&) { rejected = true; }
    assert(rejected);
    SetEnvironmentVariableW(L"DSH_PERSONA_INSTALL_ROOT", profile.c_str());
    rejected = false;
    try { installOverride(); } catch (const std::runtime_error&) { rejected = true; }
    assert(rejected);
    fs::create_directory(profile / L"resources");
    { std::ofstream archive(profile / L"resources/app.asar"); }
    assert(normalizedPath(*installOverride()) == normalizedPath(profile));
    SetEnvironmentVariableW(L"DSH_PERSONA_INSTALL_ROOT", nullptr);
    fs::remove(profile / L"resources/app.asar");
    fs::remove(profile / L"resources");
    moved.command += L" \"" + profile.wstring() + L"\" C:\\";
    selected = selectHosts({moved}, product);
    fs::remove(profile);
    assert(selected.size() == 1 && selected[0].roots.size() == 2);
    assert(normalizedPath(selected[0].roots[1]) == normalizedPath(profile));

    // A parent cycle must not hang discovery.
    moved.parent = 100;
    ProcessInfo cycle{100, 101}, cycleBack{101, 100};
    assert(selectHosts({moved, cycle, cycleBack}, product).size() == 1);
    assert(!isDeepSeekProduct(L"Z:/missing/application.exe"));
    std::cout << "Host discovery checks passed\n";
}
