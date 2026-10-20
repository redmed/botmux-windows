# Windows native 候选版验证记录

最近验证日期：2026-10-20。当前开发候选：`3.47.0-win.1`；当前正式发布版本仍为 `3.39.0-win.1`。

## v3.47.0-win.1 上游同步与候选验证

本节记录开发候选的本地和 dev-win 隔离实测；后续授权的全局部署见下节，尚未发布 Release。官方 GitHub 最新稳定 Release 为 `v3.47.0`；检查时 npm latest 为 `3.46.0`，本次选择明确的官方稳定 tag。

- 上游 tag `v3.47.0` 固定到 `ba2ad453fde414845292d3e9fd5d165f6d63f7f1`。Fork `master` 已快进到官方 `master` `1648f8ee0e4e915a0e43eacc07a57adb91c21773`，未混入 Windows 改造。
- Windows 分支：`windows/native-v3.47.0`。30 个下游提交重放到新基线；保留上游 PTY reader 包装器、统一输入策略、模型迁移保护，以及 Windows HostRuntime 和原生 RPC 输入。
- 最终运行代码及构建源码：`842b90acfb00232de2a4eb77bcec6c1f20a8f8aa`。其后的候选收尾提交只更新说明及验证记录。
- 两端构建使用独立 clone 和独立依赖，Bun 固定 `1.4.3`；没有在开发 worktree 内执行依赖安装。

### 本轮发现及修复

1. 上游移除了旧日志跟随模块，而 Windows 的 `logs -f` 仍依赖它。将实现保留到 `src/host/log-tail.ts`，修正 CLI 引用，并保留 10 项行为测试。
2. node-pty 升级到 `1.2.0-beta.15`，ConPTY 改为异步连接，初始 PID 为 0。认证验证器改为等到真实 PID 后记录进程，且仅在清理断言成功后输出通过结果。
3. 真实 Worker 第一轮完成后，第二轮被上游新增的终端输入框保护阻塞。Windows 已就绪 RPC 的 viewer 不接收输入，不应等它重画 composer；两个屏幕保护入口改用既有 Windows RPC 就绪判定，保留在途回合和非 RPC 保护。新增 4 项回归。
4. 第二轮修复后又发现 Worker 关闭超时。最小复现中，关闭真实 ConPTY 后立刻 `process.exit()` 会卡在原生退出阶段。单次让出事件循环虽在 Node 24 连续 5 次成功，但新增真实子进程回归在 Node 22 捕获到竞态；最终由 `deferHostProcessExit()` 等待已关闭 ConPTY 的原生退出回调确认后再退出，POSIX 仍同步退出。Windows 运行包验证加入真实子进程“关闭终端后显式退出”检查，避免仅验证自然退出而漏检。

### 回归范围

- Linux 发布工作流所列回归 15 个文件、262 项通过；加入共享 Worker 关闭、转移、existing app-server shutdown 与非 RPC fence 回归后，最终组合为 19 个文件、279 项全部通过。
- 此外，模型迁移保护 48 项、Windows stdin 编码 9 项、原生 PTY smoke 2 项通过。模型迁移的完整 tmux/PTY 集成 14 项通过；初跑受当前 zsh 启动环境影响，固定 `SHELL=/bin/bash` 后复验通过，没有修改用户 shell 配置。
- 测试夹具最初缺少 init prompt，导致新 RPC fence 断言不满足 eligibility；补全真实初始化字段后，新增 4 项在 Linux 与 Windows 均通过。

### 构建产物

Linux 与 Windows 均完成 Bun 1.4.3 的上游完整构建：源码、脚本、test mocks 类型检查，Dashboard bundle，以及产物和嵌入资源审计全部通过。Windows 本机构建后的专项回归为 6 个文件、46 项全部通过。

- Linux 构建 ZIP：`botmux-windows-x64-3.47.0-win.1-final.zip`，41,060,713 字节；清单包含 7,170 个文件。
- ZIP SHA-256：`059d890eaa0dcd21ecd13bb0573a2a6060820914a8f45ed1ac5f71251e33321f`。
- Runtime build ID：`ed8063b4830c5d9d7a3af26770e6dcd4bbd164d80144b06443c6d7a2a04d5994`。
- 本地未发布测试包保存在独立验证缓存中；不把二进制 ZIP 提交进 Git 历史。未来正式发布由 GitHub Actions 从发布提交重建，发布资产以届时生成的 SHA-256 为准。

### Windows 实机验收

最终 ZIP 在 dev-win 上先验证 SHA-256，再解压到含空格目录；以下测试使用该包，源码为 `842b90acfb00232de2a4eb77bcec6c1f20a8f8aa`：

| 项目 | 结果 |
| --- | --- |
| Node 22.23.3 / 24.21.0 | CLI 版本、中文/引号/换行参数、批处理入口、ConPTY、子进程树回收和显式关闭退出均通过 |
| TraeX 原生 RPC | 三轮调用；输入逐字相等且恰好投递三次，viewer、重启恢复、旧 app-server 回收及最终清理断言全部通过 |
| 完整 BotMux Worker | fresh 两轮后关闭 Worker，再由新 Worker resume 第三轮；恰好 3 个 final_output，原生 thread 不变，没有 user_notify；恢复输入确认 5,833 ms，两个 Worker 及其归属进程正常回收 |

TraeX 验证 thread：`01a15572-1564-7442-9421-06abea927021`。完整 Worker session：`91e03453-e9f1-4a81-9662-8cce5e074bc3`，native thread：`01a15572-80c4-7a61-b2b1-d792847599f8`，证据目录：`C:/Users/qiaogang/AppData/Local/Temp/botmux-worker-rpc-ol7qIg`。

