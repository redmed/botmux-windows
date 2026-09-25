# Windows native 候选版验证记录

验证日期：2026-09-25。当前版本：`3.29.0-win.3`。

- 上游：`deepcoldy/botmux`，tag `v3.29.0`，commit `7fab8e0322ecc0ab05e89ddf9d022adbf409ec0d`。
- 运行包源码：`72ee5e93015664b751564b3fa58a913e15496c4f`；源码无未提交修改时打包。
- Runtime build ID：`81cf1545481f9072d72f1c3ebe820e7e53f4977cda8023f279e3fa31c51e2ac3`。
- `windows-native-win3.tgz`：37,504,194 bytes，SHA-256 `788d38a1d26eafbfd1338f9f490fb5edca24928d388a4322dc889c09f65dc2b1`。

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

安装和上游同步逻辑集中在 `windows/`，平台规则集中在 `src/host/runtime.ts`。保留上游 `package.json`、`bun.lock`、官方发布链。RPC 使用上游引擎和消息状态机，不复制另一套实现。升级时在独立 checkout 重放补丁、重建，并重新运行 Windows smoke 和认证输入验证；不能保证零冲突。

node-pty 1.1.0 退出释放涉及其内部 conout worker，未来升级必须重点复核。PTY 不保证 daemon 重启时终端进程存活，依赖原生 thread resume。Windows 文件沙盒、其它 CLI、Windows 11/ARM64、开机自启未列为通过。手动 GitHub Actions 已提供，尚未触发远端 CI。源码未 push，运行包未发布到 npm。
