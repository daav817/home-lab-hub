# Seals the Cloudflare R2 access key for the off-site backup, generates the encryption password
# and salt, and switches the nightly job on
# (platform/longhorn-backup/manifests/offsite-backup.yaml).
#
# Before running, in the Cloudflare dashboard:
#   1. R2 Object Storage > Create bucket: name it e.g. home-lab-backups (location: Automatic).
#   2. R2 > Manage API tokens > Create API token: permission "Object Read & Write", applied to
#      that one bucket only. Copy the Access Key ID and Secret Access Key it shows (once).
#   3. Note your Account ID (R2 overview page, right side).
#
# At the end the encryption password and salt are shown ONCE. Save both in your password
# manager: after a total loss (house, cluster and router gone) they are the only way to read the
# off-site copy. Nothing else is shown or saved in plain text.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-offsite-backup.ps1
$ErrorActionPreference = "Stop"
$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$manifests = Join-Path $PSScriptRoot "..\platform\longhorn-backup\manifests"

function Read-Hidden($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-Random() {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$account = (Read-Host "Cloudflare Account ID").Trim()
if ($account -notmatch "^[0-9a-f]{32}$") { throw "That doesn't look like an Account ID (32 letters/digits). Nothing was saved." }
$bucket = (Read-Host "R2 bucket name [home-lab-backups]").Trim()
if (-not $bucket) { $bucket = "home-lab-backups" }
$keyId = (Read-Hidden "R2 Access Key ID").Trim()
$keySecret = (Read-Hidden "R2 Secret Access Key").Trim()
if (-not $keyId -or -not $keySecret) { throw "The access key was empty. Nothing was saved." }

$cryptPassword = New-Random
$cryptSalt = New-Random

$values = [ordered]@{
  R2_ENDPOINT = "https://$account.r2.cloudflarestorage.com"
  R2_BUCKET = $bucket
  R2_ACCESS_KEY_ID = $keyId
  R2_SECRET_ACCESS_KEY = $keySecret
  CRYPT_PASSWORD = $cryptPassword
  CRYPT_SALT = $cryptSalt
}
$encoded = @{}
foreach ($key in $values.Keys) { $encoded[$key] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($values[$key])) }
$secret = @{
  apiVersion = "v1"; kind = "Secret"; type = "Opaque"
  metadata = @{ name = "offsite-backup"; namespace = "longhorn-system" }
  data = $encoded
} | ConvertTo-Json -Depth 5 -Compress
$OutputEncoding = New-Object Text.UTF8Encoding($false)
$sealed = $secret | & $kubeseal --format yaml
if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }
$out = Join-Path $manifests "offsite-backup.sealedsecret.yaml"
[IO.File]::WriteAllText($out, (($sealed -join "`n") + "`n"))
Write-Host "Saved $out"

# Switch the nightly job on.
$job = Join-Path $manifests "offsite-backup.yaml"
$text = [IO.File]::ReadAllText($job)
$text = $text -replace "(?m)^  suspend: true$", "  suspend: false"
[IO.File]::WriteAllText($job, $text)
Write-Host "Turned the nightly job on in $job"

Write-Host ""
Write-Host "SAVE THESE TWO IN YOUR PASSWORD MANAGER NOW (entry: 'Home lab off-site backup encryption')." -ForegroundColor Yellow
Write-Host "They are shown only this once. Bucket: $bucket, folder: home-lab, rclone crypt (standard names)."
Write-Host "  Password: $cryptPassword"
Write-Host "  Salt:     $cryptSalt"
Write-Host ""
Read-Host "Press Enter once they're saved (the window will be cleared)"
Clear-Host
Write-Host "Done. Tell Claude the files are saved."