验证脚本复用原有 TraeX 登录状态，使用独立 BotMux profile、安装根和会话数据，没有向飞书发送测试消息。候选阶段没有部署新版全局 fleet，也没有进行新版全局机器人的飞书端验收；后续全局部署与飞书验收另行记录，避免混淆验证范围。

### 安装、升级、回滚及边界

- Linux 最终包与 Windows 本机构建包均通过 `manage.mjs install` 安装到各自独立根目录；二者源码提交、Runtime build ID 和清单文件数完全一致。
- 另一独立安装根完成 `3.39.0-win.1 → 3.47.0-win.1 → 3.39.0-win.1`；升级和回滚后的 current/previous 指针均符合预期。
- `install.ps1` 使用本地 file URI 下载上述同一 ZIP 和 SHA-256 到新隔离根，归档校验、逐文件清单、ConPTY、关闭退出、激活及安装后 CLI 版本检查全部通过。脚本的 curl/tar 缺失回退逻辑本轮未修改，已有历史验收不重复计作本轮测试。
- 两组安装验收均返回 `GlobalUnchanged=true`。候选隔离验证结束时审计确认全局仍为 current `3.39.0-win.1`、previous `3.30.0-win.4`，本轮测试运行目录的 Node 进程和本轮创建的 TraeX app-server 均为 0；已有全局实例及其他原有会话未清理。
- Windows SSH 会话的 Git 凭据助手曾无法访问 wincredman。仅本次拉取命令禁用交互式凭据助手后，即可从公开 GitHub 仓库同步最终提交；未修改全局 Git 认证配置。随后完整 Windows 原生构建与 46 项测试通过。
- 本轮未创建发布标签、未运行 GitHub Actions 发布流水线、未发布 Release。GitHub Latest 仍为 `windows-v3.39.0-win.1`；不能将这里的本地验证描述为云端 CI 已通过。候选源码和验证记录提交至版本分支，后续发布仍使用 `windows/publish-release.mjs` 及既有发布流水线。


## v3.47.0-win.1 当前用户全局部署与飞书验收

2026-10-20，用户明确授权将 dev-win 切换到最新版并使用本群 Windows 机器人验证。目标为 Windows 10 企业版 x64、build 19045、Node 22.23.3；部署的是上一节已验证的同一最终 ZIP，运行源码和 Runtime build ID 均未改变。

### 切换与保留

- 切换前通过 Dashboard 已认证的会话状态接口确认三个现有会话均为 `idle`，而非仅根据 CLI 的 `online` 判断。全局配置只有一个机器人。
- 旧临时解压目录预检发现缺少 `node_modules/hono/dist/adapter/aws-lambda/types.js`，安装在停机前被拦住。原 ZIP 的 SHA-256 正确；重新解压到新目录后，7,170 个文件全部通过清单校验，再继续部署。
- `active.json` 与配置根的九个文件已备份到 `C:/Users/qiaogang/AppData/Local/BotmuxWindows/backups/pre-3.47.0-win.1-20261020-102804`，备份仅保留在 Windows 本机。随后停止 fleet，通过 `manage.mjs install` 安装到原全局程序根，再启动 fleet。
- 当前指针为 `3.47.0-win.1`，previous 为 `3.39.0-win.1`。安装器的逐文件、CLI、ConPTY 与关闭退出检查通过；安装阶段 `bots.json` 哈希不变，没有删除配置或会话。
- 独立 PowerShell 的 `Get-Command botmux` 解析到 `C:/Users/qiaogang/AppData/Local/BotmuxWindows/bin/botmux.cmd`。机器人进程内可能先解析到会话注入的命令代理，因此全局入口以独立控制台检查为准。
- `autostart.cmd` 已随启动刷新到 `3.47.0-win.1`，现有 `botmux-daemon` 任务为 Enabled、Ready。本轮验证了服务重启及自启动配置，没有重启 Windows 操作系统。

### 实际群消息与重启恢复

Windows 机器人在本机执行版本、服务和 Dashboard HTTP 检查；测试标记与可追溯的最终消息如下：

| 检查 | 实测结果 | 飞书最终消息 ID |
| --- | --- | --- |
| 首轮本机检查 | `3.47.0-win.1`；supervisor、daemon、Dashboard 在线；HTTP 200；previous 为 `3.39.0-win.1` | `om_x100b625960bbc4b8b4c24f3d769dee0` |
| 原首轮请求补投 | 同样通过版本与服务检查；对应另一条原始请求 | `om_x100b6259612f18b0cf22a2c64014f29` |
| 连续第二轮 | `GLOBAL347-TWO 中文、顿号、连续回合正常；上一轮：GLOBAL347-ONE。` | `om_x100b62597e1a50b8b0e24be74ec0a73` |
| 受控重启后第三轮 | `GLOBAL347-THREE 中文、重启恢复、正常。`；版本、服务、HTTP 200 正常，准确回忆 `GLOBAL347-ONE` 和 `GLOBAL347-TWO` | `om_x100b625974b58498cfe7a0f57e2ee01` |

BotMux session 始终为 `f06ea3a1-25be-49fe-83e4-f90bb79dfd42`，TraeX native thread 始终为 `01a12308-bd8e-73c0-9b57-0c9add3c61fc`。只读检查原生会话日志的 `history_mutation` 用户输入，四条测试请求各有一条 `append` 记录，没有同一测试输入被重复提交。重启后第三轮于 `02:36:06.984Z` 持久化到同一 native thread。

首轮遇到旧对话授权过期：通过正式 `botmux grant chat` 命令，以接收端视角的实时群成员 open_id 补齐本群 talk-only 授权。跨主机 `--subject-bot` 因发送方 App 不在接收端本地配置而被拒绝，改用文档支持的 `--subject-open-id` 后成功，未绕过群成员校验。原请求稍后被自动补投，而人工重发的测试请求也已执行，因此有两条同名首轮回复；它们对应不同请求及不同 native turn，不能误记为单次输入重复执行。后续另一端旧的三条消息额度也耗尽，同样补齐仅限本群的对话授权；没有授予管理命令权限。

