# Adds the volumes worth backing up to the nightly backup. They also keep the default
# group, because Longhorn only gives default jobs to volumes with no job of their own.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\label-backup-volumes.ps1

$ErrorActionPreference = "Stop"

$wanted = @(
  "default/postgres-data-energia-postgres-0",
  "investco/investco-postgres-pvc",
  "authentik/data-authentik-postgresql-0",
  "hub/data-hub-postgres-0",
  "godseye/godseye-auth",
  "monitoring/kube-prometheus-stack-grafana",
  "default/petros-models-pvc"
)

$volumes = (kubectl get volumes.longhorn.io -n longhorn-system -o json | ConvertFrom-Json).items

foreach ($claim in $wanted) {
  $volume = $volumes | Where-Object {
    "$($_.status.kubernetesStatus.namespace)/$($_.status.kubernetesStatus.pvcName)" -eq $claim
  }
  if (-not $volume) { throw "No Longhorn volume found for $claim. Stopped." }

  kubectl label "volume.longhorn.io/$($volume.metadata.name)" -n longhorn-system --overwrite `
    "recurring-job-group.longhorn.io/critical-data=enabled" `
    "recurring-job-group.longhorn.io/default=enabled" | Out-Null
  Write-Host "Added $claim"
}
