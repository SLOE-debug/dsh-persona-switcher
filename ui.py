"""Chinese Tkinter interface; connection and persona changes belong to the controller."""

from collections.abc import Callable
from queue import Empty, Queue
from threading import Thread
import tkinter as tk
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText
from typing import Any, Protocol

from persona_store import Persona, PersonaStore, PersonaStoreError


class Controller(Protocol):
    store: PersonaStore

    def status(self) -> dict[str, Any]: ...

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
        self.connection = tk.StringVar(value="尚未检查连接")
        self.feedback = tk.StringVar(value="请选择人格；启动时不会自动应用。")
        self.selection = tk.StringVar()
        self._build()
        self._reload_personas()
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(100, self._poll_results)
        self.root.after(150, self._refresh_connection)

    def _build(self) -> None:
        self.root.title("DSH 人格切换器")
        self.root.geometry("820x650")
        self.root.minsize(640, 500)
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
        ttk.Label(status_row, textvariable=self.connection, wraplength=590).grid(
            row=0, column=0, sticky="w", padx=(0, 10)
        )
        self.status_button = ttk.Button(
            status_row, text="刷新连接", command=self._refresh_connection
        )
        self.status_button.grid(row=0, column=1)

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
        ttk.Label(
            outer,
            text="人格只调整表达方式。选择或预览文件不会应用设置。",
            foreground="#555555",
            wraplength=750,
        ).grid(row=7, column=0, sticky="w")

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
        self, operation: str, action: Callable[[], dict[str, Any]], pending: str
    ) -> None:
        if self.busy or self.closed:
            return
        self.busy = True
        self._update_controls()
        self._set_feedback(pending)

        def worker() -> None:
            try:
                result = action()
                if not isinstance(result, dict) or not isinstance(result.get("message"), str):
                    raise RuntimeError("服务返回了无法识别的结果。请刷新连接后重试。")
                self.results.put((operation, result, None))
            except Exception as exc:
                self.results.put(
                    (operation, None, str(exc) or "请求未完成。请刷新连接后重试。")
                )

        Thread(target=worker, name=f"persona-{operation}", daemon=True).start()

    def _refresh_connection(self) -> None:
        self._start_operation("status", self.controller.status, "正在检查 DSH 连接…")

    def _apply_selected(self) -> None:
        persona = self.personas.get(self.selection.get())
        if persona is None:
            self._set_feedback("请先选择一个人格。", error=True)
            return
        self._start_operation(
            "apply",
            lambda: self.controller.apply(persona.name, persona.text),
            f"正在切换为“{persona.name}”…",
        )

    def _reset_persona(self) -> None:
        self._start_operation("reset", self.controller.reset, "正在恢复标准人格…")

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
                    if operation == "status":
                        self.connection.set("无法连接 DSH，请查看下方说明。")
                    continue
                if result is not None:
                    self._set_feedback(result["message"])
                    if "connected" in result:
                        self.connection.set("DSH 已连接" if result["connected"] else "DSH 未连接")
                    if operation == "status":
                        self.connection.set(result["message"])
        except Empty:
            pass
        self.root.after(100, self._poll_results)

    def _close(self) -> None:
        self.closed = True
        self.root.destroy()


def run_app(controller: Controller) -> None:
    """Open the window; initial connection inspection performs no persona changes."""
    root = tk.Tk()
    PersonaWindow(root, controller)
    root.mainloop()
