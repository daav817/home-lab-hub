# Proves a backup can bring data back. Restores the newest hub database backup from the router
# into a separate namespace, starts Postgres on it and compares it with the live database.
# The live hub is not touched. A pass removes the test copy; a failure leaves it for checking.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1
# Remove a leftover copy:  powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 -Cleanup

param([switch]$Cleanup)

$ErrorActionPreference = "Stop"

$namespace = "restore-test"
$storageClass = "longhorn-restore-test"

function Remove-TestCopy {
  kubectl delete namespace $namespace --ignore-not-found | Out-Null
  kubectl delete storageclass $storageClass --ignore-not-found | Out-Null
}

function Get-Fingerprint($target, $targetNamespace) {
  $queries = [ordered]@{
    "apps rows"        = "select count(*) from apps"
    "apps contents"    = "select md5(string_agg(t::text, ',' order by t.id)) from apps t"
    "audit rows"       = "select count(*) from audit_log"
    "audit contents"   = "select md5(string_agg(t::text, ',' order by t.id)) from audit_log t"
    "migrations"       = "select count(*) from schema_migrations"
  }
  $result = [ordered]@{}
  foreach ($name in $queries.Keys) {
    $value = kubectl exec -n $targetNamespace $target -- psql -U hub -d hub -At -c $queries[$name]
    if ($LASTEXITCODE -ne 0) { throw "Couldn't read '$name' from $target." }
    $result[$name] = "$value".Trim()
  }
  return $result
}

if ($Cleanup) {
  Remove-TestCopy
  Write-Host "Test copy removed."
  exit 0
}

Remove-TestCopy

$volumes = (kubectl get volumes.longhorn.io -n longhorn-system -o json | ConvertFrom-Json).items
$volume = $volumes | Where-Object { $_.status.kubernetesStatus.pvcName -eq "data-hub-postgres-0" }
if (-not $volume) { throw "No Longhorn volume found for the hub database." }

$backups = (kubectl get backups.longhorn.io -n longhorn-system -l "backup-volume=$($volume.metadata.name)" -o json | ConvertFrom-Json).items
$newest = $backups |
  Where-Object { $_.status.state -eq "Completed" } |
  Sort-Object { [datetime]$_.status.backupCreatedAt } -Descending |
  Select-Object -First 1
if (-not $newest) { throw "No completed backup found for the hub database." }

Write-Host "Restoring backup from $($newest.status.backupCreatedAt)"

@"
apiVersion: v1
kind: Namespace
metadata:
  name: $namespace
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: $storageClass
provisioner: driver.longhorn.io
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "1"
  staleReplicaTimeout: "30"
  fromBackup: "$($newest.status.url)"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: restored-data
  namespace: $namespace
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: $storageClass
  resources:
    requests:
      storage: 2Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: restored-postgres
  namespace: $namespace
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  securityContext:
    runAsNonRoot: true
    runAsUser: 1001
    runAsGroup: 1001
    fsGroup: 1001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: postgres
      image: docker.io/library/postgres:17.11-trixie
      env:
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
      readinessProbe:
        exec:
          command: ["pg_isready", "-U", "hub", "-d", "hub", "-h", "127.0.0.1"]
        periodSeconds: 5
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
        - name: run
          mountPath: /var/run/postgresql
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: restored-data
    - name: run
      emptyDir: {}
    - name: tmp
      emptyDir: {}
"@ | kubectl apply -f - | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Couldn't create the test copy." }

Write-Host "Waiting for the restore and for Postgres to start (up to 10 minutes)..."
kubectl wait --for=condition=Ready pod/restored-postgres -n $namespace --timeout=600s | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The restored database didn't start. The test copy was left in place." }

$live = Get-Fingerprint "hub-postgres-0" "hub"
$restored = Get-Fingerprint "restored-postgres" $namespace

$matching = $true
foreach ($name in $live.Keys) {
  $same = $live[$name] -eq $restored[$name]
  if (-not $same) { $matching = $false }
  $label = if ($same) { "match" } else { "DIFFERENT" }
  Write-Host ("{0,-15} {1}" -f $name, $label)
}

if ($matching) {
  Remove-TestCopy
  Write-Host "PASS: the restored database matches the live one. Test copy removed."
} else {
  Write-Host "DIFFERENT: changes made after the backup also show here. Test copy left in place."
}