### 最终状态与发布边界

- 重启前再次确认会话无运行中回合及排队输入。supervisor 从 PID 2624 切换到 5748；最终 daemon PID 9708、Dashboard PID 2792、Worker PID 3256，四个 BotMux 进程全部来自 `3.47.0-win.1`，旧版程序进程为 0。关闭已结束部署的 SSH 连接后服务仍在线。
- 最终群会话为 `idle`，另两个原有会话为 `dormant`，原已关闭会话仍关闭；会话 ID 和原生 thread 均保留。
- 机器人凭据及其它配置保留；相对部署前备份，最终只有 `quotaState` 和 `grantExpiryState` 两个字段发生上述测试授权及用量变化。未升级或重启 Linux BotMux。
- 本轮只部署并验收候选，没有创建 Release/tag 或触发发布工作流。公开 `releases/latest` 仍对应已发布的 `3.39.0-win.1`；本节不能作为新版 GitHub Actions 已通过或新版公开安装包已发布的证据。

## v3.39.0-win.1 上游同步与候选验证

- 上游稳定版：`deepcoldy/botmux` tag `v3.39.0`，commit `3cbf8102e98756fde5f605d0228d64d94a6ee8b1`；正式发布复验后，Fork `master` 已再次快进到官方 `master` `08680da70f21bb50365d276ee1d5d3b0a46fcb5f`，Windows 改造未合入 `master`。
- Windows 分支：`windows/native-v3.39.0`；运行时修复 commit `02e459b750b45f969510d75e3cda1cac0793efb5`，正式发布源码 commit `cc431bc559df092dfbc3fdc45edb20bcf17aa3b3`，版本 `3.39.0-win.1`。
- Runtime build ID：`447591300066beddb4bbb464175c6cfa38eddb4a90abcf962b36434e02548dcf`。Windows 本机构建清单为 7,149 个文件；候选 Linux 交叉构建清单记录 7,153 个哈希文件。正式 Release 清单固定到 `cc431bc559df092dfbc3fdc45edb20bcf17aa3b3`，上游 commit、版本和 Runtime build ID 均与候选验证一致。
- 26 个 Windows 下游提交重放到新基线。冲突处理同时保留 v3.39 的 strict env、sandbox 门禁和 Windows ConPTY、进程树、TraeX 原生 RPC 能力；旧分支和已发布标签均未改写。

| 项目 | v3.39.0-win.1 实测结果 |
| --- | --- |
| Linux 完整构建 | Bun 1.4.2；源码、脚本和 test mocks 类型检查、Dashboard bundle、产物与嵌入资源审计全部通过 |
| Linux 针对性回归 | 最终修复相关 4 个测试文件、201 项通过；升级初始阶段另完成 Windows 工作流 9 个文件、83 项及 RPC/worker 8 个文件、199 项回归 |
| Linux 交叉构建 | `windows/build.mjs` 在最终 commit 上成功生成 `win32-x64` 运行目录；版本、source commit、Runtime build ID 和清单均可追溯 |
| Windows 本机构建 | dev-win 的 Windows 10 x64 原生构建通过，用时约 169.1 秒；7,149 个文件，构建后工作区干净 |
| Windows 专项回归 | 4 个测试文件、32 项通过；POSIX-only 测试未错误计入 Windows 支持范围 |
| Node 22.23.3 / 24.21.0 | CLI、argv、ConPTY 和进程树检查均通过 |
| 隔离升级与回滚 | 独立安装根完成 `3.30.0-win.4 → 3.39.0-win.1 → 3.30.0-win.4`；归档、逐文件清单和激活检查通过，用户全局 `active.json` 保持不变 |
| TraeX 原生 RPC | `verify-traex.mjs` 完成三轮调用；输入逐字相等、viewer、restart 和孤儿进程回收均通过 |
| 完整 Windows worker | fresh 两轮后新建 worker 恢复第三轮，恰好产生 3 个 `final_output`；恢复输入确认 8,764 ms，无重复提交 |

本轮实机发现并修复了两个仅靠单元测试和单轮验证无法覆盖的时序问题：原生 RPC terminal 早于 transcript ready 时，worker 先排空已完成 turn 再发布 terminal；Windows viewer 未重画 composer 时，后续消息改由已就绪的 RPC 串行提交，同时保留当前回合未结束时的 type-ahead 门禁。Windows 强制 RPC 失败仍直接报错，不静默回退到可能造成中文或重复输入问题的 TUI 粘贴模式。

完整 worker 证据：BotMux session `705fec06-cbee-4f6d-b1f0-0727f762820a`，TraeX native thread `01a12235-2be9-7c43-9ffa-22790f0eed93`，证据目录 `C:\Users\qiaogang\AppData\Local\Temp\botmux-worker-rpc-3BFMrT`。独立 TraeX 验证 thread 为 `01a12234-dbca-7652-a084-3a069103a187`。

上述候选阶段的 Windows 安装、升级、回滚和认证验证全部使用独立 clone、依赖目录、profile 与安装根；在用户随后明确授权全局部署和正式发布后，按“先部署验证、后创建不可变标签”的顺序完成以下验收。

## v3.39.0-win.1 全局部署与正式发布

