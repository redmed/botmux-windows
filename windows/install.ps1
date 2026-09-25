[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+-win\.\d+$')]
  [string]$Version = '3.30.0-win.4',
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
  [string]$Repository = 'redmed/botmux-windows',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'BotmuxWindows'),
  [string]$ArchiveUrl,
  [string]$ChecksumUrl,
  [switch]$NoPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$invokedAsProcessFile = $PSCommandPath -and $MyInvocation.InvocationName -eq $PSCommandPath

function Remove-NodeWarningLines([object[]]$Output) {
  return @($Output | ForEach-Object { "$_" } | Where-Object {
    $_ -notmatch '^\(node:\d+\) \[UNDICI-EHPA\] Warning:' -and
    $_ -notmatch '^\(Use .*node --trace-warnings'
  })
}

function Invoke-Checked([string]$Program, [string[]]$Arguments, [string]$Description, [switch]$CaptureOutput) {
  if ($CaptureOutput) {
    $captured = @(& $Program @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $clean = @(Remove-NodeWarningLines $captured)
    if ($exitCode -ne 0) {
      $detail = $clean | Where-Object { $_.Trim() } | Select-Object -Last 1
      if (-not $detail) { $detail = "exit code $exitCode" }
      throw "${Description} failed: $detail"
    }
    $clean | ForEach-Object { Write-Host $_ }
    return
  }
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

function Save-RemoteFile([string]$Uri, [string]$Destination, [string]$Description) {
  $curlCommand = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curlCommand) {
    Invoke-Checked $curlCommand.Source @('--fail', '--location', '--silent', '--show-error', '--output', $Destination, $Uri) $Description -CaptureOutput
    return
  }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
  } catch {
    throw "${Description} failed: $($_.Exception.Message)"
  }
}

function Add-UserPath([string]$Directory) {
  $full = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($null -eq $current) { $current = '' }
  $entries = @($current -split ';' | Where-Object { $_ })
  if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $full })) {
    $next = if ($current.Trim()) { $current.TrimEnd(';') + ';' + $full } else { $full }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    Write-Host "Added to the current user's PATH: $full"

    if (-not ('BotMux.WindowsEnvironment' -as [type])) {
      Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace BotMux {
  public static class WindowsEnvironment {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(
      IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
      uint flags, uint timeout, out UIntPtr result);
  }
}
'@
    }
    $result = [UIntPtr]::Zero
    [void][BotMux.WindowsEnvironment]::SendMessageTimeout(
      [IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
  }
  if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $full })) {
    $env:Path = $full + ';' + $env:Path
  }
}

function Show-InstallerFailure([string]$Message) {
  $reason = $Message
  $action = '请根据上述原因处理后，重新运行安装命令。'
  $unchanged = $false
  if ($Message -match 'Stop the running BotMux fleet') {
    $reason = '检测到 BotMux 仍在运行，安装器已在切换版本前安全停止。'
    $action = '请先确认没有正在执行的任务，然后运行 botmux stop，再重新执行安装命令。'
    $unchanged = $true
  } elseif ($Message -match 'legacy BotMux PM2 process is alive') {
    $reason = '检测到旧版 BotMux PM2 进程仍在运行，安装器已安全停止。'
    $action = '请先停止旧版 PM2 BotMux 进程，再重新执行安装命令。'
    $unchanged = $true
  } elseif ($Message -match 'Version already exists with different contents') {
    $reason = '同一版本号已存在，但文件内容不同，安装器拒绝覆盖。'
    $action = '请发布一个递增的 Windows 修订版本，例如从 win.3 升级为 win.4。'
    $unchanged = $true
  } elseif ($Message -match 'Node\.js >= 22\.13\.0') {
    $reason = '未找到符合要求的 x64 Node.js，或 Node.js 版本低于 22.13.0。'
    $action = '请安装或切换到 x64 Node.js 22.13.0 及以上版本，重新打开 PowerShell 后再安装。'
  } elseif ($Message -match 'Package download failed|Checksum download failed') {
    $reason = '无法从 GitHub 下载 BotMux 安装文件。'
    $action = '请检查网络、代理和 GitHub 访问能力，然后重新运行安装命令。'
  } elseif ($Message -match 'SHA-256 mismatch|checksum file is invalid|Artifact integrity failed') {
    $reason = '安装包完整性校验失败，安装器未激活该版本。'
    $action = '请删除临时下载并重试；如果仍失败，请停止安装并报告该问题。'
    $unchanged = $true
  }

  Write-Host ''
  Write-Host 'BotMux 安装未完成' -ForegroundColor Red
  Write-Host "原因：$reason" -ForegroundColor Red
  Write-Host "处理：$action" -ForegroundColor Yellow
  if ($unchanged) { Write-Host '现有 BotMux 程序和用户数据未被修改。' -ForegroundColor DarkGray }
}

