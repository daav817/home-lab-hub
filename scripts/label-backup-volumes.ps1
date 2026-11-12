# Adds the volumes worth backing up to the nightly backup. They also keep the default
# group, because Longhorn only gives default jobs to volumes with no job of their own.
# Volumes added later by their own app manifests (MeshCentral, Frigate, Home Assistant, clip
# keeper, Petros) aren't listed here. This only adds labels; to take a volume out, run
#   kubectl label volume.longhorn.io/<volume> -n longhorn-system recurring-job-group.longhorn.io/critical-data-
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\label-backup-volumes.ps1

$ErrorActionPreference = "Stop"

$wanted = @(
  "default/postgres-data-energia-postgres-0",
  "investco/investco-postgres-pvc",
  "authentik/data-authentik-postgresql-0",
  "hub/data-hub-postgres-0",
  "godseye/godseye-auth"
)
# Not Grafana (removed 2026-11-12): its dashboards and data sources all come from the Helm chart
# and git (platform/monitoring-access/manifests/grafana-loki-datasource.yaml), and the rest of the
# volume is plugins it downloads again. It keeps its local snapshots (default group).

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
