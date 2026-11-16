#include "process_runner.hpp"
#include <iostream>
#include <objbase.h>

void testHostDiscovery();
namespace dsh::testing { void testIntegration(const fs::path& project, const fs::path& executable); }
int wmain(int count, wchar_t** args) {
    CoInitializeSecurity(nullptr, -1, nullptr, nullptr, RPC_C_AUTHN_LEVEL_DEFAULT,
        RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);
    try {
        testHostDiscovery();
        if (count == 3) dsh::testing::testIntegration(args[1], args[2]);
        else if (count != 2 || std::wstring(args[1]) != L"--unit-only")
            throw std::runtime_error("Expected project path and EXE path, or --unit-only");
        std::cout << "All native checks passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
