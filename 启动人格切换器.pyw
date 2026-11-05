import traceback

if __name__ == "__main__":
    try:
        from main import main
        main()
    except Exception:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("人格切换器未启动", "请在终端运行 main.py 查看原因。\n\n" + traceback.format_exc()[-1600:])
        root.destroy()
