# Windows native 候选版验证记录

验证日期：2026-09-25。当前版本：`3.29.0-win.4`。

- 上游：`deepcoldy/botmux`，tag `v3.29.0`，commit `7fab8e0322ecc0ab05e89ddf9d022adbf409ec0d`。
- 运行包源码：`150299b952869ac5aa3f67794c49db8dd0f3880e`；源码无未提交修改时打包。
- Runtime build ID：`81cf1545481f9072d72f1c3ebe820e7e53f4977cda8023f279e3fa31c51e2ac3`。
- `windows-native-win4.tgz`：37,260,273 bytes，SHA-256 `c323e34ce2684506f22b64f3f7161ec4037f7c4554e4ee9b6a77df743143989d`（Windows 本机生成）。

## win.4 Windows 本机源码构建

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
