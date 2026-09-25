# Windows native maintenance track

目标：在不支持 WSL2 的 Windows 10/11 x64 上运行与上游同基线的 BotMux，并把每次升级成本限定为少量接入点复核和自动化验证。当前基线及候选版本由 `release.json` 固定。

## 设计

- `src/host/runtime.ts` 负责 Windows 可执行文件解析、MSYS 驱动器路径、PATHEXT、批处理启动及 PTY 进程树关闭。POSIX 路径保留原来的文件和权限检查语义。调用方只提交可执行文件和 argv。
- ConPTY 使用 node-pty 自带 DLL，避开系统控制台关闭后的 `AttachConsole` 竞态。node-pty 1.1.0 在退出时可能遗留 conout worker，本版在 host 层集中释放它；升级 node-pty 时必须复核这一处内部接口，并确认验证进程能自然结束。
- 复用上游 `PtyBackend`、内置 supervisor、持久化存储和 Task Scheduler。Windows 默认 PTY；POSIX 默认 tmux。显式配置仍有优先权。
- Windows 日志使用上游已有 `LogFileFollower`，无需安装 tail。
- `windows/` 管理独立 Node runtime 产物。上游 package.json、bun.lock、Bun 二进制发布链完全不变。node-pty 的 win32-x64 预编译模块随包提供，安装时不编译原生模块。
- 安装器验证文件 SHA-256 清单、Node >=22.13、实际 CLI 版本和真实 ConPTY；通过后复制到不可变版本目录，原子替换 `active.json`。失败保留入口。候选包可重复验证；同一版本号不同内容会拒绝安装。
- `botmux upgrade` 在 Windows 明确引导到此安装器，避免意外安装不含 Windows 运行时的官方 npm 元包。

这里不是能无条件套在任意上游上的插件。兼容适配仍需少量核心接入点；每次上游升级必须重建并通过 Windows 验证。长期可将 host 适配提交上游，再评估与其发布链一致的 `botmux-win32-x64` Bun 二进制。

## 构建

在独立 Linux checkout 使用 Bun 1.4.2，Node >=22.13：

```sh
bun install --frozen-lockfile
bun run build
bun run test -- test/windows/ test/executable.test.ts test/resolve-command-shell-parse.test.ts test/pty-backend-launch-shell.test.ts test/log-tail.test.ts test/autostart-standalone-path.test.ts
node windows/build.mjs --skip-build
tar -czf build/windows-native.tgz -C build/windows-native .
sha256sum build/windows-native.tgz
```

默认 `node windows/build.mjs` 会先执行完整上游构建。`--skip-build` 仅用于紧接着一次成功构建的流水线。不要一边构建一边打包。Windows 包是完整的 portable runtime 压缩包，**不是可交给 npm install 的 tgz**。它包含全部运行依赖和文件校验清单；不包含用户凭据、配置或 Node 本身。

`windows-manifest.json` 记录上游 ref/commit、源码 commit、跟踪文件 diff 哈希、runtime build ID 和每个文件的 SHA-256。发布前提交所有源码，以 sourceCommit 为追溯依据。压缩包整体 SHA-256 应经可信渠道与包一起交付；包内清单只校验完整性，不提供来源签名。

## 安装和回滚

先通过可信渠道核对压缩包 SHA-256，解压到独立目录。在 PowerShell 使用明确的 Node 路径：

```powershell
New-Item -ItemType Directory .\candidate
& "$env:SystemRoot\System32\tar.exe" -xzf .\windows-native.tgz -C .\candidate
node .\candidate\windows\manage.mjs install .\candidate --root "$env:LOCALAPPDATA\BotmuxWindows"
& "$env:LOCALAPPDATA\BotmuxWindows\bin\botmux.cmd" --version
& "$env:LOCALAPPDATA\BotmuxWindows\bin\botmux.cmd" start
```

安装器不会自动修改 PATH 或启动服务。将上述 bin 目录加入你自己的 PATH 后可直接执行 botmux。所有程序版本位于 `BotmuxWindows/releases/`，当前版本由 active.json 选择。

升级时先用当前版本停止 fleet，再对新候选包执行同一 install 命令。安装器拒绝在检测到存活 fleet/旧 PM2 BotMux 进程时激活。停止后回滚：

```powershell
node .\candidate\windows\manage.mjs rollback --root "$env:LOCALAPPDATA\BotmuxWindows"
```

回滚会重新校验上一版并交换 current/previous。安装和回滚均不删除 `.botmux` 配置和数据。此版仅验证 bots.json 根节点类型，不做 schema 自动迁移；跨越上游数据迁移版本时，需要先备份配置和数据库，并审阅上游迁移说明，程序回滚不等于数据库回滚。

当前使用旧 PM2 版时，先明确停掉旧 daemon/dashboard，保留旧包、配置与 shared launcher 备份。切换到新版本后的首次 `start` 会遵循上游行为更新 `.botmux/bin`；因此不能只靠 NVM 切版本隔离测试。

