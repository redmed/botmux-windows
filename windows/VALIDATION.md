# Windows native 候选版验证记录

验证日期：2026-09-25。版本：`3.29.0-win.1`。

- 上游：`deepcoldy/botmux`，tag `v3.29.0`，commit `7fab8e0322ecc0ab05e89ddf9d022adbf409ec0d`。
- 运行包源码：`b680a5a1e80f8992bfd705cc2d63766c5bb777f9`；源码无未提交修改时打包。
- Runtime build ID：`afe51e3c2015382b21f54ee8dd9ae71b6f15997f57edb103e069974192255353`。
- `windows-native.tgz`：37,499,412 bytes，SHA-256 `7456658eba83b3c98689311181176b34709a76eb984375404cdc69143a51ce2e`。

## 已完成

| 项目 | 结果 |
| --- | --- |
| Bun 1.4.2 frozen install、标准 `bun run build` | 通过；含源码/脚本/mock 类型检查、Dashboard bundle、产物和嵌入资产审计 |
| Windows host/installer、executable、shell parsing、PTY backend、log follower、autostart、fleet identity/runtime、wrapper | 128 项通过 |
| POSIX native PTY smoke | 2 项通过；异步 verifier 失败用例更新后 installer 4 项重跑通过 |
| dev-win / Windows 10 x64 build 19045 | 实机验证，无 WSL2 |
| Node 22.23.3 安装到含空格路径 | 清单校验、复制、ConPTY 验证、激活及安装后 `.cmd --version` 通过 |
| Node 24.21.0 运行已安装包 | CLI 版本、ConPTY、TraeX 验证通过 |
| Native argv | 中文、空格、引号、反斜杠、百分号、感叹号、&、多行参数通过 |
| Batch argv | 含空格路径、中文和 & 参数通过；不可安全表达的字符明确拒绝 |
| 进程生命周期 | 自然退出、进程树强制终止、重复关闭通过；验证进程自然结束，无 `AttachConsole failed` |
| 真实 TraeX | 官方完整 native 安装 `0.207.1 internal edition` 的 `--version` 通过 |
| Windows 升级/回滚 | 使用演练版本 win.9001 升级，再回滚到 win.1，两次真实 verifier 均通过；原配置及稳定 launcher 不变 |
| Windows 安装保护 | 损坏包被拒绝且 active 指针不变；存活 fleet 的激活请求被拒绝 |
| Windows daemon | 从最终安装目录启动真实测试 bot，status 两进程 online、Dashboard HTTP 200、logs --no-follow 正常中文并退出 |
| 上游同步脚本 | 在新 checkout 对同一 tag 重放补丁成功；注释标签解析为 commit；未修改安装和服务 |
| 最终安装版 daemon restart | 旧 supervisor/daemon/dashboard PID 均退出，新进程重新上线；会话恢复仍待真实消息 |
| 原配置与 launcher | 测试隔离修正后，2 个原 launcher 和 bots/ecosystem 配置的 SHA-256 与测试前一致 |

## 尚待完成的验收

- 飞书首条及连续回复、中文无重复、私聊 `scope=chat`、重启恢复：需要实际收到测试消息后确认。

## 维护边界

核心只修改 5 个既有文件，另新增 `src/host/runtime.ts`；安装和上游同步逻辑集中在 `windows/`。保留上游 `package.json`、`bun.lock`、官方发布链。上游升级仍需重建和 Windows 验证，不能保证零冲突。

node-pty 1.1.0 退出释放涉及其内部 conout worker；未来升级必须重点复核。PTY 不保证 daemon 重启时终端进程存活。Windows 文件沙盒、其他 CLI、Windows 11/ARM64、开机自启和 UI 截图尚未列为通过。手动 GitHub Actions 已提供，但未触发远端 CI。

## 当前测试入口

测试服务留在 dev-win 的独立 profile，使用最终安装包等待真实消息。程序目录 `C:\Users\qiaogang\develop\botmux-windows-lab\installed-final with spaces`，测试数据位于同级 `e2e profile`。本机控制脚本 `C:\Users\qiaogang\AppData\Local\Temp\botmux-windows-e2e.ps1 -Action status|logs|stop|restart`。Dashboard 监听 `127.0.0.1:19892`。旧安装保持 stopped，原配置和 launcher 未切换到新版本。

当前 CLI 没有用户身份发送消息权限，因此未代发测试用户消息；等待用户私聊测试机器人或拉群后 @ 它。已连接飞书不等于完整对话验收通过。
