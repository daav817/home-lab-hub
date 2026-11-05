# Copy the image pull secret into the hub namespace

The cluster needs `ghcr-pull-secret` in the `hub` namespace to pull the private image.
The value is copied from the `default` namespace and is never stored in git.

Run in PowerShell, from this repo:

```powershell
kubectl apply -f k8s/namespace.yaml
$s = kubectl get secret ghcr-pull-secret -n default -o json | ConvertFrom-Json
$copy = @{
  apiVersion = "v1"
  kind       = "Secret"
  type       = $s.type
  metadata   = @{ name = "ghcr-pull-secret"; namespace = "hub" }
  data       = $s.data
}
$copy | ConvertTo-Json -Depth 5 | kubectl apply -f -
```

Check that it landed:

```powershell
kubectl get secret ghcr-pull-secret -n hub
```
