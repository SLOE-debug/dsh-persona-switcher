"""Chinese Tkinter interface; connection and persona changes belong to the controller."""

from collections.abc import Callable
from queue import Empty, Queue
from threading import Thread
import tkinter as tk
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText
from typing import Any, Protocol

from persona_store import Persona, PersonaStore, PersonaStoreError
from status_text import render_status


STATUS_REFRESH_MS = 6000


class Controller(Protocol):
    store: PersonaStore

    def status(self) -> dict[str, Any]: ...

    def discover(self) -> dict[str, Any]: ...

    def apply(self, name: str, text: str) -> dict[str, Any]: ...

    def reset(self) -> dict[str, Any]: ...


class PersonaWindow:
    """Run blocking controller calls on one daemon thread at a time."""

    def __init__(self, root: tk.Tk, controller: Controller):
        self.root = root
        self.controller = controller
        self.personas: dict[str, Persona] = {}
        self.results: Queue[tuple[str, dict[str, Any] | None, str | None]] = Queue()
        self.busy = False
        self.closed = False
        self.poll_enabled = False
        self.refresh_timer: str | None = None
        self.connection = tk.StringVar(value="尚未检查连接")
        self.discovery = tk.StringVar(value="识别入口：尚无结果")
        self.request_counts = tk.StringVar(value="实际请求命中：尚无统计    跳过请求：尚无统计")
        self.skip_reason = tk.StringVar(value="最近跳过原因：暂无")
        self.feedback = tk.StringVar(value="请选择人格；启动时不会自动应用。")
        self.selection = tk.StringVar()
        self._build()
        self._reload_personas()
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(100, self._poll_results)
        self.root.after(150, self._refresh_connection)

    def _build(self) -> None:
        self.root.title("DSH 人格切换器")
        self.root.geometry("920x800")
        self.root.minsize(780, 680)
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        style = ttk.Style(self.root)
        style.configure("TLabel", font=("Microsoft YaHei UI", 10))
        style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=(10, 5))
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 16, "bold"))

        outer = ttk.Frame(self.root, padding=20)
        outer.grid(row=0, column=0, sticky="nsew")
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(4, weight=1)
        ttk.Label(outer, text="DSH 人格切换器", style="Title.TLabel").grid(
            row=0, column=0, sticky="w", pady=(0, 12)
        )

        status_row = ttk.Frame(outer)
        status_row.grid(row=1, column=0, sticky="ew", pady=(0, 15))
        status_row.columnconfigure(0, weight=1)
        self.summary_label = ttk.Label(
            status_row, textvariable=self.connection, wraplength=510
        )
        self.summary_label.grid(
            row=0, column=0, sticky="w", padx=(0, 10)
        )
        self.status_button = ttk.Button(
            status_row, text="刷新状态", command=self._refresh_connection
        )
        self.status_button.grid(row=0, column=1)
        self.discover_button = ttk.Button(
            status_row, text="重新识别入口", command=self._discover_entry
        )
        self.discover_button.grid(row=0, column=2, padx=(8, 0))
        self.detail_labels = []
        for row, variable in enumerate(
            (self.discovery, self.request_counts, self.skip_reason), start=1
        ):
            label = ttk.Label(
                status_row,
                textvariable=variable,
                wraplength=820,
                justify="left",
                foreground="#555555",
            )
            label.grid(row=row, column=0, columnspan=3, sticky="w", pady=(6, 0))
            self.detail_labels.append(label)

        selector_row = ttk.Frame(outer)
        selector_row.grid(row=2, column=0, sticky="ew")
        selector_row.columnconfigure(1, weight=1)
        ttk.Label(selector_row, text="选择人格").grid(row=0, column=0, padx=(0, 12))
        self.selector = ttk.Combobox(
            selector_row, textvariable=self.selection, state="readonly", width=30
        )
        self.selector.grid(row=0, column=1, sticky="ew")
        self.selector.bind("<<ComboboxSelected>>", self._show_preview)
        ttk.Label(outer, text="人格文件预览（只读）").grid(
            row=3, column=0, sticky="w", pady=(16, 6)
        )
        self.preview = ScrolledText(
            outer,
            wrap="word",
            font=("Microsoft YaHei UI", 10),
            padx=12,
            pady=10,
            relief="solid",
            borderwidth=1,
            height=16,
            state="disabled",
        )
        self.preview.grid(row=4, column=0, sticky="nsew")

        actions = ttk.Frame(outer)
        actions.grid(row=5, column=0, sticky="ew", pady=(14, 0))
        actions.columnconfigure(2, weight=1)
        self.apply_button = ttk.Button(
            actions, text="切换人格", command=self._apply_selected
        )
        self.apply_button.grid(row=0, column=0, padx=(0, 8))
        self.reset_button = ttk.Button(
            actions, text="恢复标准", command=self._reset_persona
        )
        self.reset_button.grid(row=0, column=1)
        self.reload_button = ttk.Button(
            actions, text="刷新列表", command=self._reload_personas
        )
        self.reload_button.grid(row=0, column=3, padx=(8, 8))
        self.folder_button = ttk.Button(
            actions, text="打开人格文件夹", command=self._open_folder
        )
        self.folder_button.grid(row=0, column=4)

        self.feedback_label = ttk.Label(
            outer, textvariable=self.feedback, wraplength=750, justify="left"
        )
        self.feedback_label.grid(row=6, column=0, sticky="ew", pady=(14, 4))
        self.footer_label = ttk.Label(
            outer,
            text="启动和预览不会注入人格。切换后等待下一次请求，实际命中数增加才表示请求已使用人格。",
            foreground="#555555",
            wraplength=750,
        )
        self.footer_label.grid(row=7, column=0, sticky="w")
        outer.bind("<Configure>", self._resize_text)

    def _resize_text(self, event: Any) -> None:
        width = max(280, event.width - 8)
        self.summary_label.configure(wraplength=max(260, width - 275))
        for label in (*self.detail_labels, self.feedback_label, self.footer_label):
            label.configure(wraplength=width)

    def _set_feedback(self, message: str, *, error: bool = False) -> None:
        self.feedback.set(message)
        self.feedback_label.configure(foreground="#b42318" if error else "#333333")

    def _reload_personas(self) -> None:
        previous = self.selection.get()
        try:
            personas = self.controller.store.list_personas()
        except PersonaStoreError as exc:
            self.personas = {}
            self.selector.configure(values=())
            self.selection.set("")
            self._show_preview()
            self._set_feedback(str(exc), error=True)
            self._update_controls()
            return
        self.personas = {persona.name: persona for persona in personas}
        names = list(self.personas)
        self.selector.configure(values=names)
        selected = previous if previous in self.personas else "可爱"
        if selected not in self.personas:
            selected = names[0] if names else ""
        self.selection.set(selected)
        self._show_preview()
        if not names:
            self._set_feedback(
                "还没有人格文件。请打开人格文件夹，添加 UTF-8 编码的 .md 文件后刷新列表。"
            )
        elif previous:
            self._set_feedback("人格列表已刷新。预览内容尚未应用。")
        self._update_controls()

    def _show_preview(self, _event: Any = None) -> None:
        persona = self.personas.get(self.selection.get())
        text = persona.text if persona is not None else "这里会显示选中人格的 Markdown 内容。"
        self.preview.configure(state="normal")
        self.preview.delete("1.0", "end")
        self.preview.insert("1.0", text)
        self.preview.configure(state="disabled")
        self.preview.yview_moveto(0)

    def _update_controls(self) -> None:
        state = "disabled" if self.busy else "normal"
        for button in (
            self.status_button,
            self.discover_button,
            self.reset_button,
            self.reload_button,
            self.folder_button,
        ):
            button.configure(state=state)
        self.apply_button.configure(
            state="normal" if self.personas and not self.busy else "disabled"
        )
        self.selector.configure(state="disabled" if self.busy else "readonly")

    def _start_operation(
        self,
        operation: str,
        action: Callable[[], dict[str, Any]],
        pending: str | None,
    ) -> None:
        if self.busy or self.closed:
            return
        self.busy = True
        self._update_controls()
        if pending is not None:
            self._set_feedback(pending)

        def worker() -> None:
            try:
                result = action()
                if (
                    not isinstance(result, dict)
                    or not isinstance(result.get("message"), str)
                    or not isinstance(result.get("connected"), bool)
                ):
                    raise RuntimeError("服务返回了无法识别的结果。请刷新状态后重试。")
                self.results.put((operation, result, None))
            except Exception as exc:
                self.results.put(
                    (operation, None, str(exc) or "请求未完成。请刷新状态后重试。")
                )

        Thread(target=worker, name=f"persona-{operation}", daemon=True).start()

    def _refresh_connection(self) -> None:
        self._start_operation("status", self.controller.status, "正在检查 DSH 状态…")

    def _discover_entry(self) -> None:
        self._enable_polling()
        self._start_operation(
            "discover", self.controller.discover, "正在扫描并核验 DSH 请求入口…"
        )

    def _apply_selected(self) -> None:
        persona = self.personas.get(self.selection.get())
        if persona is None:
            self._set_feedback("请先选择一个人格。", error=True)
            return
        self._enable_polling()
        self._start_operation(
            "apply",
            lambda: self.controller.apply(persona.name, persona.text),
            f"正在切换为“{persona.name}”…",
        )

    def _reset_persona(self) -> None:
        self._start_operation("reset", self.controller.reset, "正在恢复标准人格…")

    def _enable_polling(self) -> None:
        self.poll_enabled = True
        if self.refresh_timer is None:
            self.refresh_timer = self.root.after(STATUS_REFRESH_MS, self._auto_refresh)

    def _stop_polling(self) -> None:
        self.poll_enabled = False
        if self.refresh_timer is not None:
            self.root.after_cancel(self.refresh_timer)
            self.refresh_timer = None

    def _auto_refresh(self) -> None:
        self.refresh_timer = None
        if self.closed or not self.poll_enabled:
            return
        if not self.busy:
            self._start_operation("poll", self.controller.status, None)
        self.refresh_timer = self.root.after(STATUS_REFRESH_MS, self._auto_refresh)

    def _open_folder(self) -> None:
        try:
            self.controller.store.open_folder()
        except PersonaStoreError as exc:
            self._set_feedback(str(exc), error=True)

    def _poll_results(self) -> None:
        if self.closed:
            return
        try:
            while True:
                operation, result, error = self.results.get_nowait()
                self.busy = False
                self._update_controls()
                if error is not None:
                    self._set_feedback(error, error=True)
                    if operation in ("status", "poll"):
                        self.connection.set("无法连接 DSH，请查看下方说明。")
                    continue
                if result is not None:
                    display = render_status(result)
                    self.connection.set(display.summary)
                    self.discovery.set(display.discovery)
                    self.request_counts.set(display.requests)
                    self.skip_reason.set(display.skipped)
                    self._set_feedback(
                        result["message"],
                        error=not result["connected"] or result.get("phase") == "unsupported",
                    )
                    if operation == "reset":
                        self._stop_polling()
        except Empty:
            pass
        self.root.after(100, self._poll_results)

    def _close(self) -> None:
        self._stop_polling()
        self.closed = True
        self.root.destroy()


def run_app(controller: Controller) -> None:
    """Open the window; initial connection inspection performs no persona changes."""
    root = tk.Tk()
    PersonaWindow(root, controller)
    root.mainloop()
