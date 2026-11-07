# Seals the Wyze login for the Wyze bridge. Everything is typed at hidden prompts and goes
# straight into a sealed secret, so nothing is shown or saved in plain text.
#
# You need: your Wyze email and password, an API ID and key from
# https://developer-api-console.wyze.com/#/apikey/view, and the authenticator (TOTP) key from
# setting up two-step verification with an authenticator app.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-wyze.ps1
$ErrorActionPreference = "Stop"
$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$out = Join-Path $PSScriptRoot "..\platform\cameras\manifests\wyze-bridge.sealedsecret.yaml"

function Read-Hidden($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$values = [ordered]@{
  WYZE_EMAIL    = (Read-Hidden "Wyze account email").Trim()
  WYZE_PASSWORD = Read-Hidden "Wyze account password"
  WYZE_API_ID   = (Read-Hidden "Wyze API ID").Trim()
  WYZE_API_KEY  = (Read-Hidden "Wyze API key").Trim()
  # Authenticator keys are often shown in groups with spaces. Those aren't part of the key.
  WYZE_TOTP_KEY = ((Read-Hidden "Wyze authenticator key") -replace '\s', '').ToUpper()
}
foreach ($name in $values.Keys) {
  if (-not $values[$name]) { throw "$name was empty. Nothing was saved." }
}
if ($values.WYZE_TOTP_KEY -notmatch '^[A-Z2-7]+=*$') {
  throw "The authenticator key should only contain the letters A-Z and the digits 2-7. Nothing was saved."
}

$encoded = @{}
foreach ($name in $values.Keys) {
  $encoded[$name] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($values[$name]))
}
$secret = @{
  apiVersion = "v1"; kind = "Secret"; type = "Opaque"
  metadata = @{ name = "wyze-bridge"; namespace = "cameras" }
  data = $encoded
} | ConvertTo-Json -Depth 5 -Compress

$OutputEncoding = New-Object Text.UTF8Encoding($false)
$sealed = $secret | & $kubeseal --format yaml
if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }
[IO.File]::WriteAllText($out, (($sealed -join "`n") + "`n"))
Write-Host "Saved $out"
Write-Host "Done. Tell Claude the file is saved."
