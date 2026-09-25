[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+-win\.\d+$')]
  [string]$Version = '3.30.0-win.2',
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

function Invoke-Checked([string]$Program, [string[]]$Arguments, [string]$Description) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
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

if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
  throw 'This installer supports Windows 10/11 x64 only.'
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

$curlCommand = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curlCommand) { throw 'curl.exe is required (included with current Windows 10/11).' }
$tarPath = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tarPath)) { throw "Windows tar.exe was not found at $tarPath" }

$tag = "windows-v$Version"
$asset = "botmux-windows-x64-$Version.tgz"
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
  Invoke-Checked $curlCommand.Source @('--fail', '--location', '--silent', '--show-error', '--output', $archive, $ArchiveUrl) 'Package download'
  Invoke-Checked $curlCommand.Source @('--fail', '--location', '--silent', '--show-error', '--output', $checksum, $ChecksumUrl) 'Checksum download'

  $checksumText = Get-Content -Raw -LiteralPath $checksum
  $match = [regex]::Match($checksumText, '(?i)\b[0-9a-f]{64}\b')
  if (-not $match.Success) { throw 'The published checksum file is invalid.' }
  $expected = $match.Value.ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Package SHA-256 mismatch: expected $expected, got $actual" }
  Write-Host "SHA-256 verified: $actual"

  Invoke-Checked $tarPath @('-xzf', $archive, '-C', $candidate) 'Package extraction'
  $manifestPath = Join-Path $candidate 'windows-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'The downloaded archive is missing windows-manifest.json.' }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if ($manifest.version -ne $Version -or $manifest.platform -ne 'win32-x64') {
    throw "Unexpected package manifest: version=$($manifest.version), platform=$($manifest.platform)"
  }

  # The package manager performs a second, per-file integrity verification and
  # refuses activation while the current BotMux fleet is alive.
  Invoke-Checked $nodePath @((Join-Path $candidate 'windows\manage.mjs'), 'install', $candidate, '--root', $InstallRoot) 'BotMux installation'
  if (-not $NoPath) { Add-UserPath (Join-Path $InstallRoot 'bin') }

  Invoke-Checked $installedCommand @('--version') 'Installed BotMux verification'
  Write-Host ''
  Write-Host "BotMux $Version installed for the current user."
  Write-Host "Program: $InstallRoot"
  Write-Host "Config:  $(Join-Path $env:USERPROFILE '.botmux')"
  Write-Host 'Open a new terminal, then run: botmux setup'
  Write-Host 'When configuration is ready, run: botmux start'
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
