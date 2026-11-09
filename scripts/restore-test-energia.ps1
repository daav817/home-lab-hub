# Proves the Energia database backup can bring the data back. Restores the newest Longhorn backup
# of energia-postgres from the router into a separate namespace, starts Postgres on it, and
# compares every table's row count with the live database. The live database is only read.
#
# Rows added or deleted since the backup (nightly, 03:30) show as differences in those tables
# only; a missing table or a database that won't start is a failure.
# A pass removes the test copy; a failure leaves it for checking.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\restore-test-energia.ps1
# Remove a leftover copy:  powershell -ExecutionPolicy Bypass -File scripts\restore-test-energia.ps1 -Cleanup

param([switch]$Cleanup)

$ErrorActionPreference = "Stop"

$namespace = "restore-test-energia"
$storageClass = "longhorn-restore-test-energia"

function Remove-TestCopy {
  kubectl delete namespace $namespace --ignore-not-found | Out-Null
  kubectl delete storageclass $storageClass --ignore-not-found | Out-Null
}

# Row count of every table, as "schema.table=count" lines.
function Get-RowCounts($target, $targetNamespace) {
  $build = "select string_agg(format('select %L || ''='' || count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' union all ' order by schemaname, tablename) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"
  $query = kubectl exec -n $targetNamespace $target -- psql -U energia -d energia_db -At -c $build
  if ($LASTEXITCODE -ne 0 -or -not $query) { throw "Couldn't list the tables in $target." }
  # Through stdin: Prisma's table names need double quotes, which PowerShell drops from arguments.
  $rows = $query | kubectl exec -i -n $targetNamespace $target -- psql -U energia -d energia_db -At
  if ($LASTEXITCODE -ne 0) { throw "Couldn't count rows in $target." }
  $counts = [ordered]@{}
  foreach ($line in $rows) {
    $name, $count = "$line".Trim() -split "=", 2
    if ($name) { $counts[$name] = [int64]$count }
  }
  return $counts
}

if ($Cleanup) {
  Remove-TestCopy
  Write-Host "Test copy removed."
  exit 0
}

Remove-TestCopy

$volumes = (kubectl get volumes.longhorn.io -n longhorn-system -o json | ConvertFrom-Json).items
$volume = $volumes | Where-Object { $_.status.kubernetesStatus.pvcName -eq "postgres-data-energia-postgres-0" }
if (-not $volume) { throw "No Longhorn volume found for the Energia database." }

$backups = (kubectl get backups.longhorn.io -n longhorn-system -l "backup-volume=$($volume.metadata.name)" -o json | ConvertFrom-Json).items
$newest = $backups |
  Where-Object { $_.status.state -eq "Completed" } |
  Sort-Object { [datetime]$_.status.backupCreatedAt } -Descending |
  Select-Object -First 1
if (-not $newest) { throw "No completed backup found for the Energia database." }

Write-Host "Restoring the Energia database backup from $($newest.status.backupCreatedAt)"

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
      storage: 10Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: restored-postgres
  namespace: $namespace
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  containers:
    # Same image and settings as the live energia-postgres (it starts as root and switches to
    # the postgres user, who owns the restored files).
    - name: postgres
      image: postgres:16-alpine
      env:
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
      readinessProbe:
        exec:
          command: ["pg_isready", "-U", "energia", "-d", "energia_db", "-h", "127.0.0.1"]
        periodSeconds: 5
      securityContext:
        allowPrivilegeEscalation: false
      volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: restored-data
"@ | kubectl apply -f - | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Couldn't create the test copy." }

Write-Host "Waiting for the restore and for Postgres to start (up to 15 minutes)..."
kubectl wait --for=condition=Ready pod/restored-postgres -n $namespace --timeout=900s | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The restored database didn't start. The test copy was left in place." }

$live = Get-RowCounts "energia-postgres-0" "default"
$restored = Get-RowCounts "restored-postgres" $namespace

$missing = @($live.Keys | Where-Object { -not $restored.Contains($_) })
$changed = @($live.Keys | Where-Object { $restored.Contains($_) -and $restored[$_] -ne $live[$_] })
$liveRows = ($live.Values | Measure-Object -Sum).Sum
$restoredRows = ($restored.Values | Measure-Object -Sum).Sum

Write-Host ("Tables: {0} live, {1} restored. Rows: {2} live, {3} restored." -f $live.Count, $restored.Count, $liveRows, $restoredRows)
foreach ($name in $changed) {
  Write-Host ("  {0,-45} live {1,8}  restored {2,8}" -f $name, $live[$name], $restored[$name])
}

if ($missing.Count -gt 0) {
  Write-Host "FAIL: tables missing from the backup: $($missing -join ', '). Test copy left in place."
  exit 1
}
Remove-TestCopy
if ($changed.Count -eq 0) {
  Write-Host "PASS: every table restored with the same rows as the live database. Test copy removed."
} else {
  Write-Host "PASS: every table restored; the tables listed changed since the backup. Test copy removed."
}
