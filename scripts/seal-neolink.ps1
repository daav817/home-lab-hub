# Seals the Reolink camera logins for Neolink. Everything is typed at hidden prompts and goes
# straight into sealed secrets, so no password is shown or saved in plain text.
# It also makes a random stream password, which Frigate will use to read the streams.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\seal-neolink.ps1
$ErrorActionPreference = "Stop"
$kubeseal = Join-Path $PSScriptRoot "..\.tools\kubeseal.exe"
$outDir = Join-Path $PSScriptRoot "..\platform\cameras\manifests"

$cameras = @(
  @{ Name = "garage"; Label = "Reolink Garage"; Address = "192.168.0.94:9000" },
  @{ Name = "basement"; Label = "Reolink Basement"; Address = "192.168.0.73:9000" }
)

function Read-Hidden($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

# TOML basic string with backslashes and quotes escaped.
function Toml($value) { '"' + ($value -replace '\\', '\\' -replace '"', '\"') + '"' }

function Seal($name, $data) {
  $encoded = @{}
  foreach ($key in $data.Keys) { $encoded[$key] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($data[$key])) }
  $secret = @{
    apiVersion = "v1"; kind = "Secret"; type = "Opaque"
    metadata = @{ name = $name; namespace = "cameras" }
    data = $encoded
  } | ConvertTo-Json -Depth 5 -Compress
  $sealed = $secret | & $kubeseal --format yaml
  if ($LASTEXITCODE -ne 0) { throw "kubeseal failed. Nothing was saved." }
  $path = Join-Path $outDir "$name.sealedsecret.yaml"
  [IO.File]::WriteAllText($path, (($sealed -join "`n") + "`n"))
  Write-Host "Saved $path"
}

$username = Read-Host "Reolink camera username (press Enter for admin)"
if (-not $username) { $username = "admin" }
$same = Read-Host "Do both cameras use the same password? (y/n)"
$passwords = @{}
if ($same -match '^[Yy]') {
  $password = Read-Hidden "Password for both cameras"
  foreach ($camera in $cameras) { $passwords[$camera.Name] = $password }
} else {
  foreach ($camera in $cameras) { $passwords[$camera.Name] = Read-Hidden "Password for $($camera.Label)" }
}
foreach ($camera in $cameras) {
  if (-not $passwords[$camera.Name]) { throw "A camera password was empty. Nothing was saved." }
}

$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$streamPassword = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''

$toml = @(
  'bind = "0.0.0.0"',
  '',
  '[[users]]',
  'name = "frigate"',
  "pass = $(Toml $streamPassword)"
)
foreach ($camera in $cameras) {
  $toml += @(
    '',
    '[[cameras]]',
    "name = $(Toml $camera.Name)",
    "username = $(Toml $username)",
    "password = $(Toml $passwords[$camera.Name])",
    "address = $(Toml $camera.Address)",
    'discovery = "local"',
    'push_notifications = false',
    'permitted_users = ["frigate"]'
  )
}

$OutputEncoding = New-Object Text.UTF8Encoding($false)
Seal "neolink-config" @{ "neolink.toml" = ($toml -join "`n") + "`n" }
Seal "camera-streams" @{ "FRIGATE_RTSP_USER" = "frigate"; "FRIGATE_RTSP_PASSWORD" = $streamPassword }
Write-Host "Done. Tell Claude the files are saved."
