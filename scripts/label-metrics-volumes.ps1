# Stops daily and weekly snapshots of the metrics and log volumes, and clears the ones they
# have. Neither volume is backed up, and both only hold data that ages out on its own.
#
# Run from the repo root: powershell -ExecutionPolicy Bypass -File scripts\label-metrics-volumes.ps1

$ErrorActionPreference = "Stop"

$wanted = @(
  "monitoring/prometheus-kube-prometheus-stack-prometheus-db-prometheus-kube-prometheus-stack-prometheus-0",
  "monitoring/storage-loki-0"
)

$volumes = (kubectl get volumes.longhorn.io -n longhorn-system -o json | ConvertFrom-Json).items

foreach ($claim in $wanted) {
  $volume = $volumes | Where-Object {
    "$($_.status.kubernetesStatus.namespace)/$($_.status.kubernetesStatus.pvcName)" -eq $claim
  }
  if (-not $volume) { throw "No Longhorn volume found for $claim. Stopped." }

  kubectl label "volume.longhorn.io/$($volume.metadata.name)" -n longhorn-system --overwrite `
    "recurring-job-group.longhorn.io/metrics=enabled" `
    "recurring-job-group.longhorn.io/default-" | Out-Null
  Write-Host "Updated $claim"
}
