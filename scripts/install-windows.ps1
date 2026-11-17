#requires -Version 5.1
<## Installs the official GitHub main branch, or an exact commit from it. ##>
[CmdletBinding()]
param(
    [string]$Commit = '',
    [string]$Root = '',
    [string]$AppDir = '',
    [int]$WaitPid = 0,
    [switch]$NoLaunch,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Help) {
    Write-Output @'
Install Elysium from GitHub (Windows 10/11 x64).
Usage: .\install-windows.ps1 [-Commit FULL_SHA] [-Root DIRECTORY] [-AppDir DIRECTORY]
                             [-WaitPid PID] [-NoLaunch] [-Help]
Defaults: %LOCALAPPDATA%\Programs\Elysium; source/tools/logs in %LOCALAPPDATA%\Elysium.
Installs missing Git, Node.js 24, Rust stable, and Visual Studio C++ Build Tools.
The NSIS installer installs WebView2 if needed. Administrator prompts may appear for build tools.
Private repositories require GitHub access through Git credentials (e.g. gh auth setup-git).
'@
    exit 0
}
if ($Commit -and $Commit -cnotmatch '^[0-9a-f]{40}$') { throw '-Commit must be a full lowercase Git SHA (40 characters).' }
if ($WaitPid -lt 0) { throw 'Invalid process ID.' }
if ($env:OS -ne 'Windows_NT') { throw 'Use install-macos.sh on macOS.' }
if (-not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Use 64-bit PowerShell on an x64 Windows computer.' }
if (-not $Root) { $Root = if ($env:ELYSIUM_INSTALL_ROOT) { $env:ELYSIUM_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'Elysium' } }
if (-not $AppDir) { $AppDir = Join-Path $env:LOCALAPPDATA 'Programs\Elysium' }
if (-not [IO.Path]::IsPathRooted($Root) -or -not [IO.Path]::IsPathRooted($AppDir)) { throw 'Installation folders must be absolute paths.' }
if ($AppDir.Contains('"')) { throw 'Invalid application folder.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repository = 'https://github.com/ooberguts/Elysium.git'
$null = New-Item -ItemType Directory -Force -Path $Root, "$Root\tools", "$Root\logs"
$InstallLock = $null
$TranscriptStarted = $false
$Work = Join-Path $Root ('install-' + [guid]::NewGuid().ToString('N'))

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}
function Download([string]$Url, [string]$Destination) {
    for ($Attempt = 0; $Attempt -lt 3; $Attempt++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 600; return }
        catch { if ($Attempt -eq 2) { throw }; Start-Sleep -Seconds 3 }
    }
}
function Refresh-Tools {
    $env:Path = "$Root\tools\node;$env:USERPROFILE\.cargo\bin;$env:ProgramFiles\Git\cmd;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
}
function Install-WinGet([string]$Id, [string[]]$Extra = @()) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        Write-Host 'Installing Microsoft WinGet for this user...'
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null
        Install-Module -Name Microsoft.WinGet.Client -Scope CurrentUser -Force -Repository PSGallery
        Import-Module Microsoft.WinGet.Client
        Repair-WinGetPackageManager -Force -Latest
        Refresh-Tools
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'WinGet could not be installed. Install Microsoft App Installer from https://aka.ms/getwinget, then retry.' }
    }
    Invoke-Checked 'winget.exe' (@('install', '--exact', '--id', $Id, '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') + $Extra)
    Refresh-Tools
}
function Test-WindowsSdk {
    $KitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\"
    $Registered = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue
    if ($Registered -and $Registered.PSObject.Properties['KitsRoot10']) { $KitsRoot = $Registered.KitsRoot10 }
    $Libraries = @(Get-ChildItem (Join-Path $KitsRoot 'Lib') -Directory -ErrorAction SilentlyContinue | Where-Object {
        (Test-Path (Join-Path $_.FullName 'um\x64\kernel32.lib')) -and (Test-Path (Join-Path $_.FullName 'ucrt\x64\ucrt.lib'))
    })
    return $Libraries.Count -gt 0
}
try {
    try { $InstallLock = [IO.File]::Open("$Root\install.lock", 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another Elysium installation is active. Wait for it to finish.' }
    $null = New-Item -ItemType Directory -Path $Work
    $Log = Join-Path $Root ('logs\install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    Start-Transcript -Path $Log | Out-Null
    $TranscriptStarted = $true
    Write-Host "Elysium installer - log: $Log"
    Refresh-Tools
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { Install-WinGet 'Git.Git' }
    $NodeReady = $false
    if (Get-Command node.exe -ErrorAction SilentlyContinue) {
        & node.exe -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'
        $NodeReady = $LASTEXITCODE -eq 0
    }
    if (-not $NodeReady) {
        Write-Host 'Installing a private Node.js 24 toolchain...'
        Download 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' "$Work\SHASUMS256.txt"
        $Match = [regex]::Match((Get-Content "$Work\SHASUMS256.txt" -Raw), '(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-x64\.zip)\r?$')
        if (-not $Match.Success) { throw 'Could not resolve the Node.js 24 download.' }
        $NodeFile = $Match.Groups[2].Value
        Download "https://nodejs.org/dist/latest-v24.x/$NodeFile" "$Work\$NodeFile"
        if ((Get-FileHash "$Work\$NodeFile" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Match.Groups[1].Value) { throw 'Node.js checksum mismatch.' }
        Expand-Archive -Path "$Work\$NodeFile" -DestinationPath "$Work\node"
        if (Test-Path "$Root\tools\node") { Remove-Item "$Root\tools\node" -Recurse -Force }
        Move-Item "$Work\node\$($NodeFile -replace '\.zip$', '')" "$Root\tools\node"
        Refresh-Tools
    }
    $VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $VsPath = $null
    if (Test-Path $VsWhere) {
        $VsPath = & $VsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    }
    if (-not $VsPath -or -not (Test-WindowsSdk)) {
        $Existing = $null
        if (Test-Path $VsWhere) { $Existing = & $VsWhere -latest -products Microsoft.VisualStudio.Product.BuildTools -property installationPath }
        if ($Existing) {
            $Setup = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
            $Process = Start-Process -FilePath $Setup -Verb RunAs -Wait -PassThru -ArgumentList "modify --installPath `"$Existing`" --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart"
            if ($Process.ExitCode -notin @(0, 3010)) { throw 'Visual Studio C++ tools installation failed.' }
        } else {
            Install-WinGet 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
        }
        if (-not (Test-Path $VsWhere)) { throw 'Visual Studio Build Tools are missing. Restart Windows if requested, then retry.' }
        $VsPath = & $VsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if (-not $VsPath) { throw 'The Visual Studio C++ workload is missing. Restart Windows if requested, then retry.' }
        if (-not (Test-WindowsSdk)) { throw 'The Windows SDK is missing. Install the recommended Windows SDK in Visual Studio Installer, then retry.' }
    }
    if (-not (Get-Command rustup.exe -ErrorAction SilentlyContinue)) {
        Download 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' "$Work\rustup-init.exe"
        Invoke-Checked "$Work\rustup-init.exe" @('-y', '--profile', 'minimal', '--default-host', 'x86_64-pc-windows-msvc', '--default-toolchain', 'stable', '--no-modify-path')
        Refresh-Tools
    }
    Invoke-Checked 'rustup.exe' @('toolchain', 'install', 'stable-x86_64-pc-windows-msvc', '--profile', 'minimal')
    $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
    $Source = Join-Path $Root 'source'
    if (Test-Path $Source) {
        if (-not (Test-Path "$Source\.git")) { throw "$Source already exists but is not a Git checkout. Choose another -Root." }
        $Origin = & git.exe -C $Source remote get-url origin
        if ($LASTEXITCODE -ne 0 -or $Origin -ne $Repository) { throw 'The managed source folder has a different origin; it will not be changed.' }
        $Changes = & git.exe -C $Source status --porcelain
        if ($LASTEXITCODE -ne 0 -or $Changes) { throw 'The managed checkout contains local edits. Save them elsewhere before updating.' }
    } else {
        Invoke-Checked 'git.exe' @('clone', '--branch', 'main', $Repository, $Source)
    }
    Invoke-Checked 'git.exe' @('-C', $Source, 'fetch', '--prune', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    $Target = $Commit
    if (-not $Target) {
        $Target = & git.exe -C $Source rev-parse refs/remotes/origin/main
        if ($LASTEXITCODE -ne 0 -or $Target -cnotmatch '^[0-9a-f]{40}$') { throw 'Cannot resolve the official main branch.' }
    }
    Invoke-Checked 'git.exe' @('-C', $Source, 'cat-file', '-e', "$Target`^{commit}")
    Invoke-Checked 'git.exe' @('-C', $Source, 'merge-base', '--is-ancestor', $Target, 'refs/remotes/origin/main')
    Invoke-Checked 'git.exe' @('-C', $Source, '-c', 'advice.detachedHead=false', 'checkout', '--detach', $Target)
    $CheckedOut = & git.exe -C $Source rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $CheckedOut -ne $Target) { throw 'Git did not check out the requested commit.' }
    Write-Host "Building Elysium - commit $Target (the first build can take several minutes)..."
    Push-Location $Source
    try {
        Invoke-Checked 'npm.cmd' @('ci', '--no-audit', '--no-fund')
        Invoke-Checked 'npm.cmd' @('run', 'prepare:media')
        # Prevent an old installer from being mistaken for a successful new build.
        if (Test-Path 'src-tauri\target\release\bundle\nsis') { Remove-Item 'src-tauri\target\release\bundle\nsis' -Recurse -Force }
        Invoke-Checked 'npm.cmd' @('run', 'tauri', '--', 'build', '--locked', '--bundles', 'nsis')
    } finally { Pop-Location }
    $Installers = @(Get-ChildItem "$Source\src-tauri\target\release\bundle\nsis\*.exe")
    if ($Installers.Count -ne 1) { throw 'Expected one new NSIS installer after building.' }
    if ($WaitPid -gt 0) {
        Write-Host 'Build ready. Quit Elysium to finish installing; it will reopen automatically.'
        Wait-Process -Id $WaitPid -ErrorAction SilentlyContinue
    }
    while (Get-Process -Name elysium -ErrorAction SilentlyContinue) {
        Write-Host 'Quit Elysium to finish installing.'
        Start-Sleep -Seconds 2
    }
    # NSIS /D must be last and unquoted, including paths containing spaces.
    $Process = Start-Process -FilePath $Installers[0].FullName -Wait -PassThru -ArgumentList "/S /D=$AppDir"
    if ($Process.ExitCode -ne 0) { throw "The app installer failed (exit $($Process.ExitCode))." }
    if (-not (Test-Path "$AppDir\elysium.exe")) { throw "The app was not installed at $AppDir." }
    Set-Content -Path "$Root\installed-commit.txt" -Value $Target -Encoding Ascii
    $Record = @{ root = $Root; repository = $Repository } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $AppDir '.elysium-install.json'), $Record, (New-Object Text.UTF8Encoding $false))
    Write-Host "Installed Elysium - $($Target.Substring(0,12)) at $AppDir"
    if (-not $NoLaunch) { Start-Process -FilePath "$AppDir\elysium.exe" }
} catch {
    Write-Host "Installation failed: $_" -ForegroundColor Red
    Write-Host "Private repository? Sign in with gh auth login and gh auth setup-git. Logs: $Root\logs"
    throw
} finally {
    if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
    if ($InstallLock) { $InstallLock.Dispose() }
    if ($TranscriptStarted) { Stop-Transcript | Out-Null }
}
