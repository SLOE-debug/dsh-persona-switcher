#include "gui.hpp"
#include <commctrl.h>
#include <shellapi.h>
#include <thread>
#include <memory>
#include <algorithm>

namespace dsh {
namespace {
constexpr UINT completed = WM_APP + 1;
enum Id { choice = 100, apply, reset, discover, refresh, folder, status };
struct Result { Json value; std::wstring error; int action; };
class Window {
    HWND window_{}, combo_{}, preview_{}, state_{}, details_{}, heading_{};
    HFONT font_{};
    std::vector<HWND> buttons_;
    std::vector<Persona> personas_;
    Controller controller_;
    bool busy_{}, closing_{}, polling_{};
    std::thread worker_;
    HWND child(const wchar_t* type, const wchar_t* text, DWORD style, int id = 0) {
        auto handle = CreateWindowExW(0, type, text, WS_CHILD | WS_VISIBLE | style,
            0, 0, 0, 0, window_, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), nullptr, nullptr);
        if (!handle) throw std::runtime_error("无法创建窗口控件。");
        SendMessageW(handle, WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
        return handle;
    }
    void layout() {
        RECT r{}; GetClientRect(window_, &r); int w = r.right, h = r.bottom;
        MoveWindow(heading_, 20, 16, w - 40, 26, TRUE);
        MoveWindow(combo_, 20, 50, w - 40, 280, TRUE);
        MoveWindow(preview_, 20, 88, w - 40, std::max(110, h - 352), TRUE);
        int y = h - 250, gap = 8, bw = (w - 56) / 3;
        for (size_t i = 0; i < buttons_.size(); ++i)
            MoveWindow(buttons_[i], 20 + static_cast<int>(i % 3) * (bw + gap), y + static_cast<int>(i / 3) * 42, bw, 34, TRUE);
        MoveWindow(state_, 20, h - 156, w - 40, 49, TRUE);
        MoveWindow(details_, 20, h - 105, w - 40, 87, TRUE);
    }
    void preview() {
        auto index = SendMessageW(combo_, CB_GETCURSEL, 0, 0);
        SetWindowTextW(preview_, index >= 0 && static_cast<size_t>(index) < personas_.size() ? wide(personas_[index].text).c_str() : L"请在人格文件夹内添加 UTF-8 编码的 .md 文件。");
    }
    void reload() {
        auto previous = SendMessageW(combo_, CB_GETCURSEL, 0, 0);
        std::wstring name = previous >= 0 && static_cast<size_t>(previous) < personas_.size() ? personas_[previous].name : L"可爱";
        auto loaded = controller_.assets().loadPersonas();
        personas_ = std::move(loaded); SendMessageW(combo_, CB_RESETCONTENT, 0, 0);
        int selected = 0;
        for (size_t i = 0; i < personas_.size(); ++i) {
            SendMessageW(combo_, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(personas_[i].name.c_str()));
            if (personas_[i].name == name) selected = static_cast<int>(i);
        }
        SendMessageW(combo_, CB_SETCURSEL, selected, 0); preview();
    }
    void enable(bool enabled) {
        for (auto button : buttons_) EnableWindow(button, enabled);
        EnableWindow(combo_, enabled);
    }
    void start(int action) {
        if (busy_) return;
        auto index = SendMessageW(combo_, CB_GETCURSEL, 0, 0);
        if (action == Id::apply && (index < 0 || static_cast<size_t>(index) >= personas_.size())) {
            MessageBoxW(window_, L"请先添加并选择一个人格。", L"DSH 人格切换器", MB_OK | MB_ICONINFORMATION); return;
        }
        std::optional<Persona> selected;
        if (action == Id::apply) {
            selected = personas_[index];
            selected->text = readFile(selected->path, 65536);
            if (selected->text.starts_with("\xef\xbb\xbf")) selected->text.erase(0, 3);
            wide(selected->text);
            if (selected->text.find_first_not_of(" \r\n\t") == std::string::npos) throw std::runtime_error("人格文件为空。");
        }
        if (worker_.joinable()) worker_.join();
        busy_ = true; enable(false);
        SetWindowTextW(state_, action == Id::apply ? L"正在识别入口并切换人格……" : action == Id::discover ? L"正在扫描并核验运行中的请求入口……" : L"正在读取 DSH 状态……");
        worker_ = std::thread([this, action, selected] {
            auto result = std::make_unique<Result>(); result->action = action;
            try {
                if (action == Id::apply) result->value = controller_.apply(*selected);
                else if (action == Id::reset) result->value = controller_.reset();
                else if (action == Id::discover) result->value = controller_.discover();
                else result->value = controller_.status();
            } catch (const std::exception& e) { result->error = wide(e.what()); }
            if (PostMessageW(window_, completed, 0, reinterpret_cast<LPARAM>(result.get()))) result.release();
        });
    }
    void finish(Result* raw) {
        std::unique_ptr<Result> result(raw);
        if (worker_.joinable()) worker_.join(); busy_ = false;
        if (closing_) { DestroyWindow(window_); return; }
        enable(true);
        if (!result->error.empty()) {
            SetWindowTextW(state_, result->error.c_str());
            SetWindowTextW(details_, L"本次操作未完成，请检查 DSH 是否已加载聊天界面。") ;
            if (result->action != Id::status) MessageBoxW(window_, result->error.c_str(), L"操作未完成", MB_OK | MB_ICONWARNING);
        } else {
            const auto& state = result->value;
            auto label = wide(state.value("message", "状态已更新。"));
            if (state.value("active", false)) label += L"\r\n当前人格：" + wide(state.value("persona", ""));
            SetWindowTextW(state_, label.c_str());
            std::wstring details = L"请求命中：" + std::to_wstring(state.value("appliedRequests", 0)) + L"    跳过：" + std::to_wstring(state.value("skippedRequests", 0));
            if (state.contains("lastSkipReason") && state["lastSkipReason"].is_string()) details += L"    原因：" + wide(state["lastSkipReason"].get<std::string>());
            if (state.contains("discovery")) {
                auto location = state["discovery"];
                details += L"\r\n入口：" + wide(location.value("exportName", "")) + L"." + wide(location.value("methodName", ""));
                details += L"\r\n" + wide(location.value("module", ""));
            } else details += L"\r\n关闭切换器会保留当前人格；DSH 重启后请重新切换。";
            SetWindowTextW(details_, details.c_str());
            if ((result->action == Id::apply || result->action == Id::discover) && state.value("phase", "") != "unsupported") polling_ = true;
            if (!state.value("connected", false) || state.value("phase", "") == "connected") polling_ = false;
        }
        if (result->action == Id::reset) polling_ = false;
        if (polling_) SetTimer(window_, 1, 6000, nullptr); else KillTimer(window_, 1);
    }
public:
    LRESULT dispatch(UINT message, WPARAM w, LPARAM l) {
        switch (message) {
        case WM_CREATE: {
            font_ = CreateFontW(-16, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");
            heading_ = child(L"STATIC", L"选择人格 · 仅对运行中的 DSH 临时生效", 0);
            combo_ = child(WC_COMBOBOXW, L"", CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP, Id::choice);
            preview_ = child(L"EDIT", L"", WS_BORDER | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL | WS_VSCROLL);
            for (const auto& item : std::vector<std::pair<int, const wchar_t*>>{{Id::apply, L"切换人格"}, {Id::reset, L"恢复标准"}, {Id::discover, L"重新识别入口"}, {Id::refresh, L"刷新列表"}, {Id::folder, L"打开人格文件夹"}, {Id::status, L"刷新状态"}})
                buttons_.push_back(child(L"BUTTON", item.second, WS_TABSTOP | BS_PUSHBUTTON, item.first));
            state_ = child(L"STATIC", L"", 0);
            details_ = child(L"EDIT", L"", ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL | WS_VSCROLL);
            reload(); layout(); start(Id::status); return 0;
        }
        case WM_SIZE: layout(); return 0;
        case WM_GETMINMAXINFO: reinterpret_cast<MINMAXINFO*>(l)->ptMinTrackSize = {650, 580}; return 0;
        case WM_COMMAND:
            if (LOWORD(w) == Id::choice && HIWORD(w) == CBN_SELCHANGE) preview();
            else if (HIWORD(w) == BN_CLICKED) {
                if (LOWORD(w) == Id::refresh) reload();
                else if (LOWORD(w) == Id::folder) ShellExecuteW(window_, L"open", controller_.assets().personas.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                else start(LOWORD(w));
            }
            return 0;
        case WM_TIMER: if (polling_ && !busy_) start(Id::status); return 0;
        case completed: finish(reinterpret_cast<Result*>(l)); return 0;
        case WM_CLOSE:
            KillTimer(window_, 1);
            if (busy_) { closing_ = true; ShowWindow(window_, SW_HIDE); }
            else DestroyWindow(window_);
            return 0;
        case WM_DESTROY: PostQuitMessage(0); return 0;
        }
        return DefWindowProcW(window_, message, w, l);
    }
    static LRESULT CALLBACK procedure(HWND hwnd, UINT message, WPARAM w, LPARAM l) {
        Window* self = reinterpret_cast<Window*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        if (message == WM_NCCREATE) {
            self = static_cast<Window*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);
            self->window_ = hwnd; SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        }
        if (!self) return DefWindowProcW(hwnd, message, w, l);
        try { return self->dispatch(message, w, l); }
        catch (const std::exception& e) {
            MessageBoxW(hwnd, wide(e.what()).c_str(), L"DSH 人格切换器", MB_OK | MB_ICONERROR);
            return message == WM_CREATE ? -1 : 0;
        }
    }
    int run(HINSTANCE instance, int show) {
        WNDCLASSEXW type{sizeof(type)}; type.hInstance = instance; type.lpfnWndProc = procedure;
        type.lpszClassName = L"DSHPersonaNative"; type.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        type.hIcon = LoadIconW(nullptr, IDI_APPLICATION); type.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
        RegisterClassExW(&type);
        auto hwnd = CreateWindowExW(0, type.lpszClassName, L"DSH 人格切换器 · C++", WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT, CW_USEDEFAULT, 760, 700, nullptr, nullptr, instance, this);
        if (!hwnd) throw std::runtime_error("无法创建主窗口。");
        ShowWindow(hwnd, show); UpdateWindow(hwnd);
        MSG message{};
        while (GetMessageW(&message, nullptr, 0, 0) > 0) {
            if (!IsDialogMessageW(hwnd, &message)) { TranslateMessage(&message); DispatchMessageW(&message); }
        }
        return static_cast<int>(message.wParam);
    }
    ~Window() { if (worker_.joinable()) worker_.join(); if (font_) DeleteObject(font_); }
};
}
int runGui(HINSTANCE instance, int show) { Window window; return window.run(instance, show); }
}
