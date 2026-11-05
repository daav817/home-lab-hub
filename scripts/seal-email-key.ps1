# Seals the Resend API key for Authentik. The key is typed at a hidden prompt, so it
# never appears in chat, shell history or git. The output file is safe to commit.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-email-key.ps1

$ErrorActionPreference = "Stop"

$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$output = Join-Path $PSScriptRoot "..\platform\authentik\manifests\authentik-email.sealedsecret.yaml"

$secure = Read-Host "Paste the Resend API key (nothing will show)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

if ($key -notlike "re_*") {
  throw "That doesn't look like a Resend key. They start with re_. Nothing was saved."
}

$secret = @{
  apiVersion = "v1"
  kind       = "Secret"
  metadata   = @{ name = "authentik-email"; namespace = "authentik" }
  type       = "Opaque"
  stringData = @{ AUTHENTIK_EMAIL__PASSWORD = $key }
} | ConvertTo-Json -Depth 5

$sealed = $secret | & $kubeseal --format yaml
if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }

$sealed | Out-File -Encoding ascii $output
Write-Host "Sealed key saved to platform\authentik\manifests\authentik-email.sealedsecret.yaml"
