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
   and keep it out of git:

       kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealing-key -o yaml > sealed-secrets-key.yaml

5. Install the free [Renovate GitHub App](https://github.com/apps/renovate) on this repo.

6. Protect `main` last, after one deploy has worked. Every build pushes a commit
   straight to `main` to pin the image tag, and a rule that requires pull requests or
   checks can block that push and stop deploys. Under Settings > Rules, check that
   the rule can exempt that push. If GitHub Actions isn't offered as a bypass, use a
   deploy key with write access as the bypass instead. Then push a small change and
   confirm the **Commit and push manifest update** step still succeeds.

The hub is at <https://hub.192.168.1.243.nip.io> on the LAN. It stays off the public
tunnel until Authentik protects it in Phase 1.
