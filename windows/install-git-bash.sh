#!/usr/bin/env bash

set -u

case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    printf '%s\n' 'BotMux 安装未完成' >&2
    printf '%s\n' '原因：此入口仅支持 Windows 上的 Git Bash。' >&2
    printf '%s\n' '处理：请在 Git Bash 中运行，或改用 Windows PowerShell 安装命令。' >&2
    exit 1
    ;;
esac

if ! command -v powershell.exe >/dev/null 2>&1; then
  printf '%s\n' 'BotMux 安装未完成' >&2
  printf '%s\n' '原因：未找到 Windows PowerShell。' >&2
  printf '%s\n' '处理：请确认 powershell.exe 可用，再重新执行安装命令。' >&2
  exit 1
fi

if ! command -v cygpath >/dev/null 2>&1; then
  printf '%s\n' 'BotMux 安装未完成' >&2
  printf '%s\n' '原因：当前终端缺少 Git Bash 自带的 cygpath。' >&2
  printf '%s\n' '处理：请使用完整安装的 Git for Windows，或改用 Windows PowerShell。' >&2
  exit 1
fi

if command -v curl.exe >/dev/null 2>&1; then
  curl_command='curl.exe'
elif command -v curl >/dev/null 2>&1; then
  curl_command='curl'
else
  printf '%s\n' 'BotMux 安装未完成' >&2
  printf '%s\n' '原因：当前 Git Bash 中未找到 curl。' >&2
  printf '%s\n' '处理：请修复 Git for Windows 安装，或改用 Windows PowerShell。' >&2
  exit 1
fi

installer_url="${BOTMUX_INSTALLER_URL:-https://github.com/redmed/botmux-windows/releases/latest/download/install.ps1}"
installer_file="$(mktemp -t botmux-install.XXXXXX.ps1)" || {
  printf '%s\n' 'BotMux 安装未完成：无法创建临时文件。' >&2
  exit 1
}
trap 'rm -f "$installer_file"' EXIT

if ! "$curl_command" -fsSL "$installer_url" -o "$installer_file"; then
  printf '%s\n' 'BotMux 安装未完成' >&2
  printf '%s\n' '原因：无法下载安装脚本。' >&2
  printf '%s\n' '处理：请检查网络、代理和 GitHub 访问能力后重试。' >&2
  exit 1
fi

windows_installer="$(cygpath -w "$installer_file")" || {
  printf '%s\n' 'BotMux 安装未完成：无法转换临时文件路径。' >&2
  exit 1
}

# Git Bash uses UTF-8, while Windows PowerShell 5.1 otherwise inherits the
# machine's legacy console code page and can render the Chinese diagnosis as
# mojibake.
chcp.com 65001 >/dev/null 2>&1 || true
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$windows_installer" "$@" < /dev/null
