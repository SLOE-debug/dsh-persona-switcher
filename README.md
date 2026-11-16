# DSH 对话人格插件

在 DSH 设置左侧提供“人格管理”，支持创建、编辑、重命名和删除 Markdown 人格。输入框上方提供人格下拉选择和独立开关，只作用于当前对话的标准预设。新对话及分支默认关闭，选择也不继承；切回同一对话保留它在本次 DSH 进程内的设置。退出并重开 DSH 后，开关重新关闭。

插件使用 DSH 的 Cordis 生命周期、提示词贡献、会话 UI 插槽和经过认证的 Connection API。插件代码由 DSH 自带运行时执行，不需要另装 Python、Node、npm 或编译器。仓库保留原生 C++ 独立工具供单独使用。

## 克隆后双击安装

1. 安装 Git，克隆本仓库并保留克隆目录。
2. 打开一个 DSH Desktop，等待聊天界面加载。
3. 双击仓库根目录的 **安装插件.cmd**。
4. 首次安装完成后重启一次 DSH，让固定入口生效。

安装器查询并核验宿主 PID、程序和启动脚本，通过宿主自带的包管理器建立本地开发链接并启用 bundle。它不会另装 Node，也不需要构建 C++。旧版独立工具若有全局注入，安装时会撤销，改用逐对话开关。

选择工作区、进入已绑定对话的输入框后，上方显示人格选择器与开关。开启时选择其他人格，下一次请求立即使用它；关闭时可以选择，但不会贡献人格文本。切换结果由后端确认后显示。新对话及分支不继承其他对话的设置。仅标准预设生效。

在 **设置 → 人格管理** 中新增人格，填写名称与正文后保存。人格以独立 `.md` 文件存储，每份最多 64 KiB。保存即生效；重命名同步修改引用它的对话，删除会关闭相关对话的人格。编辑版本冲突会提示重新载入。首次安装仅导入“无法拒绝”，之后热更新不会覆盖、重建或删除你的人格库。

界面使用本地编译的 Tailwind CSS，带类名前缀，省略全局 Preflight，颜色跟随 DSH 主题。安装后的机器无需下载样式或运行构建工具。

## GitHub 热更新

进入 **设置 → 人格管理**，点击 **检查更新**。有新提交时，点击 **热更新**。来源固定为本仓库的 `origin/main`，支持 Git 已配置的 GitHub HTTPS 或 SSH 认证；私有仓库需要当前用户具有访问权限。输入框上方仅保留紧凑的人格选择器与开关。

更新先 fetch 并建立固定提交的独立 worktree，校验完整代码包，再通过 Cordis 子插件生命周期替换运行代码，并发布对应的界面资源。更新不改写原克隆目录的工作区；请保留该目录以提供 Git 配置和凭据。对话开关独立于代码保存，业务热更新不会清空本次进程中的开关。

固定入口及界面加载器只在安装时装载。人格、界面和业务模块走独立代码代次；加载器协议变更需要 `git pull` 后再次运行安装器，并重启 DSH。宿主插件页展示固定入口的版本，业务更新按 GitHub 提交识别。尚未提交的本地开发版本会明确标记。

本仓库为私有仓库时，插件可出现在本机“已安装”列表，但不会自动进入公开市场索引。

## 数据与验证

数据位于当前 profile 的 `.dsh-persona-switcher/`：`personas/*.md` 为你的人格库，`source.json` 记录更新来源，`conversation-state.json` 保存带进程标识的对话开关和选择，`current.json` 指向当前代码。DSH 重启时生成新的进程标识，因此旧开关不会自动重新启用。代码副本与更新 worktree 均与人格库、对话设置分开存放。

