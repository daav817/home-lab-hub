# Seals the router login the clip keeper uses for the camera-clips share. Both values are typed
# at hidden prompts and go straight into a sealed secret; nothing is shown or saved in plain text.
#
# Before running: in SRM, create the shared folder "camera-clips" and a user (e.g. "clipkeeper")
# with Read/Write on camera-clips and No access to everything else, k8s-storage-folder included.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-camera-clips.ps1
$ErrorActionPreference = "Stop"
$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$out = Join-Path $PSScriptRoot "..\platform\cameras\manifests\camera-clips-smb.sealedsecret.yaml"
$kustomization = Join-Path $PSScriptRoot "..\platform\cameras\manifests\kustomization.yaml"

function Read-Hidden($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$values = [ordered]@{
  SMB_USER     = (Read-Hidden "Router user for camera-clips (e.g. clipkeeper)").Trim()
  SMB_PASSWORD = Read-Hidden "That user's password"
}
foreach ($name in $values.Keys) {
  if (-not $values[$name]) { throw "$name was empty. Nothing was saved." }
}

$encoded = @{}
foreach ($name in $values.Keys) {
  $encoded[$name] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($values[$name]))
}
$secret = @{
  apiVersion = "v1"; kind = "Secret"; type = "Opaque"
  metadata = @{ name = "camera-clips-smb"; namespace = "cameras" }
  data = $encoded
} | ConvertTo-Json -Depth 5 -Compress

$OutputEncoding = New-Object Text.UTF8Encoding($false)
$sealed = $secret | & $kubeseal --format yaml
if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }
[IO.File]::WriteAllText($out, (($sealed -join "`n") + "`n"))
Write-Host "Saved $out"

# List it in the kustomization once, so Argo CD applies it.
$text = [IO.File]::ReadAllText($kustomization)
if ($text -notmatch "camera-clips-smb\.sealedsecret\.yaml") {
  $text = $text -replace "(?m)^(  - clip-keeper-api\.sealedsecret\.yaml)$", "`$1`n  - camera-clips-smb.sealedsecret.yaml"
  [IO.File]::WriteAllText($kustomization, $text)
  Write-Host "Added it to platform\cameras\manifests\kustomization.yaml"
}
Write-Host "Done. Tell Claude the file is saved."
