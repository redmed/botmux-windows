# Windows native 候选版验证记录

验证日期：2026-09-25。当前版本：`3.29.0-win.2`。

- 上游：`deepcoldy/botmux`，tag `v3.29.0`，commit `7fab8e0322ecc0ab05e89ddf9d022adbf409ec0d`。
- 运行包源码：`c71856f9ff9737662f67dd972b9b2d77e13c6547`；源码无未提交修改时打包。
- Runtime build ID：`f00cbbc41a75878ef61f5dab7e5bb42ca049e6effc1f558fe56cc49b4caa0cbe`。
- `windows-native-win2.tgz`：37,496,333 bytes，SHA-256 `7fab01754d9f5a5bb07cb35772f709449ee3b18d7f96fc3e1aade72366e7f4c2`。

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

## 飞书验收状态

第二版向测试机器人发送了 `WIN2-ONE` 请求。消息已抵达 Windows daemon，但被上游跨机器人身份校验拦截（`no_sibling_with_name`），因此未进入模型。授权请求卡已发出，需群内 owner 操作。**第二版飞书连续回复、无重复与 daemon 重启恢复仍待验收，不能用原生 RPC 测试代替。**

测试实例使用 `e2e rpc profile`，程序位于 `installed-rpc with spaces/releases/3.29.0-win.2`。控制脚本 `C:\Users\qiaogang\AppData\Local\Temp\botmux-windows-rpc-e2e.ps1 -Action status|logs|stop|restart`。Dashboard 监听 `127.0.0.1:19892`。第一版的 `e2e profile` 已停止，保留数据库作为诊断证据。

## 第一版已验证的安装维护能力

win.1 的标准构建、128 项相关回归和两项 POSIX PTY smoke 通过；Windows 实机完成 Node 22/24 运行、升级到演练版 win.9001、回滚到 win.1、损坏包拒绝且 active 指针不变、存活 fleet 拒绝激活、supervisor 启停/重启和日志读取。完整历史记录位于提交 `f9a2ff2`。这些升级/回滚演练未冒充第二版飞书对话验收。

## 维护边界

安装和上游同步逻辑集中在 `windows/`，平台规则集中在 `src/host/runtime.ts`。保留上游 `package.json`、`bun.lock`、官方发布链。RPC 使用上游引擎和消息状态机，不复制另一套实现。升级时在独立 checkout 重放补丁、重建，并重新运行 Windows smoke 和认证输入验证；不能保证零冲突。

node-pty 1.1.0 退出释放涉及其内部 conout worker，未来升级必须重点复核。PTY 不保证 daemon 重启时终端进程存活，依赖原生 thread resume。Windows 文件沙盒、其它 CLI、Windows 11/ARM64、开机自启未列为通过。手动 GitHub Actions 已提供，尚未触发远端 CI。源码未 push，运行包未发布到 npm。