- dev-win 当前用户全局实例从 current `3.30.0-win.4`、previous `3.30.0-win.3` 升级为 current `3.39.0-win.1`、previous `3.30.0-win.4`。切换前确认所有会话无运行中 turn，并备份 `active.json` 与 `bots.json` 到 `C:\Users\qiaogang\AppData\Local\Temp\botmux-global-upgrade-20261010-073608`。
- 切换后 Dashboard HTTP、CLI 版本和会话恢复均通过；新版 supervisor、daemon、Dashboard 与 worker 共 5 个进程，旧版进程为 0，孤儿 TraeX app-server 为 0。Windows 任务计划 `botmux-daemon` 存在、Enabled、Last Result 为 0。
- 升级前后 `bots.json` 初始哈希一致；实际飞书验证后仅出现用户授权卡产生的 grant expiry 与 quota limit 变化，没有机器人凭据变化。群内 Windows 机器人实际回复 `GLOBAL339-OK 版本 3.39.0-win.1；daemon online；Dashboard online。`，对应会话随后恢复 idle。
- 不可变 annotated tag `windows-v3.39.0-win.1` 指向 commit `cc431bc559df092dfbc3fdc45edb20bcf17aa3b3`。GitHub Actions run `38005673975` 的 Linux build、Windows Node 22/24 双矩阵验证和 publish job 全部成功；Release 已设为 Latest。
- 公开 `install.ps1`、`install-git-bash.sh`、ZIP 和 SHA-256 四个资产均返回 HTTP 200。正式 ZIP SHA-256 为 `9dc21c0642922d337e3247ecd6d6a788e448588d9003f71d9a7ba53d13c87572`，公开 `install.ps1` SHA-256 为 `2698b6dba8e14b198b7d41dbc3523669372dcd6c7cd933bb7d7cfd5ae5644571`。
- dev-win 从公开 `releases/latest/download/install.ps1` 下载并安装到全新隔离 HOME、USERPROFILE 与含空格安装根；归档 SHA-256、逐文件清单、激活、CLI `3.39.0-win.1` 和 ConPTY 均通过，探针结果为 Node 22.23.3、`pty=true`。复验期间全局 `active.json` 哈希及原 5 个全局进程 PID 均保持不变，完成后再次确认 Dashboard online、所有会话 idle、旧版进程 0、孤儿 TraeX 0。

## v3.30.0 历史验证

验证日期：2026-09-26。最后发布版本：`3.30.0-win.4`。

- 上游：`deepcoldy/botmux`，tag `v3.30.0`，commit `79e75b14ffbb128ea83b70c43d51354297171bc6`；该提交同时是验证时的官方 `master`。
- Windows 本机构建源码：`4b410b69c13533f25cf36923414b577c6fbc6003`；从 GitHub Fork 的 `windows/native-v3.30.0` 分支干净克隆。
- Linux 交叉构建源码：`0dec2089b7d53f11b19308ef9ec7fd5efbff697f`；构建前后工作区均干净。
- Runtime build ID：`84dadcb57e8a9dd057ecaade86e7df7c4e7bcf9f58c342a7af8137b88ad9d417`。

## v3.30.0-win.4 安装失败展示与 Git Bash 入口

- 安装器捕获下载、解压、激活和安装后校验的原生命令输出，过滤已知 Node 实验性警告；失败时不再显示 PowerShell 源码位置、`CategoryInfo` 或 `FullyQualifiedErrorId`，而是在红色区域直接显示中文原因，并用黄色显示处理步骤。
- 运行中 fleet 的安全边界保持不变：安装器不会自动停止 BotMux。Windows 小型失败夹具稳定触发该保护后，输出为“BotMux 安装未完成”“检测到 BotMux 仍在运行”“先确认任务空闲并运行 `botmux stop`”，同时明确现有程序和用户数据未修改。
- dev-win 的 Windows PowerShell 5.1 分别以 `& script.ps1`、`Invoke-Expression` 和独立 `powershell.exe -File` 执行失败夹具。三种方式均只有下载/校验进度和四行中文诊断，无 Node 警告与 PowerShell 泛化堆栈；前两种保留 `$LASTEXITCODE=1`，独立进程退出码为 1。UTF-8 文件回读确认中文逐字正确。
- 新增 `install-git-bash.sh`，只负责检查 Git Bash 环境、下载同一份 `install.ps1` 并调用 Windows PowerShell，不复制安装逻辑。dev-win 的 `MINGW64_NT-10.0-19045` 失败夹具输出为 UTF-8 中文且退出码为 1；新启动的 Git Bash 能从当前用户 PATH 解析 `/c/Users/qiaogang/AppData/Local/BotmuxWindows/bin/botmux`。
- 修改后的安装器还从公开 Release 下载既有 win.3 ZIP，在独立 HOME 和安装根目录完成归档 SHA-256、逐文件清单、ConPTY、激活和 CLI 版本检查，证明输出捕获没有破坏成功路径。Linux Windows 专项回归为 9 个测试文件、83 项通过；PowerShell 5.1 parser 和 Git Bash `bash -n` 通过。
- GitHub Actions run `36171086328` 的 Linux 构建、Windows Node 22/24 双版本验收和发布 job 全部成功。公开 `install.ps1`、`install-git-bash.sh`、win.4 ZIP 和 SHA-256 均可下载，ZIP 校验值为 `c203eef4ed48d95de537e286d40b345a69ac697268cfb181fbebe1b106a103f9`，`latest` 已指向 `windows-v3.30.0-win.4`。
- 从公开 `latest` 地址实测 PowerShell 一行命令和 Git Bash 一行命令：全局 fleet 运行时，两者均显示相同的简洁中文原因和处理步骤，不出现泛化堆栈；PowerShell 保留 `$LASTEXITCODE=1`，Git Bash 返回 1。随后用公开 Git Bash 入口安装到独立 HOME 和安装根目录，归档、逐文件清单、ConPTY、激活及 CLI 版本检查通过，结果为 `version=3.30.0-win.4`、Node 22.23.3、`pty=true`。
- 上述测试均使用临时安装根目录和固定失败夹具或独立 HOME，未停止、替换或修改当前用户全局 BotMux。

