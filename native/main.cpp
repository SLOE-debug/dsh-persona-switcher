#include "gui.hpp"
#include <commctrl.h>
#include <shellapi.h>
#include <objbase.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    using namespace dsh;
    CoInitializeSecurity(nullptr, -1, nullptr, nullptr, RPC_C_AUTHN_LEVEL_DEFAULT,
        RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);
    INITCOMMONCONTROLSEX controls{sizeof(controls), ICC_STANDARD_CLASSES}; InitCommonControlsEx(&controls);
    SetProcessDPIAware();
    int count{}; auto arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    std::vector<std::wstring> args;
    if (arguments) { for (int i = 0; i < count; ++i) args.emplace_back(arguments[i]); LocalFree(arguments); }
    fs::path report;
    bool test = args.size() > 1 && (args[1] == L"--self-test" || args[1] == L"--fixture-test");
    try {
        if (test) {
            if (args[1] == L"--self-test" && args.size() == 3) report = args[2];
            else if (args[1] == L"--fixture-test" && args.size() == 7) report = args[6];
            else throw std::runtime_error("测试参数无效。");
            Controller controller;
            Json result;
            if (args[1] == L"--self-test") result = controller.selfTest();
            else {
                Host host; host.pid = std::stoul(args[2]); host.executable = args[3];
                host.entries = {args[4]}; host.roots = {args[5]}; result = controller.fixtureTest(host);
            }
            writeFile(report, result.dump(2)); return result.value("ok", false) ? 0 : 1;
        }
        return runGui(instance, show);
    } catch (const std::exception& error) {
        if (test) { if (!report.empty()) { try { writeFile(report, Json{{"ok", false}, {"error", error.what()}}.dump(2)); } catch (...) {} } }
        else MessageBoxW(nullptr, wide(error.what()).c_str(), L"DSH 人格切换器", MB_OK | MB_ICONERROR);
        return 1;
    }
}
