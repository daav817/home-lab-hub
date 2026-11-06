# Home Lab Hub

Central portal for the energiapower.llc home lab. Next.js app, deployed to the k3s
cluster by Argo CD from the `k8s/` folder.

## Develop

    npm install
    npm run dev

Checks that CI also runs: `npm run lint`, `npm run typecheck`, `npm test`.

## How a change reaches the cluster

1. A pull request runs `ci.yml`: lint, types, tests, dependency audit, build,
   Gitleaks and Semgrep.
2. A push to `main` runs CI again, builds the image, scans it with Trivy, pushes it
   to GHCR and pins the new tag in `k8s/kustomization.yaml`.
3. Argo CD sees the pinned tag and rolls it out.

## First-time setup

Run these once, in order, from this folder.

1. Create the namespace and copy the image pull secret into it. Use the commands
   in [docs/copy-pull-secret.md](docs/copy-pull-secret.md).

2. After the first GitHub build finishes, create the Argo CD app:

       kubectl apply -f k8s/argocd-application.yaml

3. Install Sealed Secrets:

       kubectl apply -f platform/sealed-secrets/argocd-application.yaml

4. Back up the sealing key somewhere outside the cluster. Without it, sealed
   secrets can't be decrypted after a cluster rebuild. Treat the file like a password,
   and keep it out of git. Run in PowerShell, then check that it lists at least one key:

       kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml | Out-File -Encoding ascii sealed-secrets-key.yaml
       Select-String "name: sealed-secrets-key" sealed-secrets-key.yaml

   The controller creates a new key every 30 days, so repeat this backup after adding
   new sealed secrets.

5. Install the free [Renovate GitHub App](https://github.com/apps/renovate) on this repo.

6. Protect `main` last, after one deploy has worked. Every build pushes a commit
   straight to `main` to pin the image tag, and a rule that requires pull requests or
   checks can block that push and stop deploys. Under Settings > Rules, check that
   the rule can exempt that push. If GitHub Actions isn't offered as a bypass, use a
   deploy key with write access as the bypass instead. Then push a small change and
   confirm the **Commit and push manifest update** step still succeeds.

The hub is at <https://hub.192.168.1.243.nip.io> on the LAN. It stays off the public
tunnel until Authentik protects it in Phase 1.

## Backups

Longhorn backs up seven volumes to `k8s-storage-folder` on the router every night at 3:30 and keeps
14 per volume (`platform/longhorn-backup`).

- **See or start backups:** in the hub, **Manage apps**, then **Backups**.
- **Restore or delete:** only in Longhorn at <https://longhorn.energiapower.llc>, which is admin-only.
  The hub has no permission to change or delete backups.

To add an app, follow [docs/add-an-app.md](docs/add-an-app.md).