## v3.30.0-win.2 / win.3 预编译发布入口

win.2 不改变 BotMux runtime 逻辑，只增加预编译包的发布和安装入口；win.3 补充无 curl 环境的 `Invoke-WebRequest` 自动回退，并将 Release 改为 PowerShell 可原生解压的 ZIP：

- `windows/install.ps1` 优先使用 `curl.exe` 下载 GitHub Release 运行包与独立 SHA-256，curl 不存在时自动回退 `Invoke-WebRequest`；先校验归档，再调用原有 `manage.mjs` 做逐文件清单和 ConPTY 验证。默认安装到当前用户 `%LOCALAPPDATA%\BotmuxWindows` 并幂等更新用户 PATH。
- 安装脚本不会绕过运行中 fleet 的保护，也不修改 `%USERPROFILE%\.botmux` 数据。Node 版本、x64 架构、压缩包版本和目标平台不匹配时均在激活前失败。
- `.github/workflows/windows-release.yml` 只接受与 `release.json` 完全匹配的 `windows-vX.Y.Z-win.N` 标签；Linux 构建出的同一个归档须通过 Windows Node 22/24 安装验证后，才发布运行包、SHA-256 和安装脚本。
- 当前安装器在 dev-win 上通过 PowerShell parser；加入发布助手测试后的 Linux 专项回归为 9 个测试文件、83 项通过。
- 在 dev-win 上已完整执行 ZIP bootstrap：curl + 系统 `tar.exe` 路径用时 62.7 秒；从 PATH 排除 curl 后，`Invoke-WebRequest` 下载回退用时 62.8 秒；强制模拟无 `tar.exe` 后，`Expand-Archive` 解压回退用时 159.2 秒。三条路径的归档 SHA-256、逐文件校验、ConPTY 探针、隔离安装和安装后版本检查均通过。回退测试使用既有 `3.30.0-win.1` 运行包验证候选安装器逻辑，不改变当时的当前用户全局实例。
- GitHub Actions run `36163445512` 完成 Linux 构建、Windows Node 22/24 双版本安装验证和 Release 发布，所有 job 成功。公开 `latest` 安装脚本、win.3 ZIP 和 SHA-256 均返回 HTTP 200；从 GitHub 在线下载到 Windows 隔离目录的完整安装用时 67.8 秒，版本为 `3.30.0-win.3`。随后当前用户全局实例从 win.1 升级到 win.3，`previous` 保留 win.1，supervisor、Bot 和 Dashboard 均恢复 online。

## 后续自动化发布

`windows/publish-release.mjs` 将本地发布操作收敛为只读预检和显式 `--publish` 两步。它检查工作区、分支名、固定上游提交、远端快进关系、版本和 Node 下限同步及标签唯一性；发布时只推送分支和 annotated tag。标签触发的 GitHub Actions 负责构建、Windows 双 Node 版本验收和 GitHub Release 发布，避免在开发机手工拼装或上传二进制。

## v3.30.0-win.1 上游同步与源码构建

Fork 的 `master` 与官方 `master` 均为 `79e75b14ffbb128ea83b70c43d51354297171bc6`，无需产生同步提交。旧的 `windows/native-v3.29.0` 保留不改；13 个 Windows 提交 rebase 到官方 `v3.30.0` 后形成 `windows/native-v3.30.0`。冲突仅涉及 `src/cli.ts` 和 `package.json`：前者同时保留官方新版 update/upgrade 目标解析与 Windows 安装器保护，后者同时保留官方新增的 Pi turn-boundary 生成步骤与跨平台 CLI 权限脚本。

| 项目 | v3.30.0-win.1 实测结果 |
| --- | --- |
| Linux 完整构建 | Bun 1.4.2 frozen install、源码/脚本/test mocks 类型检查、Dashboard bundle、产物和嵌入资源审计通过 |
| Linux 针对性回归 | 8 个文件、80 项通过 |
| GitHub 来源 | Windows 通过 HTTPS 从 `redmed/botmux-windows` 干净克隆 `windows/native-v3.30.0`；commit、branch、origin 和工作区清洁状态逐项核对 |
| Windows 本机构建安装 | Windows 10 x64、Git 2.55.0、Node 22.23.3、Bun 1.4.2；620 个依赖安装成功，完整构建、staging、清单校验和隔离安装 exit 0，共约 3 分 39 秒 |
| Windows 专项回归 | 3 个文件、29 项通过 |
| Node 22.23.3 / 24.21.0 | 安装产物的 CLI、argv、ConPTY 和进程树检查均通过 |
| 安装隔离 | 安装到新的 `installed github 3.30.0` 目录，current 为 `3.30.0-win.1`、previous 为空；未替换或重启既有飞书测试实例 |
| Linux 产物跨到 Windows | 同一个 Linux 归档在 Windows 校验、安装、ConPTY、supervisor/daemon/dashboard 进程路径和真实飞书回复全部通过 |

本轮证明 Fork 当前分支既可以只依赖 Windows 完成 clone、依赖安装、编译、运行包生成和安装，也可以在 Linux 生成 Windows 运行包，再交给 Windows 直接安装运行。上一版相关验收记录保留如下。

## v3.30.0-win.1 Linux 构建、Windows 运行（2026-09-26）

本项严格验证的是**同一个 Linux 产物**，不是 Linux 和 Windows 分别构建成功：

