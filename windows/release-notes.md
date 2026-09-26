# BotMux Windows

适用于 Windows 10/11 x64。目标机器需要预先安装 x64 Node.js 22.13.0 或更高版本；安装已编译版本不需要 Git、Bun、Python、Visual Studio 或 Linux。

## 直接安装

在 PowerShell 中运行：

```powershell
curl.exe -fsSL https://github.com/redmed/botmux-windows/releases/latest/download/install.ps1 | Out-String | Invoke-Expression
```

如果系统没有 `curl.exe`，可运行：

```powershell
(Invoke-WebRequest -UseBasicParsing https://github.com/redmed/botmux-windows/releases/latest/download/install.ps1).Content | Invoke-Expression
```

在 Git Bash 中运行：

```bash
curl.exe -fsSL https://github.com/redmed/botmux-windows/releases/latest/download/install-git-bash.sh | bash
```

安装完成后新开一个终端，并依次运行：

```powershell
botmux setup
botmux autostart enable
botmux start
```

完整的安装、升级、回滚和排错说明见 [README.fork.md：推荐安装已编译版本](https://github.com/redmed/botmux-windows/blob/windows/native-v3.30.0/README.fork.md#%E6%8E%A8%E8%8D%90%E5%AE%89%E8%A3%85%E5%B7%B2%E7%BC%96%E8%AF%91%E7%89%88%E6%9C%AC)。

本 Release 的 Windows x64 运行包由 Linux 构建，并已在 Windows 的 Node.js 22 和 24 环境中验证。请使用随附的 SHA-256 文件核验下载内容。
