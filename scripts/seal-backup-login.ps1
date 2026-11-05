# Seals the router login Longhorn uses for backups. The password is typed at a hidden
# prompt, so it never appears in chat, shell history or git. The output is safe to commit.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-backup-login.ps1

$ErrorActionPreference = "Stop"

$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$output = Join-Path $PSScriptRoot "..\platform\longhorn-backup\manifests\cifs-secret.sealedsecret.yaml"

$secure = Read-Host "Paste the k8s-storage router password (nothing will show)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

if (-not $password) { throw "No password entered. Nothing was saved." }

$secret = @{
  apiVersion = "v1"
  kind       = "Secret"
  metadata   = @{ name = "cifs-secret"; namespace = "longhorn-system" }
  type       = "Opaque"
  stringData = @{ CIFS_USERNAME = "k8s-storage"; CIFS_PASSWORD = $password }
} | ConvertTo-Json -Depth 5

$sealed = $secret | & $kubeseal --format yaml
if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }

$sealed | Out-File -Encoding ascii $output
Write-Host "Sealed login saved to platform\longhorn-backup\manifests\cifs-secret.sealedsecret.yaml"