测试隔离需要同时为子进程设置 `HOME` 和 `USERPROFILE`，再设置独立的 `APPDATA`、`LOCALAPPDATA`、`BOTS_CONFIG`、`SESSION_DATA_DIR` 和端口。Git Bash 会继承 `HOME`，只改 `USERPROFILE` 会让 wrapper 仍写入原用户 `.botmux/bin`。这些设置仅作用于测试进程，不能写入机器级环境。

## 跟进上游

提交本分支源码后执行：

```sh
node windows/sync-upstream.mjs vX.Y.Z X.Y.Z-win.1 ../botmux-windows-X.Y.Z
```

脚本 fetch 指定 ref，在**新 checkout** 中把 Windows 提交序列 rebase 到新上游，列出上游也改动过的接入文件，并更新新目录的 release.json。它不改变当前源码分支、已安装程序或运行服务。冲突留在新目录中供修复，不能自动“取我方”解决。然后在新 checkout 独立安装锁定依赖、完整构建、运行回归和 Windows smoke，并提交新的基线记录。清洁 rebase 不代表运行兼容。

`.github/workflows/windows-native.yml` 是手动候选流水线：Linux 构建 + Windows Node 22/24 安装/ConPTY 矩阵，产出 artifact，不向 npm 发布、不改生产。`release.json` 中的版本须与新的上游一致；不要用 0.0.0 标记可交付包。

## 测试范围和限制

- Native `.exe` 直接传 argv，中文、引号和多行参数不经 cmd 展开。
- `.cmd/.bat` 必须通过 cmd.exe；安全参数逐项引用，包含引号、百分号、感叹号或换行的参数会被明确拒绝。需要传任意提示词的 CLI 应配置真实 `.exe` / Node 入口。
- PTY 进程不具有 tmux 的跨 daemon 存活能力。会话能否恢复取决于 CLI 自身的 resume 支持。
- 本版没有实现 Windows 文件沙盒；依赖 bubblewrap/Unix sandbox 的功能不得作为已支持能力宣传，也不得把沙盒失败静默降级成无隔离运行。
- 飞书端到端必须用独立测试机器人，验证私聊 chat scope、首条和连续回复、无重复、中文、重启恢复。CLI `--version`、apiOnly daemon 或 ConPTY 测试通过均不等价于此项通过。

## Windows TraeX 的可靠输入（win.2）

实测 TraeX 0.207.1 的 TUI 会把每次提交中的第一个 `、` 改成 `/`，即使只有 `a、b、c`。BotMux 的 history 全文确认因此失败，上游普通 PTY 的开场消息重试可能造成重复回复。ConPTY 原始字节回环无差异；通过原生 app-server RPC 输入，持久化文本逐字一致。

win.2 复用上游 `codexRpcInput`，增加 Windows TraeX + PTY 的启动、关闭及恢复接入。Windows TraeX **必须开启 RPC**；配置不兼容、RPC 启动失败或首条未能发送时，明确报错，不退回有问题的 TUI 粘贴。已发出但未确认的 RPC 沿用上游的保守处理，不自动重发。Linux/macOS 与其它 CLI 的默认路径保持原样。

在原有机器人配置中设置以下字段（保留原 app、凭据和用户身份配置）：

```json
{
  "cliId": "traex",
  "backendType": "pty",
  "codexRpcInput": true,
  "sandbox": false
}
```

将官方 TraeX 的 bin 目录加入启动进程的 PATH（例如 `$env:PATH="C:\Users\YOUR_NAME\AppData\Local\Programs\TraeX\bin;$env:PATH"`）。本版使用官方可执行文件发现；不要配置 `cliPathOverride`（上游 RPC 会拒绝含糊的 wrapper），也不要设置 `cliRuntime`（上游配置 schema 目前仅对 Codex 开放）。RPC 不兼容 `disableCliBypass=true`、sandbox、read isolation、adopt、wrapper 或 startupCommands；这类需求不能通过关闭相应保护来自动迁移。本版不为已有配置静默修改权限。新配置仅应用于新会话；旧会话先关闭并重建，避免继续使用数据库内冻结的旧配置。终端由同一原生 TraeX 的 `--remote resume` 显示，模型输入经结构化 RPC 传递。

已登录 TraeX 后，可显式运行完整实机输入验证（会产生三个小型模型请求和一个保留的原生会话，不发送飞书消息）：

```powershell
node .\candidate\windows\verify-traex.mjs 'C:\Users\YOUR_NAME\AppData\Local\Programs\TraeX\bin\traex.exe'
```

该验证检查中文、顿号、换行与引号逐字一致、连续输入、终端显示、同一原生线程恢复、孤儿进程身份验证及进程树清理。它不在普通安装器中自动运行，避免安装动作调用模型。