- Linux 使用 Bun 1.4.2 对提交 `0dec2089b7d53f11b19308ef9ec7fd5efbff697f` 完成 frozen install、完整 build 和 `windows/build.mjs` 打包；构建脚本显式安装 `win32-x64` 生产依赖，只保留 Windows ConPTY 预编译模块。
- 归档 `windows-native-linux-0dec2089.tgz` 为 37,687,151 bytes，Linux SHA-256 为 `8eb89cb29fd8b67004c4064c69f3013ec71569a01d0c6dc36073e73fb459a681`；传到 Windows 后重新计算的文件大小和 SHA-256 完全一致。
- 清单为 `platform=win32-x64`、6,893 个文件、Runtime build ID `84dadcb57e8a9dd057ecaade86e7df7c4e7bcf9f58c342a7af8137b88ad9d417`。Windows 安装器对候选目录和复制后的 release 各做一次逐文件哈希校验，并在新的 `botmux-linux-package-validation\install` 根目录激活，未复用已有同版本 release。
- 安装探针返回 `version=3.30.0-win.1`、Node 22.23.3、`pty=true`；`conpty.node` 为 312,320 bytes，`conpty_console_list.node` 为 134,656 bytes。CLI 版本检查通过，supervisor、daemon 和 dashboard 的命令行均明确指向该隔离安装目录。
- 切换前通过 TraeX app-server RPC 读取现有唯一会话，确认 1 个 completed turn、`running=0`，随后才停止用户级全局实例。跨构建实例使用独立 BotMux profile、Dashboard 端口 17891、daemon IPC 基准端口 17950，复用同一机器人配置和当前用户 TraeX 认证。
- 群内向 Windows 测试机器人发送唯一标记后，跨构建实例实际回复 `LINUX-CROSSBUILD-330-OK`。随后停止隔离实例，确认其进程全部退出，并恢复 `C:\Users\qiaogang\AppData\Local\BotmuxWindows`；恢复后的正式实例状态为 supervisor、bot worker、dashboard 全部 online，进程路径均回到用户级全局 release，并再次实际回复 `GLOBAL-RESTORE-330-OK`。

结论：当前 BotMux Windows Fork 不要求用户拥有另一台 Linux，也不要求 Windows 产物必须在 Windows 编译。可采用“Linux/CI 统一交叉构建，Windows 实机验收，用户直接下载已验收包”的发布链路；Windows 本机构建仍保留为无需 Linux 的源码安装方案。Windows 原生模块、进程管理、PATH、ConPTY 和飞书 worker 行为不能仅凭 Linux 构建成功判定，发布前仍需真实 Windows 验收。

## win.4 Windows 本机源码构建（v3.29.0 历史）

- 上游：`deepcoldy/botmux`，tag `v3.29.0`，commit `7fab8e0322ecc0ab05e89ddf9d022adbf409ec0d`。
- 运行包源码：`150299b952869ac5aa3f67794c49db8dd0f3880e`；源码无未提交修改时打包。
- Runtime build ID：`81cf1545481f9072d72f1c3ebe820e7e53f4977cda8023f279e3fa31c51e2ac3`。
- `windows-native-win4.tgz`：37,260,273 bytes，SHA-256 `c323e34ce2684506f22b64f3f7161ec4037f7c4554e4ee9b6a77df743143989d`（Windows 本机生成）。

构建主机：Windows 10 x64 build 19045，Git for Windows 2.55.0，Node 22.23.3，Bun 1.4.2。通过 SSH 从 Linux 控制 Windows；Git 获取上游源码、安装 npm 依赖、TypeScript 编译、前端 bundle、运行目录生成、压缩与安装均由 Windows 原生进程执行，没有传入 Linux 的 dist 或 node_modules。

首次完整构建在源码编译和 Dashboard bundle 后失败，原因是上游 `chmod +x` 依赖外部 Unix 命令。修复将这一条构建命令替换为 `scripts/mark-cli-executable.mjs`：Windows 不设置 POSIX 执行位，Linux 保留原有 `chmod +x` 的语义。Bun shell 已能执行 cp，无需复刻另一套构建顺序。

新增源码入口 `windows/from-source.mjs`，串联环境检查、frozen install、完整上游 build、运行目录生成和已有安装器。实际运行的 PATH 仅含 Node、Bun、Git 的 cmd 入口和 Windows 系统目录，排除了 Git Bash 的 usr/bin。依赖安装使用 node-pty 的 Windows 预编译模块，没有触发 C++ 本机编译；Electron 桌面程序下载已跳过。

| 项目 | win.4 实测结果 |
| --- | --- |
| Windows 首次 frozen install | 620 个依赖安装成功，约 41 秒 |
| 单入口完整构建安装 | exit 0；03:08:28Z 至 03:11:35Z，约 3 分 6 秒；源码依赖已有缓存，运行包依赖安装约 10.6 秒 |
| 完整上游 build | 源码、脚本、test mocks 类型检查，Dashboard bundle、产物审计和嵌入资源审计均通过 |
| Windows / Linux 针对性回归 | 3 个文件、29 项分别在两平台通过 |
| POSIX 权限语义 | 将文件模式 0640 改为 0751，保留原读写权限并增加执行位 |
| 前置检查 | 正确环境通过；传入错误 Bun 可执行文件时在依赖安装前拒绝 |
| 来源与完整性 | 6,851 个清单文件；源码提交 150299b，源码 diff 为空；构建后 Git 工作区干净 |
| Node 22.23.3 / 24.21.0 | 从本机源码产生并安装的 win.4 CLI、argv、ConPTY 和进程树检查均通过 |
| 完整 Windows worker | 本机安装的 win.4 fresh 两轮，再新建 worker 恢复同一原生 thread，恰好 3 个 final_output、每代 1 个开场确认、0 个 user_notify，自有进程全部退出 |
| 恢复输入确认 | 8,570 ms，低于 30 秒门槛 |

worker 实测原生 thread：`01a0d68c-ed50-7210-8a99-1483b1be18d3`；证据目录：`C:\Users\qiaogang\AppData\Local\Temp\botmux-worker-rpc-hmh3qc`。源码、依赖和候选目录合计 767,427,913 bytes；类型检查时观察到单个 Node 进程约 2.5 GB 内存。环境建议与 Windows 获取源码、构建安装命令见 `windows/README.md`。