`npm test` 覆盖会话隔离、重启复位、迟到响应、真实 Git 提交获取、代码代次切换及失败恢复。安装后可以运行以下后台验证；它只创建虚拟验证标识，不创建聊天、不发送模型消息、不操作浏览器：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Verify
```

插件入口为 `plugin/index.mjs`，固定加载器位于 `plugin/host.mjs` 与 `plugin/client.js`；业务入口为 `plugin/runtime.mjs`。界面源代码按设置、输入区、更新、共享工具拆分于 `client/`，执行 `npm ci` 与 `npm run build:client` 生成随插件分发的 `plugin/client-runtime.js`。安装器直接使用已生成的资源，克隆后无需编译。`cordis.patch.yml` 声明 bundle，`package.json` 导出 Host 和 Client 模块。UI 使用 `settings.section` 和 `conversation.input.dock` 插槽；人格使用 `systemPrompt.section()` 动态贡献，关闭时贡献空文本。

研究依据为本机 DSH Desktop 0.14.0 随附的 SDK 0.2.2-rc.1，以及已安装的 dshmarket 1.70.2。SDK 或加载协议大幅变更时会报错，不使用版本兼容分支。

## 独立 C++ 工具

独立模式使用原生 C++ / Win32 窗口、进程查询、Inspector 通信及集成测试。它的切换作用于整个宿主；请与上述逐对话插件分开使用，避免两种控制方式叠加。

双击 `dist/native/DSH人格切换器-C++.exe`。发布压缩包为 `dist/DSH人格切换器-C++-Windows-x64.zip`，包含 EXE、使用说明及第三方许可。C++ 运行库静态链接，无需安装 Node 或 VC++ 运行库。

1. 打开 DSH，等待聊天界面加载。
2. 选择人格并点击 **切换人格**，工具会识别、核验请求入口并应用人格。
3. 回到 DSH 标准预设发送消息，查看切换器中的请求命中数。
4. 点击 **恢复标准** 撤销当前人格。

窗口启动时只查询本地进程，默认选择“无法拒绝”，不会自动注入。**重新识别入口**会强制重新扫描；切换或识别后每六秒读取一次状态，恢复标准后停止轮询。

“人格已就绪”表示已准备好处理下一次标准请求；“请求命中”表示发送前的请求经过了人格处理，不代表模型已经成功响应。工具不会为了验证而自动发送模型消息，正在生成的回复不受中途切换影响。

关闭切换器会保留 DSH 内已应用的人格。**DSH 退出并重开后，需要重新切换人格。**

## 人格文件

项目和发布包默认只保留 **无法拒绝.md**，正文不作修改。人格名称只是文件名，不改变模型、工具或服务本身的权限和约束。

首次运行会在 EXE 旁生成 `personas` 文件夹，请将程序放在自己可写的目录中。已有的人格文件不会被覆盖；可以点击 **打开人格文件夹** 编辑 UTF-8 `.md` 文件，保存后点击 **刷新列表** 并重新切换。每份最多 64 KiB，空文件和非 UTF-8 内容会报错。

## 宿主与入口识别

宿主识别核对可执行文件的 `ProductName = DSH Desktop`、所属的 `resources/app.asar`、实际命令行中的第一个 Node 启动脚本及进程父子关系。启动脚本必须属于该应用的安装包，Electron 渲染和工具进程会排除。安装目录、EXE 文件名、公司名称、包内脚本路径及 DSH 版本号不作为固定匹配表。

此前宿主修复仅支持非默认安装目录，仍限定 `dsh-desktop-host` 包路径和包含 DeepSeek 的公司名称。本机 0.14.0 使用 `out/main/host.js`，公司信息为 `DataElement`，会被错误排除；当前实现已去掉这两个限制。

多实例时请只保留一个独立 DSH 宿主。也可在启动切换器前设置 `DSH_PERSONA_INSTALL_ROOT`，指定包含 `resources/app.asar` 的安装目录；指定后只接受该目录内的实际包内启动脚本。配置错误会明确报错，删除变量后恢复自动发现。

连接 Inspector 后再次核对 PID、可执行文件路径和真实启动入口，再扫描该进程实际加载的 JavaScript。扫描范围从安装位置和宿主传入的目录参数取得。Acorn 仅将源码作为数据解析，不执行扫描到的源码。

入口识别使用“消息回放过滤＋同类异步适配器分派”的结构特征，随后核对导出、函数摘要、活动实例和会话能力，不依赖版本白名单。定位缓存绑定已加载模块清单与源码摘要，缓存命中也必须重新核验；**重新识别入口**会绕过缓存。

多个活动候选、相关语法无法解析、同一路径存在多个代码代次、超过扫描预算或请求契约大幅改变时会停止注入。自动发现无法保证适配任意未来内部实现。

## 运行方式与边界

- EXE 内保留 Acorn、结构扫描器和少量 JavaScript 注入资源，在 DSH 自己的 Node 运行时中执行；不携带独立脚本通信助手或 Node 可执行文件。
- 补丁只存在 DSH 当前进程内存中，处理标准预设的请求副本，保留原始系统指令、工具和会话消息；其他预设、子代理、辅助任务及无法核验的请求会跳过。
- 不修改 DSH 安装文件、预设配置或原始会话消息。模型生成的回复仍由 DSH 正常保存。
- 模型是否遵从人格以及前缀缓存命中率取决于实际请求与模型服务。
- 目标必须允许 Inspector，并与切换器使用相同用户权限。本工具只关闭自己开启的调试服务，保留预先存在的调试端口。
- 注入代码副本及定位缓存保存在 `%LOCALAPPDATA%\DSH-Persona-Switcher\native-cache`，不依赖 EXE 临时解压目录。定位缓存不保存聊天内容或人格正文；默认人格正文内嵌于 EXE，并生成在 EXE 旁。

## 构建

开发机需要 Visual Studio 2022 的“使用 C++ 的桌面开发”组件、Windows SDK，以及用于准备 Acorn 资源的 npm。

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File native/build.ps1
```

