# Adding an app

Work through these in order. An app must not get a public address until it is protected.

## 1. Build it like the others

- Its own repo, a `k8s/` folder with plain kustomize, and a GHCR image.
- `ghcr-pull-secret` copied into its namespace. See [copy-pull-secret.md](copy-pull-secret.md).
- Secrets stored as Sealed Secrets, never as plain values in git.
- `storageClassName: longhorn` on every volume. The cluster has two default classes, so always set it.

## 2. Decide how it is protected

The hub does not protect an app. Tiles only link to it.

| The app | Protection |
| --- | --- |
| Has a good login of its own | Keep that login. Don't add Authentik in front, or people log in twice. |
| Has no login, or a weak one | Put Authentik in front of it before it goes public. |

To put Authentik in front, copy the Longhorn setup:

- `platform/longhorn-backup/manifests/longhorn-ui.yaml`: the Middleware and two Ingresses.
- The `longhorn` entries in `platform/authentik/manifests/blueprints.yaml`: provider, application,
  access group and the outpost's provider list. The outpost needs every such provider listed.

## 3. Test it on the home network

Use a `nip.io` address or a LAN IP, and confirm the app works.

For an app behind Authentik, also confirm a stranger is redirected to the login. This must show a
`302` pointing at `auth.energiapower.llc`:

```powershell
curl.exe -sk -o NUL -w "%{http_code} %{redirect_url}" -H "Host: NAME.energiapower.llc" https://192.168.1.243/
```

## 4. Add the public address

In Cloudflare, go to **Networking**, **Tunnels**, select the tunnel, and open **Routes**.

- App with its own login: point the route at the app's service.
- App behind Authentik: point the route at Traefik, using
  `https://traefik.traefik.svc.cluster.local:443`. Under **Additional application settings**, **TLS**,
  turn on **Disable TLS certificate verification**. Never point it at the app's service, because
  that skips the login entirely.

## 5. Check it from outside

Open the public address in a private browser window. You should land on a login page, not the app.

## 6. Add the tile

In the hub, open **Manage apps**, then **Add app**. Set the address, section and who can see it.
For a live status light, add a status check address using the app's internal address, such as
`http://NAME.NAMESPACE.svc.cluster.local`.

**Who can see it** only hides the tile. Anyone with the link can still try the address, so the
protection from step 2 is what actually keeps people out.

## 7. Add it to backups, if it stores data

1. Add its `namespace/claim-name` to `scripts/label-backup-volumes.ps1`, then run the script. The
   volume joins the nightly job and appears on the Backups page.
2. Give it a friendly name in `src/lib/backups.ts`.
3. Click **Back up now** once to confirm it works.