独立安装目录为 `installed-native with spaces/releases/3.29.0-win.4`，随后把同一 Windows 产物安装到现有测试实例的 `installed-rpc with spaces`，previous 保留 win.3。安装前确认两个已有会话均无运行中 turn，安装过程中 bots.json 哈希保持一致。

win.4 飞书验收通过。`03:16:27.959Z` 收到请求，`03:16:32.758Z` 恢复原 native thread，`03:16:37.065Z` 提交输入，约 9.1 秒完成恢复输入提交。最终消息 `om_x100b646a35b180a4b324d3ae0c2885a` 于 `03:17:12.005Z` 可见，正文恰好出现一次：

> WIN4-NATIVE 本机编译、中文、恢复、正常；上一轮：WIN3-NEXT。

原 BotMux session 和原 native thread 均未改变；RPC 读取确认共 6 条输入、6 个 completed turns，win.4 本轮只新增 1 条，未重放前五条。恢复输入包含完整 daemon 原输入，user_message 部分逐字相等。冷启动时仍出现一次上游运输确认等待提示，后续正常提交，该提示未被作为失败或重复计数。

安装入口随后补充了 npm 安装 Bun 的自动发现（源码提交 b35a3cc）。在 Windows 的独立 npm 全局前缀实际安装 `bun@1.4.2` 后，PATH 上只有 bun.cmd/bun.ps1，没有 bun.exe；旧入口检查失败，新入口正确定位 npm 包内的原生 exe 并通过环境检查，包含空格的路径也通过。本项只改变源码入口的工具定位，没有改变已构建的 win.4 运行包；完整构建安装记录对应 150299b，运行包来源也保持该提交。

GitHub Actions 已新增 Windows 本机完整构建安装任务，当前只验证了本地和 dev-win，尚未运行远端 CI。原 Windows 运行时语义未因本次构建入口改变，Runtime build ID 与 win.3 相同。

## win.2 修复与验证

第一版飞书测试能够回复中文，但同一用户消息被重复提交。daemon 只收到一次消息，TraeX history 出现七条相同输入；每条都把第一个 `、` 改为 `/`，BotMux 精确确认失败后再次粘贴开场输入。短文本 `a、b、c` 同样复现；原始 ConPTY 输入回环逐字相等，传输分块和多次完整粘贴帧均不能解决。

win.2 使用上游已存在的 TraeX app-server RPC，仅扩展 Windows TraeX + PTY 的启动和恢复接入，并增加 Windows 进程树回收和孤儿进程身份核验。Windows TraeX 不允许静默回退 TUI 输入；其它平台和 CLI 保留原路径。

| 项目 | 结果 |
| --- | --- |
| Bun 1.4.2 完整 `bun run build` | 通过；含源码、脚本、mock 类型检查、Dashboard bundle、产物与嵌入资源审计 |
| Windows RPC gate、上游 RPC lifecycle/engine、host runtime | 130 项通过；新增 12 项在修复前全部失败、修复后通过 |
| 普通消息队列真实 worker、PTY、installer 回归 | 12 项通过；包含其它 CLI 的首次消息和身份隔离行为 |
| dev-win / Windows 10 x64 build 19045 / Node 22.23.3 | 第二版清单校验、ConPTY smoke、含空格路径安装并激活通过 |
| Node 24.21.0 | 第二版 CLI 版本、argv、PTY 自然退出和进程树 smoke 通过 |
| 真实 TraeX 0.207.1 原生 RPC | 三轮模型调用完成；中文、顿号、引号、换行的持久化输入逐字相等 |
| 原生终端 viewer | 同一 app-server 的首轮和第二轮结果在 `--remote resume` 终端显示 |
| 引擎恢复 | 替换进程后恢复同一原生 thread，第三轮完成；持久化输入恰好三条，无重放 |
| 进程回收 | 按旧引擎 PID + listen endpoint 核验并回收；测试结束后全部自有进程退出 |
| 完整 Windows worker | 真实 `worker.js` + 原生 RPC + PTY 连续两轮，各有一次 final_output；开场确认一次，无 user_notify |
| 飞书 daemon | 独立 profile 启动，官方 TraeX 自动发现成功，已连接飞书 |

完整 worker 实测线程：`01a0d60b-d2ba-73a2-9d70-b9bd892cc3b5`，两条输出分别为 `WORKER-ONE 中文、正常.` 与 `WORKER-TWO 中文、正常.`。

原生 RPC 实测线程：`01a0d607-9803-7c90-8ffa-7ddda18702e5`。可复跑命令与准确配置见 `windows/README.md`。认证实测脚本 `windows/verify-traex.mjs` 随运行包交付。

## win.3 恢复等待修复

授权后，win.2 的飞书首轮和连续第二轮均只回复一次，原生 thread 中也只有两条输入。daemon 重启后第三轮仍沿用相同 native thread，并正确回复前两轮标记，没有重放；但恢复后的输入被 viewer 启动等待拦住，最终依赖 90 秒兜底。这是恢复时延缺陷，不能将该次结果记为恢复路径全部正常。

win.3 在 Windows TraeX RPC 已确认 native thread 时解除仅供显示的 PTY 启动等待；保留输入权限、重启代际和不确定提交的原有 gates，不通过触发 idle 来伪造 turn 完成。其它平台和 CLI 不受这条分支影响。

