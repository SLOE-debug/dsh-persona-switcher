#include "common.hpp"
#include <wbemidl.h>
#include <wrl/client.h>
#include <shellapi.h>
#include <iphlpapi.h>
#include <winsock2.h>
#include <map>
#include <set>
#include <algorithm>

namespace dsh {
using Microsoft::WRL::ComPtr;
struct Process { DWORD pid{}, parent{}; fs::path exe; std::wstring command, created; };
static std::wstring textProperty(IWbemClassObject* object, const wchar_t* key) {
    VARIANT value; VariantInit(&value); std::wstring result;
    if (SUCCEEDED(object->Get(key, 0, &value, nullptr, nullptr)) && value.vt == VT_BSTR && value.bstrVal) result = value.bstrVal;
    VariantClear(&value); return result;
}
static DWORD numberProperty(IWbemClassObject* object, const wchar_t* key) {
    VARIANT value; VariantInit(&value); DWORD result = 0;
    if (SUCCEEDED(object->Get(key, 0, &value, nullptr, nullptr)) && SUCCEEDED(VariantChangeType(&value, &value, 0, VT_UI4))) result = value.ulVal;
    VariantClear(&value); return result;
}
static std::vector<Process> processTable() {
    auto initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(initialized)) throw std::runtime_error("进程查询初始化失败。");
    struct Cleanup { ~Cleanup() { CoUninitialize(); } } cleanup;
    ComPtr<IWbemLocator> locator;
    if (FAILED(CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&locator)))) throw std::runtime_error("无法创建进程查询。");
    ComPtr<IWbemServices> service;
    BSTR scope = SysAllocString(L"ROOT\\CIMV2");
    auto hr = locator->ConnectServer(scope, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &service);
    SysFreeString(scope);
    if (FAILED(hr)) throw std::runtime_error("无法连接本机进程服务。");
    if (FAILED(CoSetProxyBlanket(service.Get(), RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
                               RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE)))
        throw std::runtime_error("无法设置本机进程查询权限。");
    ComPtr<IEnumWbemClassObject> rows;
    BSTR language = SysAllocString(L"WQL");
    BSTR query = SysAllocString(L"SELECT ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate FROM Win32_Process");
    hr = service->ExecQuery(language, query, WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, nullptr, &rows);
    SysFreeString(language); SysFreeString(query);
    if (FAILED(hr)) throw std::runtime_error("无法读取进程清单。");
    std::vector<Process> result;
    for (;;) {
        ComPtr<IWbemClassObject> object; ULONG count = 0;
        hr = rows->Next(5000, 1, &object, &count);
        if (FAILED(hr)) throw std::runtime_error("进程查询失败。");
        if (!count) break;
        auto exe = textProperty(object.Get(), L"ExecutablePath");
        if (exe.empty()) continue;
        result.push_back({numberProperty(object.Get(), L"ProcessId"), numberProperty(object.Get(), L"ParentProcessId"),
            exe, textProperty(object.Get(), L"CommandLine"), textProperty(object.Get(), L"CreationDate")});
    }
    return result;
}
std::vector<Host> discoverHosts() {
    auto install = localData() / L"Programs" / L"DSH Desktop";
    auto profile = roamingData() / L"dsh-desktop" / L"harness";
    auto table = processTable(); std::set<DWORD> owned;
    std::map<DWORD, DWORD> parents;
    for (const auto& row : table) {
        parents[row.pid] = row.parent;
        if (within(install, row.exe)) owned.insert(row.pid);
    }
    for (int i = 0; i < 4; ++i) for (const auto& row : table) if (owned.contains(row.parent)) owned.insert(row.pid);
    std::vector<Host> candidates, result;
    for (const auto& row : table) {
        if (!owned.contains(row.pid) || row.command.empty()) continue;
        int argc = 0; auto argv = CommandLineToArgvW(row.command.c_str(), &argc);
        if (!argv) continue;
        Host host{row.pid, row.created, row.exe, {}, {install, profile}};
        for (int i = 1; i < argc; ++i) {
            fs::path entry(argv[i]); auto ext = entry.extension().wstring();
            std::transform(ext.begin(), ext.end(), ext.begin(), towlower);
            if (entry.is_absolute() && (ext == L".js" || ext == L".mjs" || ext == L".cjs") &&
                (within(install, entry) || within(profile, entry))) host.entries.push_back(entry);
        }
        LocalFree(argv);
        if (!host.entries.empty()) candidates.push_back(std::move(host));
    }
    std::set<DWORD> ids; for (const auto& host : candidates) ids.insert(host.pid);
    for (const auto& host : candidates) {
        DWORD parent = parents[host.pid]; bool nested = false;
        for (int i = 0; i < 8 && parent; ++i) {
            if (ids.contains(parent)) { nested = true; break; }
            parent = parents[parent];
        }
        if (!nested) result.push_back(host);
    }
    return result;
}
std::vector<unsigned short> listeningPorts(DWORD pid) {
    ULONG size = 0;
    auto code = GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
    if (code != ERROR_INSUFFICIENT_BUFFER && code != NO_ERROR) throw std::runtime_error("无法读取监听端口。");
    std::vector<unsigned char> data;
    for (int i = 0; i < 3; ++i) {
        data.resize(size); code = GetExtendedTcpTable(data.data(), &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
        if (code == ERROR_INSUFFICIENT_BUFFER) continue;
        if (code) throw std::runtime_error("监听端口查询失败。");
        auto table = reinterpret_cast<PMIB_TCPTABLE_OWNER_PID>(data.data());
        std::vector<unsigned short> ports;
        for (DWORD index = 0; index < table->dwNumEntries; ++index) {
            const auto& row = table->table[index];
            if (row.dwOwningPid == pid && row.dwState == MIB_TCP_STATE_LISTEN && row.dwLocalAddr == htonl(INADDR_LOOPBACK))
                ports.push_back(ntohs(static_cast<unsigned short>(row.dwLocalPort)));
        }
        return ports;
    }
    throw std::runtime_error("端口清单正在变化，请重试。");
}
void activateInspector(DWORD pid) {
    // Node's Windows debug signal: invoke the handler address it explicitly publishes.
    auto name = L"node-debug-handler-" + std::to_wstring(pid);
    HANDLE mapping = OpenFileMappingW(FILE_MAP_READ, FALSE, name.c_str());
    if (!mapping) throw std::runtime_error("DSH 没有开放可用的 Node 调试入口。");
    auto view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, sizeof(void*));
    void* handler = view ? *static_cast<void**>(view) : nullptr;
    if (view) UnmapViewOfFile(view); CloseHandle(mapping);
    if (!handler) throw std::runtime_error("DSH 调试入口无效。");
    HANDLE process = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION |
                                 PROCESS_VM_WRITE | PROCESS_VM_READ, FALSE, pid);
    if (!process) throw std::runtime_error("无法连接 DSH，请使用相同的用户权限运行。");
    HANDLE thread = CreateRemoteThread(process, nullptr, 0, reinterpret_cast<LPTHREAD_START_ROUTINE>(handler), nullptr, 0, nullptr);
    CloseHandle(process);
    if (!thread) throw std::runtime_error("无法启动 DSH 的调试通信。");
    auto wait = WaitForSingleObject(thread, 10000); CloseHandle(thread);
    if (wait != WAIT_OBJECT_0) throw std::runtime_error("DSH 调试入口启动超时。");
}
}