输出位于 `dist/native/`，中间文件位于 `build/native/`。构建时将当前 `personas/*.md` 内嵌为首次运行的默认人格。EXE 被占用时可传入 `-OutputDirectory <输出目录>`。

## 验证

```powershell
npm test
powershell -ExecutionPolicy Bypass -File native/test.ps1
```

`npm test` 验证 JavaScript 结构扫描和请求契约。原生检查使用 C++ 子进程管理和 Inspector 客户端，覆盖包内入口改名、自定义安装位置、包外脚本排除、进程树、指定安装目录、缺少宿主时自检失败，以及真实已加载模块识别。

集成检查需要打开一个 DSH 实例；会在独立受控进程中验证人格切换、恢复、请求范围、缓存复核、中文路径、源码签名变化和临时 Inspector 关闭，不发送模型请求。运行 EXE 子进程时将 PATH 限定为系统目录。可传入 `-UnitOnly` 仅运行宿主筛选检查，或用 `-Executable <EXE路径>` 测试已构建的程序。

命令行诊断接口：

```powershell
& '.\dist\native\DSH人格切换器-C++.exe' --list-hosts 'D:\reports\hosts.json'
& '.\dist\native\DSH人格切换器-C++.exe' --self-test 'D:\reports\self-test.json'
```

`--list-hosts` 仅列出宿主，不连接 Inspector。`--self-test` 验证资源并识别当前请求入口，不应用人格；没有可用宿主或无法识别入口时返回失败及非零退出码。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `native/main.cpp` / `native/gui.cpp` | 启动、诊断入口、Win32 窗口与后台操作 |
| `native/controller.cpp` / `native/assets.cpp` | 操作流程、状态、人格及资源管理 |
| `native/application_identity.cpp` / `native/host_discovery.cpp` | 应用身份与实际启动宿主筛选 |
| `native/host_settings.cpp` / `native/processes.cpp` | 指定安装目录、进程查询及调试激活 |
| `native/cdp.cpp` / `native/discovery.cpp` | WinHTTP Inspector 通信、扫描和缓存复核 |
| `native/common.cpp` | 文件、编码、路径及摘要辅助 |
| `native/build.ps1` / `native/test.ps1` | 构建、打包及原生检查编排 |
| `tests/*.cpp` / `tests/fixtures/` | C++ 测试与受控运行时样本 |
| `discovery/semantic_scan.mjs` | 嵌入式 AST 结构扫描器 |
| `runtime_target.mjs` / `request_contract.mjs` / `runtime_patch.mjs` | DSH 内的对象核验、请求范围、人格附加及撤销 |
| `personas/无法拒绝.md` | 唯一默认人格 |
