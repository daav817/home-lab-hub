# Seals the router login the hub's Files and Drives pages use, plus a random token Prometheus
# uses to read the drive usage (/api/metrics). The login is typed at hidden prompts and goes
# straight into sealed secrets; nothing is shown or saved in plain text.
#
# Before running, in SRM (Control Panel > User): create a user (e.g. "hubfiles"), not an
# administrator, with Read/Write on the shares the hub should show (photo, video, music,
# Public_WD, and any you add later) and No access to k8s-storage-folder, camera-clips,
# usbshare1 and usbshare2. Turn on each share's Recycle Bin (Control Panel > Shared Folder >
# Edit) so deletes made through the hub can be undone.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-router-files.ps1
$ErrorActionPreference = "Stop"
$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$k8s = Join-Path $PSScriptRoot "..\k8s"
$kustomization = Join-Path $k8s "kustomization.yaml"

function Read-Hidden($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Seal($name, $values) {
  $encoded = @{}
  foreach ($key in $values.Keys) {
    if (-not $values[$key]) { throw "$key was empty. Nothing was saved." }
    $encoded[$key] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($values[$key]))
  }
  $secret = @{
    apiVersion = "v1"; kind = "Secret"; type = "Opaque"
    metadata = @{ name = $name; namespace = "hub" }
    data = $encoded
  } | ConvertTo-Json -Depth 5 -Compress
  $OutputEncoding = New-Object Text.UTF8Encoding($false)
  $sealed = $secret | & $kubeseal --format yaml
  if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }
  $out = Join-Path $k8s "$name.sealedsecret.yaml"
  [IO.File]::WriteAllText($out, (($sealed -join "`n") + "`n"))
  Write-Host "Saved $out"

  # List it in the kustomization once, so Argo CD applies it.
  $text = [IO.File]::ReadAllText($kustomization)
  if ($text -notmatch [regex]::Escape("$name.sealedsecret.yaml")) {
    $text = $text -replace "(?m)^(  - hub-clips\.sealedsecret\.yaml)$", "`$1`n  - $name.sealedsecret.yaml"
    [IO.File]::WriteAllText($kustomization, $text)
    Write-Host "Added it to k8s\kustomization.yaml"
  }
}

$user = (Read-Hidden "Router user for the hub's Files page (e.g. hubfiles)").Trim()
$password = Read-Hidden "That user's password"
Seal "hub-router" ([ordered]@{ SMB_USER = $user; SMB_PASSWORD = $password })

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
Seal "hub-metrics" ([ordered]@{ METRICS_TOKEN = (($bytes | ForEach-Object { $_.ToString("x2") }) -join "") })

Write-Host "Done. Tell Claude the files are saved."