| 项目 | win.3 结果 |
| --- | --- |
| 针对性回归 | 4 个文件、126 项通过：Windows RPC、上游 RPC lifecycle、普通消息真实 worker、input gate |
| 完整构建 | Bun 1.4.2 构建、类型检查、Dashboard 及产物审计通过 |
| 恢复负向复现 | win.2 真实 worker 恢复测试在 30 秒内无提交确认并超时 |
| 完整 Windows worker | 同一脚本约束下，fresh 两轮 + 新 worker 恢复第三轮通过，恰好 3 个 final_output、每代 1 次开场提交确认、0 个 user_notify |
| 恢复输入耗时 | 新 worker 启动起 8,519 ms 获得恢复输入确认，低于 30 秒阈值；已消除测试中的 90 秒 viewer 等待 |
| worker 进程清理 | 每代关闭后，测试记录的自有 engine/viewer PID 全部退出 |
| Node 22.23.3 / 24.21.0 | win.3 CLI 版本、argv、ConPTY 与进程树 smoke 均通过 |
| 安装激活 | 6,855 个清单文件校验通过；当前版本 win.3，previous 为 win.2，含空格目录安装成功 |

实机验证脚本为包内 `windows/verify-worker.mjs`；native thread `01a0d65c-fddd-7191-8d9c-63d7b9a963ff`；本次证据目录 `C:\Users\qiaogang\AppData\Local\Temp\botmux-worker-rpc-xyXdcC`。win.2 的逐字输入/原生 viewer 测试记录见上一节，未冒充 win.3 重跑结果。

## 飞书验收记录

跨机器人授权已由用户完成；最初待处理的首条消息随后自动执行。win.2 实测三条正文各出现一次：

- `WIN2-ONE 中文、顿号、正常。`
- `WIN2-TWO 中文、顿号、正常。`
- `WIN2-THREE 中文、恢复、正常；前两轮：WIN2-ONE、WIN2-TWO。`

群会话 BotMux ID：`a8740002-09a0-44e7-9c7d-ce3857178fdc`；原生 thread：`01a0d63c-9cb8-77b2-9ecf-d0a2612969f5`。win.2 第三轮到达 `02:12:39Z`，thread 恢复 `02:12:44Z`，实际提交 `02:14:18Z`，模型完成 `02:14:37Z`。上述时序是 win.3 修复的依据。

win.3 升级后重新启动 daemon，两轮飞书消息均只得到一条正文回复：

| 请求 | 最终回复 | 最终消息 ID |
| --- | --- | --- |
| `WIN3-RESUMED` | `WIN3-RESUMED 中文、恢复、正常；上一轮：WIN2-THREE。` | `om_x100b6469ff1080a4c423b7c06517a82` |
| `WIN3-NEXT` | `WIN3-NEXT 中文、顿号、正常。` | `om_x100b6469facf24a4de2ec11c8f1e825` |

恢复消息于 `02:22:55.856Z` 到达，`02:23:01.282Z` 确认原 thread 恢复，`02:23:05.648Z` 提交输入，`02:23:26.052Z` 飞书最终回复可见。到达至输入提交约 **9.8 秒**，没有等待 90 秒兜底。连续下一轮于 `02:23:49.515Z` 到达，`02:23:51.334Z` 提交输入，`02:24:00.407Z` 最终回复可见。

最后通过原生 RPC `thread/read` 核验：仍是原 BotMux session 和原 native thread，恰好 **5 条输入、5 个 completed turns**，与群内 5 个唯一正文回复对应，未重放 win.2 的前三条。第五轮完整持久化输入与 daemon 记录逐字相等；恢复轮增加了上游生命周期提示包装，包含完整原输入，`user_message` 部分逐字相等。

冷启动超过上游运输确认窗口时，恢复轮仍出现一次“worker 已收到，暂未确认进入执行队列，请勿重发”的提示；约 10 秒后实际提交。该提示不代表重复执行，**本版未消除这一短暂提示**。连续下一轮没有该提示。

部署前确认测试实例的两个已存在会话都没有在执行的 turn；只检查非目标私聊会话的状态，未修改或唤醒其任务。安装时原 bots.json 校验一致；启动与测试后的唯一配置内容变化是该授权身份的正常 quotaState 使用计数，凭据及其它配置保留。群聊链路已验收；私聊完整功能没有另行作为本次通过项。

测试实例使用独立 `e2e rpc profile`。控制脚本 `C:\Users\qiaogang\AppData\Local\Temp\botmux-windows-rpc-e2e.ps1 -Action status|logs|stop|restart` 从 `active.json` 选择当前版本，仅在配置不存在时创建测试配置，升级保留已有配置和授权。Dashboard 监听 `127.0.0.1:19892`。第一版的 `e2e profile` 已停止，保留数据库作为诊断证据。

## 第一版已验证的安装维护能力

win.1 的标准构建、128 项相关回归和两项 POSIX PTY smoke 通过；Windows 实机完成 Node 22/24 运行、升级到演练版 win.9001、回滚到 win.1、损坏包拒绝且 active 指针不变、存活 fleet 拒绝激活、supervisor 启停/重启和日志读取。完整历史记录位于提交 `f9a2ff2`。这些升级/回滚演练属于 win.1 历史结果；win.3 本次验证了实际升级，未重复所有故障注入演练。

## 维护边界

安装和上游同步逻辑集中在 `windows/`，平台规则集中在 `src/host/runtime.ts`。保留上游依赖图、`bun.lock` 和官方发布链；`package.json` 构建命令仅把外部 chmod 换成跨平台 Node 脚本。RPC 使用上游引擎和消息状态机，不复制另一套实现。升级时在独立 checkout 重放补丁、重建，并重新运行 Windows smoke 和认证输入验证；不能保证零冲突。

node-pty 1.1.0 退出释放涉及其内部 conout worker，未来升级必须重点复核。PTY 不保证 daemon 重启时终端进程存活，依赖原生 thread resume。Windows 文件沙盒、其它 CLI、Windows 11/ARM64、开机自启未列为通过。手动 GitHub Actions 已提供，尚未触发远端 CI。源码未 push，运行包未发布到 npm。
