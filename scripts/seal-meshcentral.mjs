// Phase 5 secrets, sealed without printing any of them:
// - MeshCentral's Authentik client secret (made by the blueprint) and a new session key,
// - one Wake-on-LAN relay token, sealed twice: for the relay and for the hub.
// Run again only to rotate them (MeshCentral users sign in again; nothing else changes).
//
//   node scripts/seal-meshcentral.mjs

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const read = `
from authentik.providers.oauth2.models import OAuth2Provider
print("CLIENT_SECRET=" + OAuth2Provider.objects.get(name="meshcentral").client_secret)
`;

const output = execFileSync(
  "kubectl",
  ["exec", "-n", "authentik", "deploy/authentik-worker", "--", "ak", "shell", "-c", read],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const clientSecret = output.match(/^CLIENT_SECRET=(.+)$/m)?.[1]?.trim();
if (!clientSecret) throw new Error("Could not read MeshCentral's client secret from Authentik (is the blueprint applied?).");

const wolToken = randomBytes(32).toString("base64url");

function seal(name, namespace, stringData, file) {
  const secret = { apiVersion: "v1", kind: "Secret", metadata: { name, namespace }, type: "Opaque", stringData };
  const sealed = execFileSync(".tools/kubeseal.exe", ["--format", "yaml"], { input: JSON.stringify(secret), encoding: "utf8" });
  writeFileSync(file, sealed);
}

seal("meshcentral-secrets", "remote-access", {
  OIDC_CLIENT_SECRET: clientSecret,
  SESSION_KEY: randomBytes(48).toString("hex"),
}, "platform/remote-access/manifests/meshcentral-secrets.sealedsecret.yaml");
seal("wol-relay", "remote-access", { WOL_TOKEN: wolToken }, "platform/remote-access/manifests/wol-relay.sealedsecret.yaml");
seal("hub-wol", "hub", { WOL_TOKEN: wolToken }, "k8s/hub-wol.sealedsecret.yaml");
console.log("Sealed MeshCentral and Wake-on-LAN secrets written.");
