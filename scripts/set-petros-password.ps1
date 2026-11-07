# Changes the password for admin@petros.ai. The app has no working reset of its own.
# The password is typed into a hidden prompt and sent only to the Petros pod and its secret.
# The pipeline logs in with the same password, so update the GitHub secret QA_TEST_PASS after this.
$ErrorActionPreference = "Stop"
$email = "admin@petros.ai"

function Read-Hidden($prompt) {
    $secure = Read-Host $prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$password = Read-Hidden "New password for $email (16 or more characters)"
if ($password.Length -lt 16) { throw "Use at least 16 characters. Nothing was changed." }
if ($password -ne (Read-Hidden "Type it again")) { throw "The two entries didn't match. Nothing was changed." }

$updateCode = @"
import sys
from werkzeug.security import generate_password_hash
from database import SessionLocal, User
password = sys.stdin.readline().rstrip('\r\n')
db = SessionLocal()
user = db.query(User).filter(User.email == '$email').first()
if not user:
    sys.exit('User not found. Nothing was changed.')
user.password_hash = generate_password_hash(password)
db.commit()
db.close()
print('PASSWORD_CHANGED')
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($updateCode))
$run = "import base64; exec(base64.b64decode('$encoded').decode())"

$pod = kubectl get pod -n default -l app=petros-ai --field-selector=status.phase=Running -o "jsonpath={.items[0].metadata.name}"
if (-not $pod) { throw "No running Petros pod was found. Nothing was changed." }

$previousEncoding = $OutputEncoding
$OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
    $result = $password | kubectl exec -i -n default $pod -c petros-ai -- python3 -c $run
}
finally {
    $OutputEncoding = $previousEncoding
}
if (($result -join "`n") -notmatch "PASSWORD_CHANGED") { throw "The password was not changed." }
Write-Host "Password changed in the database."

$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($password))
$patchFile = New-TemporaryFile
try {
    Set-Content -Path $patchFile -Encoding ascii -Value "{`"data`":{`"QA_TEST_PASS`":`"$base64`"}}"
    kubectl patch secret petros-secrets -n default --type merge --patch-file $patchFile.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The cluster secret wasn't updated, but the login password was changed." }
}
finally {
    Remove-Item $patchFile -Force
}
Write-Host "Cluster secret updated."

kubectl rollout restart deploy/petros-ai-engine -n default | Out-Null
Write-Host "Petros is restarting. Load your model again once it's back."
Write-Host "Last step: update the GitHub secret QA_TEST_PASS with this same password."