function Invoke-BotMuxInstaller {
if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
  throw "PowerShell 5.1 or newer is required; found $($PSVersionTable.PSVersion)."
}

if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Major -lt 10) {
  throw "Windows 10/11 is required; found $([Environment]::OSVersion.Version)."
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'A Windows x64 operating system is required.'
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js >= 22.13.0 is required. Install Node.js, open a new PowerShell window, and run this installer again.'
}
$nodePath = $nodeCommand.Source
$nodeVersionText = (& $nodePath -p 'process.versions.node').Trim()
$nodeVersion = [Version]'0.0'
if ($LASTEXITCODE -ne 0 -or -not [Version]::TryParse($nodeVersionText, [ref]$nodeVersion)) {
  throw 'Unable to determine the installed Node.js version.'
}
if ($nodeVersion -lt [Version]'22.13.0') {
  throw "Node.js >= 22.13.0 is required; found $nodeVersionText at $nodePath"
}
$nodeArch = (& $nodePath -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $nodeArch -ne 'x64') {
  throw "A Windows x64 Node.js runtime is required; found architecture '$nodeArch'."
}

$systemTar = Join-Path $env:SystemRoot 'System32\tar.exe'
$expandArchive = Get-Command Expand-Archive -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $systemTar) -and -not $expandArchive) {
  throw 'Package extraction requires either Windows tar.exe or PowerShell Expand-Archive.'
}

$tag = "windows-v$Version"
$asset = "botmux-windows-x64-$Version.zip"
$releaseBase = "https://github.com/$Repository/releases/download/$tag"
if (-not $ArchiveUrl) { $ArchiveUrl = "$releaseBase/$asset" }
if (-not $ChecksumUrl) { $ChecksumUrl = "$releaseBase/$asset.sha256" }

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("botmux-windows-install-" + [Guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempRoot $asset
$checksum = "$archive.sha256"
$candidate = Join-Path $tempRoot 'candidate'
$installedCommand = Join-Path $InstallRoot 'bin\botmux.cmd'

try {
  New-Item -ItemType Directory -Force -Path $candidate | Out-Null
  Write-Host "Downloading BotMux $Version for Windows x64..."
  Save-RemoteFile $ArchiveUrl $archive 'Package download'
  Save-RemoteFile $ChecksumUrl $checksum 'Checksum download'

  $checksumText = Get-Content -Raw -LiteralPath $checksum
  $match = [regex]::Match($checksumText, '(?i)\b[0-9a-f]{64}\b')
  if (-not $match.Success) { throw 'The published checksum file is invalid.' }
  $expected = $match.Value.ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Package SHA-256 mismatch: expected $expected, got $actual" }
  Write-Host "SHA-256 verified: $actual"

  if (Test-Path -LiteralPath $systemTar) {
    Invoke-Checked $systemTar @('-xf', $archive, '-C', $candidate) 'Package extraction' -CaptureOutput
  } else {
    Expand-Archive -LiteralPath $archive -DestinationPath $candidate -Force
  }
  $manifestPath = Join-Path $candidate 'windows-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'The downloaded archive is missing windows-manifest.json.' }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if ($manifest.version -ne $Version -or $manifest.platform -ne 'win32-x64') {
    throw "Unexpected package manifest: version=$($manifest.version), platform=$($manifest.platform)"
  }

  # The package manager performs a second, per-file integrity verification and
  # refuses activation while the current BotMux fleet is alive.
  Invoke-Checked $nodePath @((Join-Path $candidate 'windows\manage.mjs'), 'install', $candidate, '--root', $InstallRoot) 'BotMux installation' -CaptureOutput
  if (-not $NoPath) { Add-UserPath (Join-Path $InstallRoot 'bin') }

  Invoke-Checked $installedCommand @('--version') 'Installed BotMux verification' -CaptureOutput
  Write-Host ''
  Write-Host "BotMux $Version installed for the current user."
  Write-Host "Program: $InstallRoot"
  Write-Host "Config:  $(Join-Path $env:USERPROFILE '.botmux')"
  Write-Host 'Open a new terminal, then run: botmux setup'
  Write-Host 'When configuration is ready, run: botmux start'
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
}

$previousNodeNoWarnings = $env:NODE_NO_WARNINGS
try {
  $env:NODE_NO_WARNINGS = '1'
  Invoke-BotMuxInstaller
} catch {
  Show-InstallerFailure $_.Exception.Message
  $global:LASTEXITCODE = 1
  if ($invokedAsProcessFile) { exit 1 }
} finally {
  if ($null -eq $previousNodeNoWarnings) { Remove-Item Env:NODE_NO_WARNINGS -ErrorAction SilentlyContinue }
  else { $env:NODE_NO_WARNINGS = $previousNodeNoWarnings }
}
