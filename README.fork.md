# redmed/botmux-windows Fork 说明

这个 Fork 为 BotMux 增加并维护 **Windows 10/11 x64 原生运行链路**。目标是在尽量少改上游代码的前提下，让用户只用一台 Windows 机器即可完成源码获取、依赖安装、编译、安装和运行，并能持续低成本跟进官方版本。

BotMux 的产品介绍、配置方法和通用能力仍以上游 [deepcoldy/botmux](https://github.com/deepcoldy/botmux) 文档为准。Windows 适配的技术细节、限制和验收记录分别见 [windows/README.md](windows/README.md) 与 [windows/VALIDATION.md](windows/VALIDATION.md)。

## 分支策略

| 分支 | 用途 | 维护规则 |
| --- | --- | --- |
| `master` | 跟踪官方 BotMux | 只用于同步上游，不在这里提交 Windows 改造 |
| `windows/native-vX.Y.Z` | 对应上游版本的 Windows 原生适配 | Windows 代码、文档和验证记录均提交到这里 |

当前分支以官方 `v3.30.0` 为基线，候选版本和精确上游提交由 [windows/release.json](windows/release.json) 固定。后续升级应从新的官方版本创建新的 `windows/native-vX.Y.Z` 分支，不把旧适配直接合并进 `master`。

## 推荐：安装已编译版本

### PowerShell

普通 Windows 用户无需下载源码或准备 Bun。预先安装 x64 Node.js 22.13.0 或更高版本，然后在 PowerShell 中执行一行快速安装命令：

```powershell
curl.exe -fsSL https://github.com/redmed/botmux-windows/releases/latest/download/install.ps1 | Out-String | Invoke-Expression
```

这相当于 Unix 上的 `curl | sh`，但原生 Windows 使用 PowerShell。如果系统没有 `curl.exe`，可改用：

```powershell
(Invoke-WebRequest -UseBasicParsing https://github.com/redmed/botmux-windows/releases/latest/download/install.ps1).Content | Invoke-Expression
```

### Git Bash

如果当前终端是 Git Bash，不要直接运行包含 `Out-String` / `Invoke-Expression` 的 PowerShell 命令；使用 Git Bash 专用入口：

```bash
curl.exe -fsSL https://github.com/redmed/botmux-windows/releases/latest/download/install-git-bash.sh | bash
```

该入口只负责下载并调用同一份 PowerShell 安装器，不复制安装逻辑。安装完成后新开 Git Bash，即可直接执行小写 `botmux`。

安装脚本下载运行包时也会在 curl 不存在时自动回退到 `Invoke-WebRequest`。Release 使用 Windows 原生 ZIP 和 PowerShell 自带的 `Expand-Archive`，不依赖 `tar.exe`。希望先审阅脚本时，可改用：

```powershell
$installer = Join-Path $env:TEMP 'botmux-install.ps1'
curl.exe -fsSL https://github.com/redmed/botmux-windows/releases/latest/download/install.ps1 -o $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

### 环境配置

脚本从本 Fork 的 GitHub Release 下载已经编译好的 Windows x64 运行包及 SHA-256，完成两层完整性校验，安装到当前用户的 `%LOCALAPPDATA%\BotmuxWindows`，并把其 `bin` 目录加入**用户 PATH**。首次安装后新开 PowerShell，运行 `botmux setup` 和 `botmux start`。

安装器会预检 Windows 10/11 x64、PowerShell 5.1+、Node.js 22.13.0+ 和 x64 Node 架构，并在安装阶段验证 CLI 与真实 ConPTY。预编译安装不需要 Git、Bun、Python 或 Visual Studio；Agent CLI 的安装与登录、飞书凭据配置仍由用户在安装后按实际选择完成。

### 安装前 botmux 需停止

升级前先确认没有正在执行的任务，执行 `botmux stop`，然后重新运行同一安装命令并执行 `botmux start`。指定版本可在最后一条 PowerShell 命令增加 `-Version 3.30.0-win.4`。完整参数、回滚和排错见 [Windows 安装文档](windows/README.md#推荐下载已编译版本)。

## 在 Windows 上从源码构建安装

准备环境：

- Windows 10/11 x64；
- Node.js 22.13 或更高版本，包含 npm；
- Git for Windows；
- Bun 1.4.2，可执行 `npm install -g bun@1.4.2` 安装；
- 能访问 GitHub 和 npm 依赖源的网络。

建议至少准备 8 GB 内存和 5 GB 可用磁盘。当前固定依赖在 Windows x64 使用预编译的原生组件，不要求另装 Linux、WSL2、Visual Studio C++ 工具或 Python。

在 PowerShell 中执行：

```powershell
git clone --branch windows/native-v3.30.0 https://github.com/redmed/botmux-windows.git
Set-Location botmux-windows
node windows/from-source.mjs --check
node windows/from-source.mjs
```

最后一条命令会依次完成环境检查、锁定依赖安装、上游完整构建、Windows 运行目录打包、清单校验和版本安装。默认安装到：

```text
%LOCALAPPDATA%\BotmuxWindows
```

安装成功后运行：

```powershell
& "$env:LOCALAPPDATA\BotmuxWindows\bin\botmux.cmd" setup
& "$env:LOCALAPPDATA\BotmuxWindows\bin\botmux.cmd" start
```

Agent CLI 仍需单独安装和登录，飞书机器人凭据也需按上游流程配置。使用 Windows TraeX 时还需要启用本 Fork 文档所述的原生 RPC 输入，详见 [Windows TraeX 的可靠输入](windows/README.md#windows-traex-的可靠输入win2-起)。

源码入口要求独立、干净的 Git clone，不接受源码 ZIP、Git worktree 或共享的 `node_modules`。这样可以保证安装包能够追溯到确定提交，并避免构建过程修改正在运行的 checkout。更多参数和排错方式见 [Windows 本机从源码安装](windows/README.md#windows-本机从源码安装win4-起)。

## 跟进官方升级

### 分支职责

- `master` 只镜像官方 `deepcoldy/botmux` 的 `master`，不合入 Windows 专属提交；这样 GitHub 的 Fork 同步和上游差异始终清晰。
- `windows/native-vX.Y.Z` 保存对应官方版本的 Windows 适配、验证记录和 `X.Y.Z-win.N` 发布提交。修复同一官方版本时继续在该分支递增 `win.N`；升级官方版本时新建下一条版本分支。
- 不另建“Windows Master”。普通用户以 GitHub Release 的 `latest` 为稳定入口，源码和历史则由版本分支与不可变标签定位。只有确实需要一个长期滚动分支、并接受跨基线强推或额外合并维护时，才另行设计 `windows/latest`。

推荐保留两个远端：

```sh
git remote add upstream https://github.com/deepcoldy/botmux.git
git remote add fork git@github.com:redmed/botmux-windows.git
git fetch upstream --tags
```

升级时先让 Fork 的 `master` 对齐官方 `master`，再从目标官方 tag 创建新的 Windows 分支。已有维护脚本会在新 checkout 中重放 Windows 提交、更新候选版本并列出上游同样修改过的接入文件：

```sh
node windows/sync-upstream.mjs vX.Y.Z X.Y.Z-win.1 ../botmux-windows-X.Y.Z
```

脚本成功只表示 Git 提交可以重放，不代表运行兼容。每次升级仍必须完成：

1. Windows 本机 frozen install 和完整源码构建；
2. Windows Node 22/24 CLI、ConPTY、进程树和安装/回滚检查；
3. Windows 与 Linux 回归测试；
4. 真实 worker 连续输入、进程重启和原生会话恢复；
5. 独立测试机器人飞书端到端验收。

手动候选流水线位于 `.github/workflows/windows-native.yml`。它只生成验证 artifact，不发布 npm 包，也不会修改生产环境。

验收完成并提交所有修改后，先用只读模式检查发布条件，再显式触发发布：

```sh
node windows/publish-release.mjs
node windows/publish-release.mjs --remote fork --publish
```

脚本要求工作区干净、分支名为 `windows/native-vX.Y.Z`、当前提交包含 `release.json` 固定的上游提交，并校验安装脚本中的版本和 Node 下限一致。默认只做检查；只有显式传入 `--publish` 才会推送当前分支和 annotated tag。之后 GitHub Actions 自动在 Linux 构建 ZIP，在 Windows Node 22/24 上执行安装、CLI 和 ConPTY 验证，通过后发布 Release、SHA-256 和安装脚本。

仓库还提供 [`botmux-windows-upgrade` Skill](.trae/skills/botmux-windows-upgrade/SKILL.md)，供 AI 按同一套分支、安全门禁、实机验收和发布流程执行后续升级。可以直接要求：“使用 botmux-windows-upgrade，把 Windows Fork 升级到官方 vX.Y.Z；先准备并验证，暂不发布。”验证通过后再单独授权发布和全局部署。

## 安装包与发布边界

- 普通用户优先使用经过验证的 Windows 运行包，省去本机编译时间；需要审计或自行修改时可直接走上述源码安装流程。
- `windows/build.mjs` 生成的是完整 portable runtime，不是可交给 `npm install` 的包。
- 当前 Fork 不发布 Windows npm 包，也不会替换上游正式发行版。Windows 标签 `windows-vX.Y.Z-win.N` 只触发本 Fork 的独立 GitHub Release；流水线在 Linux 构建，并在 Windows Node 22/24 上验证后才公开运行包、SHA-256 和安装脚本。
- 安装器采用不可变版本目录和 `active.json` 原子切换，并保留上一版本用于回滚；用户的 `.botmux` 配置和会话数据不放进运行包。

## 当前支持边界

- 已验证 Windows 10 x64；Windows 11 x64 作为目标平台，但仍应在发版前实机复核。
- 尚未支持 Windows ARM64。
- Windows 默认使用 ConPTY，不提供 tmux 跨 daemon 存活语义；恢复能力取决于 Agent CLI 自身的 resume 支持。
- 本 Fork 没有实现 Windows 文件沙盒，不能把沙盒失败降级成无隔离运行。
- 原生依赖升级、Bun/Node 版本变化或上游修改公共进程路径时，必须重新做完整验证。

## 贡献约定

Windows 改动应尽量集中在 `windows/` 和少量明确的跨平台接入点，并同时保护 Linux/macOS 原有行为。提交前保持工作区干净，记录实际执行过的测试和版本信息，不提交机器人凭据、用户配置、日志、数据库或构建产物。
